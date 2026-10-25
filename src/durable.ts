/**
 * Durable journaled execution for codemode scripts.
 *
 * PI-DURABLE REUSE VERDICT: hand-rolled JSONL per contract; pi-durable is NOT
 * reused. Rationale (upstream package layout, per local research notes —
 * not published):
 * - Durable codemode in pi-durable is `createCodemodeTool` /
 *   `createCodemodeExtension` (`dist/codemode/codemode.d.ts`), whose replay
 *   journal (`pi.codemode.run` + `pi.codemode.journal` TaskDocs) only exists
 *   inside an open `Harness` over a `Storage` (`dist/harness/harness.d.ts`).
 * - Every tool call takes a Chord `Context` (`import { type Context } from
 *   "@earendil-works/chord"` in `codemode.d.ts:37`); nested calls reattach by
 *   key with per-tool `replay: "safe" | "unsafe"` policies — there is no
 *   standalone journal/memo/storage function usable without the Harness,
 *   scheduler, and task graph (`dist/harness/types.d.ts` `ToolExecutionApi`).
 * - The portable storage backends (`./storage/jsonl`, `./storage/sqlite`
 *   export subpaths in `src/pi-durable/package.json:75-104`) persist whole
 *   Harness commits (FORMAT_VERSION markers + sidecars), not per-script-call
 *   journals; adopting them would drag in the Harness, chord runtime, and
 * `engines: node >= 22.19.0` under a bun-compiled host (see local research
 * notes, not published, for the full analysis).
 * - Chord's role here: none directly. Chord (`@earendil-works/chord 1.4.0`,
 *   a pi-durable dependency) is the cancellation/telemetry `Context`
 *   threading pi-durable's commits; this module needs no chord import
 *   because journaling is done synchronously in the host before the result
 *   is handed back to the script. Do NOT import chord unless a future
 *   pi-durable API adoption requires it.
 *
 * Model (mirrors pi-durable's "nothing is shown before its commit is
 * stored"): each completed host call is appended to `<dir>/<id>.jsonl` and
 * fsynced BEFORE the result is returned to the script (commit-before-show).
 * Replay is keyed by call order `seq` + `name` + `argsHash`; a mismatch
 * truncates the journal at that seq (divergence) and executes live from
 * there. Single-writer assumption: one process owns an id at a time (same
 * constraint as pi-durable's "one process owns a storage at a time").
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { runCodemode } from "./core.ts";
import type { BridgeTool } from "./core.ts";

/** Tools scripts must not call (self-recursion). Mirrors index.ts EXCLUDED_TOOLS. */
const EXCLUDED_TOOLS = new Set([
  "codemode",
  "durable_run",
  "durable_resume",
  "durable_status",
]);

export interface DurableRunArgs {
  dir?: string;
  id: string;
  code: string;
  tools: BridgeTool[];
  timeoutMs?: number;
}

export interface DurableResumeArgs {
  dir?: string;
  id: string;
  /** Omitted: reuse the code stored in the journal header line. */
  code?: string;
  tools: BridgeTool[];
  timeoutMs?: number;
}

export interface DurableResult {
  ok: boolean;
  resultText: string;
  storeWrites?: unknown;
  raw: unknown;
}

export interface DurableStatus {
  exists: boolean;
  finished: boolean;
  ok?: boolean;
  calls: number;
  lastSeq: number;
}

type JournalCall = {
  type: "call";
  seq: number;
  name: string;
  argsHash: string;
  /** Present when the result JSON-round-trips; else `live` re-executes on replay. */
  result?: unknown;
  live?: true;
};

/** Resolve the state dir: explicit arg, else PI_V1_DURABLE_DIR, else ~/.omp/agent/durable/. */
export function resolveDurableDir(dir?: string): string {
  const base =
    dir ?? process.env["PI_V1_DURABLE_DIR"] ?? join(homedir(), ".omp", "agent", "durable");
  mkdirSync(base, { recursive: true });
  return base;
}

function journalPath(dir: string, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(`Invalid durable id ${JSON.stringify(id)}`);
  }
  return join(dir, `${id}.jsonl`);
}

