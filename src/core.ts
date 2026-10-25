import { join } from "node:path";
import { CodemodeSandbox, loadQuickJSWasm } from "@earendil-works/pi-codemode";
import type {
  CodemodeResult,
  CodemodeTool,
} from "@earendil-works/pi-codemode";

/**
 * Files the sandbox needs at runtime. `pi-worker.js` is the stock pi-codemode
 * worker entry bundled with bun (its bare `quickjs-wasi` import cannot resolve
 * under the omp extension loader), and the wasm bytes load from the installed
 * `quickjs-wasi` package file. `src/` and `dist/` are both direct children of
 * the bridge root, so `../node_modules` works for both. This is the
 * documented-for-bundlers use of the `wasm`/`workerUrl` options (upstream
 * `CodemodeSandboxOptions`).
 */
function runtimeFiles() {
  const root = join(import.meta.dir, "..");
  return {
    wasmPath: join(root, "node_modules", "quickjs-wasi", "quickjs.wasm"),
    workerUrl: new URL("../dist/pi-worker.js", import.meta.url),
  };
}
/** A host tool exposed to codemode scripts as `tools.<name>(args)`. */
export interface BridgeTool {
  name: string;
  description?: string;
  /** JSON Schema of the single argument; rendered as the parameter type. */
  inputSchema?: unknown;
  execute(args: unknown, ctx: { signal: AbortSignal }): Promise<unknown>;
  /**
   * Globals only: when true the sandbox passes all call arguments as an
   * array; otherwise just the first one. Multi-arg globals (searchTools,
   * describeTool, describeNamespace) need `spread: true` (upstream uses it).
   */
  spread?: boolean;
}

export interface RunCodemodeOpts {
  timeoutMs?: number;
  /** Values the script reads with `load(key)`; script `store()` writes are returned, not persisted. */
  store?: Record<string, unknown>;
  /** Host helpers exposed as top-level identifiers (e.g. searchTools/describeTool). */
  globals?: BridgeTool[];
  signal?: AbortSignal;
}

export interface RunCodemodeResult {
  resultText: string;
  ok: boolean;
  storeWrites?: unknown;
  raw: unknown;
}

function toCodemodeTool(t: BridgeTool): CodemodeTool {
  return {
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema ?? true) as CodemodeTool["inputSchema"],
    ...(t.spread === true ? { spread: true as const } : {}),
    execute: (args, ctx) => t.execute(args, ctx),
  };
}

/** Render a {@link CodemodeResult} as model-facing text. Mirrors upstream framing. */
export function formatResult(result: CodemodeResult): string {
  const texts: string[] = [];
  const consoles: string[] = [];
  for (const item of result.output ?? []) {
    if (item.type === "text") {
      if (item.console) consoles.push(item.text);
      else texts.push(item.text);
    }
  }
  const parts: string[] = [];
  if (result.ok) {
    if (result.value !== undefined) {
      parts.push(
        typeof result.value === "string"
          ? result.value
          : JSON.stringify(result.value),
      );
    }
  } else {
    const e = result.error;
    parts.push(
      `Error (${e.kind}): ${e.message}${e.stack ? `\n${e.stack}` : ""}`,
    );
  }
  texts.forEach((t, i) => {
    parts.push(
      texts.length > 1 ? `==> text ${i + 1}/${texts.length} <==\n${t}` : t,
    );
  });
  if (consoles.length > 0) {
    parts.push(`<console_output>\n${consoles.join("\n")}\n</console_output>`);
  }
  const text = parts.filter((p) => p !== "").join("\n");
  return text === "" ? (result.ok ? "(no output)" : "Error: (no message)") : text;
}

/**
 * Run `code` (async function body: top-level `await`/`return` work) in a
 * QuickJS worker-thread sandbox. Uses {@link CodemodeSandbox} (worker
 * transport, verified under plain bun by the smoke test). The wasm module
 * loads from the installed package file and the worker entry is the bundled
 * `dist/pi-worker.js` (see {@link runtimeFiles}), which also keeps the `dist/`
 * bundle working under loaders that forbid bare third-party imports.
 */
export async function runCodemode(
  code: string,
  tools: BridgeTool[],
  opts: RunCodemodeOpts = {},
): Promise<RunCodemodeResult> {
  const { wasmPath, workerUrl } = runtimeFiles();
  const sandbox = new CodemodeSandbox({
    tools: tools.map(toCodemodeTool),
    ...(opts.globals ? { globals: opts.globals.map(toCodemodeTool) } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    wasm: loadQuickJSWasm(wasmPath),
    workerUrl,
  });
  try {
    const result = await sandbox.execute(code, {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.store ? { store: opts.store } : {}),
    });
    if (result.ok) {
      return {
        resultText: formatResult(result),
        ok: true,
        storeWrites: result.storeWrites,
        raw: result,
      };
    }
    return { resultText: formatResult(result), ok: false, raw: result };
  } finally {
    await sandbox.close();
  }
}
