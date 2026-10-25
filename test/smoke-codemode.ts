import { formatResult, runCodemode } from "../src/core.ts";
import type { BridgeTool } from "../src/core.ts";

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

const echo: BridgeTool = {
  name: "echo",
  description: "Echoes back its input.",
  inputSchema: { type: "object" },
  async execute(args) {
    return `echo:${JSON.stringify(args)}`;
  },
};
const add: BridgeTool = {
  name: "add",
  description: "Adds a and b.",
  inputSchema: { type: "object" },
  async execute(args) {
    const { a, b } = args as { a: number; b: number };
    return a + b;
  },
};
const failer: BridgeTool = {
  name: "failer",
  description: "Always fails.",
  async execute() {
    throw new Error("boom-failer");
  },
};

// (i) two tools, combined return
{
  const r = await runCodemode(
    `const e = await tools.echo({ x: 1 }); const s = await tools.add({ a: 2, b: 3 }); return e + "|" + s;`,
    [echo, add],
    { timeoutMs: 30000 },
  );
  check("two-tools-combined", r.ok && r.resultText.includes("echo:") && r.resultText.includes("|5"), r);
}

// (ii) failing call caught, script still returns
{
  const r = await runCodemode(
    `const settled = await Promise.allSettled([tools.add({ a: 1, b: 1 }), tools.failer({})]); return settled.map(s => s.status).join(",");`,
    [add, failer],
    { timeoutMs: 30000 },
  );
  check("failure-caught-allSettled", r.ok && r.resultText.includes("fulfilled,rejected"), r);
}

// (iii) thrown script error -> ok:false with error text
{
  const r = await runCodemode(`throw new Error("script-kaboom");`, [echo], { timeoutMs: 30000 });
  check("thrown-error-ok-false", !r.ok && r.resultText.includes("script-kaboom"), r);
}

// (iv) store/load round trip
{
  const r = await runCodemode(
    `const prev = load("counter"); store("counter", (prev ?? 0) + 1); return "prev=" + prev;`,
    [echo],
    { timeoutMs: 30000, store: { counter: 41 } },
  );
  const writes = r.storeWrites as { set?: Record<string, unknown> };
  check(
    "store-round-trip",
    r.ok && r.resultText.includes("prev=41") && writes?.set?.["counter"] === 42,
    { resultText: r.resultText, storeWrites: r.storeWrites },
  );
}

// (v) globals option: top-level helper callable as <name>(args)
{
  const r = await runCodemode(`return await shout("hi");`, [echo], {
    timeoutMs: 30000,
    globals: [
      {
        name: "shout",
        description: "Uppercase helper.",
        async execute(args) {
          return String(args).toUpperCase();
        },
      },
    ],
  });
  check("globals-helper", r.ok && r.resultText.includes("HI"), r);
}

console.log(`smoke done: ${pass} passed`);
