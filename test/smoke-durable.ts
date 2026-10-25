/**
 * Two-process kill/resume probe for durable.ts. Fake BridgeTools, no model calls.
 *
 *   bun test/smoke-durable.ts A   # runs id 't1', probe kills the process on call 3 (exit 137)
 *   bun test/smoke-durable.ts B   # resumes 't1', finishes call 3 live, asserts exactly-once
 *
 * Mode B also covers: resume-without-code (header reuse), resume-of-finished
 * (no re-execution), and the script-error path ({type:'end',ok:false} keeping
 * completed calls). Never edit assertions to pass; fix src/durable.ts.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { durableStatus, resumeDurable, runDurable } from "../src/durable.ts";
import type { BridgeTool } from "../src/core.ts";

const mode = process.argv[2];
if (mode !== "A" && mode !== "B") {
  console.error("usage: bun test/smoke-durable.ts A|B");
  process.exit(2);
}

const scratch = join(import.meta.dir, "tmp-smoke-durable");
const durableDir = join(scratch, "durable");
const logFile = join(scratch, "probe.log");
const counterFile = join(scratch, "counter.txt");

process.env["PI_V1_DURABLE_DIR"] = durableDir;

let pass = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    console.log(`FAIL ${name}${extra !== undefined ? `: ${JSON.stringify(extra)}` : ""}`);
    process.exitCode = 1;
  }
}

function readCounter(): number {
  return existsSync(counterFile) ? Number(readFileSync(counterFile, "utf-8").trim()) : 0;
}

function readLog(): string[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf-8").split("\n").filter((l) => l !== "");
}

/** Fake tool: appends STEP<n> to the log, counts executions. In mode A the
 *  3rd call kills the parent BEFORE any side effect (so seq 3 is unjournaled). */
const probe: BridgeTool = {
  name: "probe",
  description: "Test probe.",
  inputSchema: { type: "object" },
  async execute(args) {
    const { n } = args as { n: number };
    if (mode === "A" && n === 3) process.exit(137);
    writeFileSync(logFile, `STEP${n}\n`, { flag: "a" });
    writeFileSync(counterFile, `${readCounter() + 1}\n`);
    return `ok-${n}`;
  },
};

const SCRIPT = `const a = await tools.probe({n:1}); const b = await tools.probe({n:2}); const c = await tools.probe({n:3}); return a + "|" + b + "|" + c;`;

if (mode === "A") {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(durableDir, { recursive: true });
  const r = await runDurable({ id: "t1", code: SCRIPT, tools: [probe], timeoutMs: 60000 });
  // Reaching here means the crash did not happen: fail loudly.
  console.log(`FAIL crash-expected: run returned instead of dying: ${JSON.stringify(r)}`);
  process.exit(1);
}

// ---- Mode B: resume after the kill ----
{
  const before = readCounter();
  check("crash-left-two-executions", before === 2, { before, log: readLog() });

  const r = await resumeDurable({ id: "t1", tools: [probe], timeoutMs: 60000 });
  check("resume-ok", r.ok, r);
  check("resume-result", r.resultText.includes("ok-1|ok-2|ok-3"), r.resultText);

  const log = readLog();
  check("each-step-exactly-once", JSON.stringify(log) === JSON.stringify(["STEP1", "STEP2", "STEP3"]), log);
  check("counter-three", readCounter() === 3, { counter: readCounter() });

  const st = durableStatus({ id: "t1" });
  check("status-finished", st.exists && st.finished && st.ok === true && st.calls === 3, st);

  // Resume of a finished id: stored result, no re-execution.
  const c0 = readCounter();
  const r2 = await resumeDurable({ id: "t1", tools: [probe], timeoutMs: 60000 });
  check("finished-resume-same-result", r2.ok && r2.resultText === r.resultText, r2.resultText);
  check("finished-resume-no-reexec", readCounter() === c0, { counter: readCounter() });
}

// ---- Script-error path: end ok:false keeps completed calls ----
{
  const c0 = readCounter();
  const bad = await runDurable({
    id: "t2",
    code: `const a = await tools.probe({n:9}); throw new Error("script-kaboom-t2"); return a;`,
    tools: [probe],
    timeoutMs: 60000,
  });
  check("script-error-ok-false", !bad.ok && bad.resultText.includes("script-kaboom-t2"), bad);
  const st = durableStatus({ id: "t2" });
  check("error-status-keeps-call", st.exists && st.finished && st.ok === false && st.calls === 1, st);
  check("error-log-once", readLog().filter((l) => l === "STEP9").length === 1, readLog());

  const c1 = readCounter();
  check("error-made-one-execution", c1 === c0 + 1, { c0, c1 });
  const rb = await resumeDurable({ id: "t2", tools: [probe], timeoutMs: 60000 });
  check("error-resume-same-result", !rb.ok && rb.resultText === bad.resultText, rb.resultText);
  check("error-resume-no-reexec", readCounter() === c1, { counter: readCounter() });
}

console.log(`smoke done: ${pass} passed`);
console.log(`LOG CONTENTS: ${JSON.stringify(readLog())}`);
if (process.exitCode) console.log("SMOKE-DURABLE FAIL");
else console.log("SMOKE-DURABLE PASS");