/** Canonical stringify: object keys sorted recursively, so hashes are stable. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

function argsHash(args: unknown): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex");
}

/** Append one line and fsync before returning (commit-before-show). */
function appendLine(path: string, line: unknown): void {
  const fd = openSync(path, "a");
  try {
    writeSync(fd, `${JSON.stringify(line)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readLines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as unknown);
}

function headerCode(lines: unknown[]): string | undefined {
  const h = lines[0] as { type?: string; code?: unknown } | undefined;
  return h?.type === "header" && typeof h.code === "string" ? h.code : undefined;
}

function callEntries(lines: unknown[]): JournalCall[] {
  return lines.filter(
    (l): l is JournalCall =>
      typeof l === "object" && l !== null && (l as { type?: string }).type === "call",
  );
}

function endEntry(lines: unknown[]): { type: "end"; ok: boolean } | undefined {
  const e = [...lines]
    .reverse()
    .find((l) => typeof l === "object" && l !== null && (l as { type?: string }).type === "end") as
    | { type: "end"; ok: boolean }
    | undefined;
  return e;
}

function resultEntry(lines: unknown[]): DurableResult | undefined {
  const e = [...lines]
    .reverse()
    .find(
      (l) => typeof l === "object" && l !== null && (l as { type?: string }).type === "result",
    ) as { type: "result"; result?: DurableResult } | undefined;
  return e?.result;
}

/** Drop every journal line at/after `fromSeq` (calls, end, result); keep the header. */
function truncateAt(path: string, lines: unknown[], fromSeq: number): unknown[] {
  const kept = lines.filter((l) => {
    if (typeof l !== "object" || l === null) return true;
    const t = (l as { type?: string }).type;
    if (t === "call") return ((l as JournalCall).seq ?? 0) < fromSeq;
    if (t === "end" || t === "result") return false;
    return true;
  });
  writeFileSync(path, kept.map((l) => `${JSON.stringify(l)}\n`).join(""));
  const fd = openSync(path, "a");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return kept;
}

async function executeWithJournal(
  path: string,
  code: string,
  tools: BridgeTool[],
  timeoutMs: number | undefined,
  seed: unknown[],
): Promise<DurableResult> {
  let lines = seed;
  const calls = callEntries(lines);
  const bySeq = new Map(calls.map((c) => [c.seq, c]));
  const counter = { n: 0 };

  const wrapped: BridgeTool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
    execute: async (args: unknown, ctx: { signal: AbortSignal }): Promise<unknown> => {
      const seq = ++counter.n;
      const hash = argsHash(args);
      const hit = bySeq.get(seq);
      if (hit && hit.name === t.name && hit.argsHash === hash && !hit.live && "result" in hit) {
        return hit.result;
      }
      if (hit && (hit.name !== t.name || hit.argsHash !== hash)) {
        // Divergence: the script changed; rerun live from here.
        lines = truncateAt(path, lines, seq);
        bySeq.clear();
        for (const c of callEntries(lines)) bySeq.set(c.seq, c);
      }
      if (hit && hit.live && hit.name === t.name && hit.argsHash === hash) {
        return t.execute(args, ctx);
      }
      const result = await t.execute(args, ctx);
      let entry: JournalCall;
      try {
        const roundTripped = JSON.parse(JSON.stringify(result)) as unknown;
        entry = { type: "call", seq, name: t.name, argsHash: hash, result: roundTripped };
      } catch {
        // Unserializable results cannot be journaled; replay re-executes live.
        entry = { type: "call", seq, name: t.name, argsHash: hash, live: true };
      }
      appendLine(path, entry);
      bySeq.set(seq, entry);
      return result;
    },
  }));

  let outcome: DurableResult;
  try {
    const r = await runCodemode(code, wrapped, timeoutMs !== undefined ? { timeoutMs } : {});
    outcome = { ok: r.ok, resultText: r.resultText, storeWrites: r.storeWrites, raw: r.raw };
  } catch (err) {
    // Host-level failure (not a script error): keep completed calls, mark the
    // end not-ok WITHOUT a result line so a later resume replays instead of
    // returning a stored result.
    appendLine(path, { type: "end", ok: false, thrown: String(err) });
    throw err;
  }
  appendLine(path, { type: "end", ok: outcome.ok });
  appendLine(path, {
    type: "result",
    result: { ok: outcome.ok, resultText: outcome.resultText, storeWrites: outcome.storeWrites },
  });
  return outcome;
}

/** Fresh run. Throws if a journal already exists for the id (use resumeDurable). */
export async function runDurable(args: DurableRunArgs): Promise<DurableResult> {
  const dir = resolveDurableDir(args.dir);
  const path = journalPath(dir, args.id);
  if (existsSync(path)) {
    throw new Error(`Durable id ${JSON.stringify(args.id)} already exists; use durable_resume`);
  }
  appendLine(path, { type: "header", v: 1, code: args.code });
  return executeWithJournal(path, args.code, args.tools, args.timeoutMs, readLines(path));
}

/**
 * Resume a previous run. Replays journaled calls without re-executing them;
 * executes remaining calls live. A finished id returns its stored final
 * result without any re-execution.
 */
export async function resumeDurable(args: DurableResumeArgs): Promise<DurableResult> {
  const dir = resolveDurableDir(args.dir);
  const path = journalPath(dir, args.id);
  const lines = readLines(path);
  const storedCode = headerCode(lines);
  if (storedCode === undefined) {
    throw new Error(`No durable journal for id ${JSON.stringify(args.id)}`);
  }
  const stored = resultEntry(lines);
  if (stored && endEntry(lines)) {
    return stored;
  }
  return executeWithJournal(path, args.code ?? storedCode, args.tools, args.timeoutMs, lines);
}

/** Inspect a journal without executing anything. */
export function durableStatus(args: { dir?: string; id: string }): DurableStatus {
  const dir = resolveDurableDir(args.dir);
  let lines: unknown[] = [];
  try {
    lines = readLines(journalPath(dir, args.id));
  } catch {
    return { exists: false, finished: false, calls: 0, lastSeq: 0 };
  }
  if (lines.length === 0 || headerCode(lines) === undefined) {
    return { exists: false, finished: false, calls: 0, lastSeq: 0 };
  }
  const calls = callEntries(lines);
  const end = endEntry(lines);
  return {
    exists: true,
    finished: end !== undefined && resultEntry(lines) !== undefined,
    ...(end ? { ok: end.ok } : {}),
    calls: calls.length,
    lastSeq: calls.reduce((m, c) => Math.max(m, c.seq), 0),
  };
}

/** Minimal structural view of the extension host (avoids a pi-coding-agent dep). */
export interface DurableRegistrar {
  registerTool(tool: {
    name: string;
    label: string;
    description?: string;
    parameters?: unknown;
    execute: (...args: never[]) => Promise<unknown>;
  }): void;
}

interface CtxCallableTool {
  name: string;
  description?: string;
  parameters?: unknown;
  outputSchema?: unknown;
}

interface CtxLike {
  tools?: readonly CtxCallableTool[];
  executeTool?: (
    name: string,
    args: unknown,
    opts?: { signal?: AbortSignal },
  ) => Promise<{ result: { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown }; isError?: boolean }>;
}

/** Session tools at execute time, mirroring index.ts toBridgeTools. */
function bridgeFromCtx(ctx: unknown, makeTools: () => BridgeTool[]): BridgeTool[] {
  const c = ctx as CtxLike | undefined;
  if (!c || !Array.isArray(c.tools) || typeof c.executeTool !== "function") {
    return makeTools();
  }
  const exec = c.executeTool.bind(c);
  return (c.tools as readonly CtxCallableTool[])
    .filter((t) => !EXCLUDED_TOOLS.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
      execute: async (args: unknown, toolCtx: { signal: AbortSignal }) => {
        const outcome = await exec(t.name, args, { signal: toolCtx.signal });
        if (t.outputSchema && outcome.result.structuredContent !== undefined) {
          return outcome.result.structuredContent;
        }
        const text = (outcome.result.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n");
        if (outcome.isError) throw new Error(text || `Tool "${t.name}" failed`);
        return text;
      },
    }));
}

function toolResult(resultText: string, ok: boolean): unknown {
  return {
    content: [{ type: "text", text: resultText }],
    ...(ok ? {} : { isError: true }),
  };
}

/**
 * Register `durable_run` / `durable_resume` / `durable_status` on the host.
 * `makeTools` is a fallback; session tools are preferably built from the
 * execute-time ctx (which carries `tools` + `executeTool`).
 */
export function registerDurable(pi: DurableRegistrar, makeTools: () => BridgeTool[]): void {
  pi.registerTool({
    name: "durable_run",
    label: "Durable run",
    description: "Run JavaScript durably: each tool call is journaled, so a resume replays instead of re-executing.",
    parameters: Type.Object({
      id: Type.String({ description: "Durable execution id (fresh)." }),
      code: Type.String({ description: "Raw JavaScript source (async function body)." }),
    }),
    execute: (async (
      _toolCallId: string,
      params: unknown,
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: unknown,
    ) => {
      void signal;
      const { id, code } = params as { id: string; code: string };
      const r = await runDurable({ id, code, tools: bridgeFromCtx(ctx, makeTools) });
      return toolResult(r.resultText, r.ok);
    }) as (...args: never[]) => Promise<unknown>,
  });

  pi.registerTool({
    name: "durable_resume",
    label: "Durable resume",
    description: "Resume a durable execution; replays journaled calls, runs the rest live.",
    parameters: Type.Object({
      id: Type.String({ description: "Durable execution id." }),
      code: Type.Optional(Type.String({ description: "Replacement code; omitted reuses the stored code." })),
    }),
    execute: (async (
      _toolCallId: string,
      params: unknown,
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: unknown,
    ) => {
      void signal;
      const { id, code } = params as { id: string; code?: string };
      const r = await resumeDurable({
        id,
        tools: bridgeFromCtx(ctx, makeTools),
        ...(code !== undefined ? { code } : {}),
      });
      return toolResult(r.resultText, r.ok);
    }) as (...args: never[]) => Promise<unknown>,
  });

  pi.registerTool({
    name: "durable_status",
    label: "Durable status",
    description: "Show a durable execution's journal status without running anything.",
    parameters: Type.Object({
      id: Type.String({ description: "Durable execution id." }),
    }),
    execute: (async (_toolCallId: string, params: unknown) => {
      const { id } = params as { id: string };
      const s = durableStatus({ id });
      return toolResult(JSON.stringify(s), true);
    }) as (...args: never[]) => Promise<unknown>,
  });
}
