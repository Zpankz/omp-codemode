# SPIKE: omp tool invocation for the codemode bridge

Types: `src/pica/package/dist/core/extensions/types.d.ts` (pi-coding-agent 1.4.0; omp 18.x is the same lineage).
- Enumerate declarations: `pi.getAllTools(): ToolInfo[]` (types.d.ts:1284; `ToolInfo` = metadata only, no execute fn, types.d.ts:1577).
- Invoke: `await ctx.executeTool(name, args, { signal })` → `Promise<AgentToolCallOutcome>` (types.d.ts:280), where `ctx` is the 5th arg of `ToolDefinition.execute(toolCallId, params, signal, onUpdate, ctx)` (types.d.ts:514) and `ctx.tools` is the callable set backing it (types.d.ts:271,1677).
- Register: `pi.registerTool({ name, label, description, parameters (TypeBox, `Type` from `"typebox"`), execute })` (types.d.ts:1229,453-514). TypeBox pin: `typebox@1.3.27` (pica package.json deps).
- Outcome read (mirrors upstream `toScriptValue`, pica `extensions/codemode/execute.js:417-425): `outcome.result.structuredContent ?? textOf(outcome.result.content)`; `outcome.isError` → throw Error(text) into the script.
- Callable-set refinement: bridge enumerates `ctx.tools` (AgentTools, carry `outputSchema`) at execute time, excluding `{codemode, durable_run, durable_resume}` against self-recursion; `pi.getAllTools()` is metadata-only and lacks `outputSchema`.
- Discovery globals (`searchTools`/`describeTool`/`describeNamespace`) are NOT prelude built-ins (prelude gives only `tools`, `ALL_TOOLS`, `text/image/exit/console`, `store/load`); upstream registers them as sandbox `globals` (pica `extensions/codemode/execute.js:592-640) — bridge does the same via `runCodemode(..., { globals })`.
- Loader finding (omp 18.x): the extension pipeline is Bun.plugin-based, not
  jiti, and bare third-party imports fail at load (`Cannot find package
  'typebox' imported from .../pi-v1-bridge/...` despite `node_modules`
  existing; same class as a pre-existing failure from an unrelated local extension). Fix:
  `bun build src/index.ts --outfile dist/pi-v1.js --target=bun` (~63KB, zero
  bare imports except node builtins); `extensions/pi-v1.ts` re-exports the
  bundle. `core.ts` passes explicit `wasm` (`loadQuickJSWasm` of the installed
  `quickjs-wasi/quickjs.wasm`) + `workerUrl` — the documented-for-bundlers
  options — paths resolved via `../node_modules`/`../dist`, valid from `src/`
 * and `dist/`. 2026-10-25 live fix: the installed `worker.js` was NOT enough —
 * its transitive bare import `quickjs-wasi` (in `runtime/vm.js`) fails under
 * the omp loader exactly like `typebox` did. Fix: `bun build
 * node_modules/@earendil-works/pi-codemode/dist/runtime/worker.js --outfile
 * dist/pi-worker.js --target=bun` (~101KB, sole import is `worker_threads`);
 * `core.ts workerUrl` now points at `../dist/pi-worker.js`. The worker needs
 * no wasm file: the host passes the compiled module via `workerData`.
 * `quickjs-wasi@3.6.2` added as a direct dep (was transitive-only).
  BridgeTool gained optional `spread?: boolean` (multi-arg globals only).
  2026-10-25 live fix #2: scripts saw ZERO tools (`tools.read does not exist`,
  `searchTools("read") → []`) because omp scopes `ctx.tools` by the calling
  tool's `reachesTools(input)` (upstream docs `extensions.md`: callable =
  callable-from-tools). Fix: `reachesTools: () => "all"` on the `codemode`
  registration (upstream returns "all" for search/list scripts; ours always
  search, so "all" unconditionally).
