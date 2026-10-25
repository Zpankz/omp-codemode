import piV1BridgeExtension from "../dist/omp-codemode.js";

// Fake the two ExtensionAPI methods the bridge uses.
const tools: Record<string, any> = {};
const commands: Record<string, any> = {};
const piStub = {
  registerTool(def: any) {
    tools[def.name] = def;
  },
  registerCommand(name: string, def: any) {
    commands[name] = def;
  },
};
(piV1BridgeExtension as any)(piStub);

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

check("tool-registered", tools["codemode"]?.name === "codemode", Object.keys(tools));
check("command-registered", typeof commands["pi-v1-status"]?.handler === "function");

// Fake session ctx: one echo tool backed by ctx.executeTool.
const ctxStub = {
  tools: [{ name: "echo", description: "Echoes input.", parameters: { type: "object" } }],
  executeTool: async (name: string, args: unknown) => ({
    toolCall: { id: "call-1/1" },
    isError: false,
    result: { content: [{ type: "text", text: `echo:${JSON.stringify(args)}` }] },
  }),
};

const out = await tools["codemode"].execute(
  "call-1",
  { code: `const e = await tools.echo({ a: 1 }); return e + "|done";` },
  undefined,
  undefined,
  ctxStub,
);
check(
  "bundled-codemode-runs",
  typeof out?.content?.[0]?.text === "string" && out.content[0].text.includes("echo:") && out.content[0].text.includes("|done"),
  out,
);

// Discovery globals resolve against ctx.tools.
const out2 = await tools["codemode"].execute(
  "call-2",
  { code: `return await describeTool("echo");` },
  undefined,
  undefined,
  ctxStub,
);
check("bundled-describeTool", out2?.content?.[0]?.text?.includes("Echoes input."), out2);

console.log(`bundle smoke done: ${pass} passed`);
