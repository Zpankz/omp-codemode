# 05 — pi-v1-bridge integration result (omp-level wiring + live proof)

Date: 2026-10-25. omp v18.12.6 (bun-compiled binary).
Bridge: `~/.omp/agent/pi-v1-bridge/` (`src/core.ts`, `src/durable.ts`, `src/index.ts`
→ `dist/pi-v1.js`), shim `~/.omp/agent/extensions/pi-v1.ts` re-exports the bundle.

## 1. Settings diff (exactly +1 line)

Backup: local scratch copy (not published).
`python3 -m json.tool ~/.omp/agent/settings.json` → valid. `diff backup current`:

```diff
36c36,37
<     "+extensions/<an-unrelated-local-extension>.ts"
---
>     "+extensions/<an-unrelated-local-extension>.ts",
>     "+extensions/<this-bridge>.ts"
```

`defaultTools` untouched (`["+codemode"]`, now live instead of stale). No other
config files carry an extensions allowlist (single settings.json; verified — no
duplicate call site needing the same change).

## 2. Dist freshness + library smokes (all PASS, no test edits)

`dist/pi-v1.js` (21:14:15) is newer than `src/index.ts` (21:14:12), `core.ts`,
`durable.ts` — no rebuild needed. (`package.json` has no build script; canonical
rebuild if sources change: `cd ~/.omp/agent/pi-v1-bridge && bun build
src/index.ts --outfile dist/pi-v1.js --target bun`.)

- `bun test/smoke-codemode.ts` → 5 PASS (`two-tools-combined`,
  `failure-caught-allSettled`, `thrown-error-ok-false`, `store-round-trip`,
  `globals-helper`), `smoke done: 5 passed`, EXIT 0.
- `bun test/smoke-bundle.ts` → 4 PASS (`tool-registered`, `command-registered`,
  `bundled-codemode-runs`, `bundled-describeTool`), EXIT 0.
- `bun test/smoke-durable.ts A` → process killed on call 3 as designed
  (EXIT 137); `B` → 14 PASS (`crash-left-two-executions`, `resume-ok`,
  `resume-result`, `each-step-exactly-once`, `counter-three`, `status-finished`,
  `finished-resume-same-result`, `finished-resume-no-reexec`,
  `script-error-ok-false`, `error-status-keeps-call`, `error-log-once`,
  `error-made-one-execution`, `error-resume-same-result`,
  `error-resume-no-reexec`), `LOG CONTENTS: ["STEP1","STEP2","STEP3","STEP9"]`,
  `SMOKE-DURABLE PASS`, EXIT 0.

## 3. Fresh-process load proof (PASS with pre-existing caveat)

`timeout 90 omp -p 'reply OK' --no-session` (started 2026-10-25, ran 90.27s,
EXIT 124 — model-turn timeout):

- Only extension error: `Failed to load extension
  <an unrelated local extension>: Cannot find package 'typebox'` — pre-existing
  (same class as documented in local research notes, not published;
  `typebox` is a bridge/bundle concern, unrelated to this change; noted, not fixed).
- **No `Failed to load extension` mentioning pi-v1, no pi-v1 stack trace.**
- `omp plugin doctor` / `omp plugin list` cover plugins only (2 ok, 2 warnings,
  0 errors — `package_manifest not created`, orphan plugin entry), not
  extensions; no extension-listing command exists in `omp --help`, so load
  evidence rests on the fresh-process probe above.

## 4. Live codemode proof — PARTIAL: tool registers and is callable, execution fails live

### Attempt 1 (2026-10-25T11:19:05Z → 11:21:09Z, 123.55s, EXIT 0)

Prompt asked for one `codemode` call running `tools.read` on settings.json plus
`tools.bash` echoing `CODEMODE_LIVE`. Model used `codemode` exactly once; the
call **failed before script execution on the missing `quickjs-wasi` runtime**
(not retried). `theme: dark` and `echo: CODEMODE_LIVE` in the reply were
grounded via direct `read`/`bash` fallback — **not** via codemode, so full live
proof is **not** claimed.

### Attempt 2 — verbatim error (2026-10-25T11:22:01Z → 11:23:12Z, 71.18s, EXIT 0)

Prompt: call `codemode` once with `return "PING"`, reply with the complete
unedited tool text. Verbatim reply:

```text
Error (sandbox): error: Cannot find package 'quickjs-wasi' from '~/.omp/agent/pi-v1-bridge/node_modules/@earendil-works/pi-codemode/dist/runtime/vm.js'
```

```text
theme: dark

EXIT:0
```

### Diagnosis (no src touched)

- Both runtime files **exist on disk**: `node_modules/quickjs-wasi/quickjs.wasm`
  and `node_modules/@earendil-works/pi-codemode/dist/runtime/worker.js`
  (plus `vm.js`) — verified by listing.
- So this is a **module-resolution failure at omp extension runtime, not a
  missing file**: the externally-loaded worker (`workerUrl` in `core.ts`
  `runtimeFiles()`) pulls in `vm.js`, whose bare import `quickjs-wasi` the omp
  extension loader (jiti-class, cf. the identical `typebox` failure from an
  unrelated local extension) cannot resolve — while the same path resolves
  fine under `bun test` (library smokes pass). Likely fix directions (untouched, for the
  owning slice): bundle/inline the worker, ship wasm bytes instead of a path,
  or resolve `quickjs-wasi` to an absolute file URL before handing it to the
  sandbox. `dist/pi-v1.js` + shim verified blameless (tool registers, ctx
  plumbing works — the model invoked it twice with well-formed calls).

## 5. Live durable proof — SKIPPED (gated)

Per the assignment (`only if step 4 succeeded`): step 4 did not succeed
(codemode execution fails live, and `durable_run` executes through the same
sandbox), so no `durable_run`/`durable_resume` live turn was attempted.
Journal dir `~/.omp/agent/durable/` exists (empty); no `durable-live.log` was
created. Recommend re-running this step after the `quickjs-wasi` resolution fix:
prompt omp to `durable_run` id `live1` a script echo-appending `LIVE_STEP` to
`durable-live.log` twice with different args, check journal at
`~/.omp/agent/durable/live1.jsonl`, then `durable_resume` the id and verify no
duplicate lines.

## 6. Regression (no new errors)

Three post-change fresh processes (`reply OK` trivial prompt; two codemode
probes above) all show the **same profile as the pre-change baseline**
(local research notes, not published: model turns stall ~120s): only the
pre-existing `typebox` warning from an unrelated local extension, zero pi-v1
load errors, zero pi-v1 stack traces. Settings diff remains exactly the +1 line from §1.

## 7. How to rebuild the bundle

```sh
cd ~/.omp/agent/pi-v1-bridge && bun build src/index.ts --outfile dist/pi-v1.js --target bun
```

(`package.json` defines no build script; this is the exact canonical command.)
Re-verify with the three smoke commands in §2 afterward. Never edit files under
`test/` to pass — fix `src/` and rebuild.

## 8. Worker-bundle + reachesTools round (2026-10-25)

Fixes applied after the §4 diagnosis. No `settings.json` / `AGENTS.md` / `test/` changes:

- `src/core.ts` `workerUrl` → bundled `dist/pi-worker.js`: stock pi-codemode worker entry bundled with `bun build node_modules/@earendil-works/pi-codemode/dist/runtime/worker.js --outfile dist/pi-worker.js --target=bun` (~101KB, sole import `worker_threads`, zero bare third-party imports). The host passes the compiled wasm via `workerData`, so the worker needs no wasm file. `quickjs-wasi@3.6.2` added as a direct dep (was transitive-only).
- `src/index.ts`: added `reachesTools: () => "all"` on the `codemode` registration (upstream pi-1.4 contract: callable-from-tools is scoped by `reachesTools`) — first suspect for the empty tool set.
- `dist/pi-v1.js` + `dist/pi-worker.js` rebuilt from `src/`; `test/smoke-codemode` 5/5 + `test/smoke-bundle` 4/4 PASS on the final tree. `SPIKE.md` records both findings.

### Live re-probe A — worker fix only (2026-10-25, EXIT 0, ~91s)

Prompt asked for exactly one `codemode` call running `tools.read` on settings.json plus `tools.bash` echoing `CODEMODE_LIVE`. Full log: `codemode-live2.log`. Verbatim reply:

```text
Failed to load extension <an unrelated local extension>: Cannot find package 'typebox' [path redacted]…
Working...
Codemode did not return theme + echo — stopped, no further calls.

What happened:
- Call 1 (per your spec): script called `tools.read({ path: "~/.omp/agent/settings.json" })` then `tools.bash({ command: "echo CODEMODE_LIVE" })`. Failed before `bash` ran: `tools.read does not exist`.
- Call 2 (my error — broke your "exactly once"): discovery-only script. Result: `toolKeys: []`, `searchTools("read…") → []`, `searchTools("bash…") → []`.

So the sandbox exposed no bound `tools.read` / `tools.bash`, and no theme or echo came back from codemode. I did not run `read`/`bash` directly to substitute — that would misrepresent a non-codemode result as the codemode result.

To get this done, the codemode tool binding needs `read`/`bash` exposed (or documented `searchTools` names) — then a single script doing both calls in parallel can return `{ theme, echo }`.
```

Progress vs §4: the `quickjs-wasi` sandbox error is **gone** — scripts now execute. Remaining failure is an empty tool set, not resolution.

### Live re-probe B — with `reachesTools: () => "all"` (2026-10-25, EXIT 0, ~101s)

Same prompt. Full log: `codemode-live3.log`. Verbatim reply:

```text
Failed to load extension <an unrelated local extension>: Cannot find package 'typebox' [path redacted]…
Working...
Did not complete as asked — reporting honestly.

I used `codemode` twice, breaking your "exactly once" constraint:
1. First call: `tools.read` / `tools.bash` → `tools.read does not exist`
2. Second call (diagnostic): tried direct calls + discovery fallback. Result:
   - `directReadErr`: `tools.read does not exist. Available: .`
   - `directBashErr`: `tools.bash does not exist. Available: .`
   - `ALL_TOOLS`: `[]`
   - `searchTools("read")` → `[]`, `searchTools("bash")` → `[]`

So the sandbox bridge exposes no host tools. Different names/arg shapes can't fix it — there is nothing bound to call.

Therefore via `codemode`:
- `theme`: could not be obtained
- `echo`: could not be obtained (`CODEMODE_LIVE` never ran in-sandbox)

I'm stopping here per the empty-tool evidence — a third `codemode` call would fail the same way.
```

### Diagnosis: omp platform wall (binary evidence, no src changes beyond the above)

- `reachesTools` appears **zero** times in the local binary-strings analysis (not published); `executeTool` appears only as a WebMCP list entry and a model-context method — neither reachable from an extension tool.
- Extension tool executes receive `this.runner.createContext(undefined, { toolName, context, signal, … })` (:815446-47); that context object has **no** `tools` / `executeTool`, and `invokeTool` is defined only for native-tool delegation chains (`n !== undefined && this.hasNativeTool(n.toolName)`, :814773-78) — false for extension tools.
- The extension `pi` API enumerates (`getAllTools`, :1010007-08) but cannot invoke; its only execution affordance is `exec` (shell, :1010003-04).
- The pi-1.4 nested-call surface (`ctx.tools` / `ctx.executeTool` / `reachesTools`, removed with codemode in omp 18.10.3) is absent from omp 18.12.6. So an extension-registered tool **cannot invoke host tools on this omp version** — scripts run with zero bound tools regardless of bridge code. Live codemode + durable proof stays blocked pending a platform decision (restore a nested-invoke API, or re-scope the bridge to non-tool means such as `pi.exec`).

## 9. How to disable

Remove the `"+extensions/<this-bridge>.ts"` line from the `extensions` array in
`~/.omp/agent/settings.json` (keeping the trailing-comma style valid JSON),
or equivalently `diff`-revert against the local scratch backup (not published).
No bundle/shim deletion required (unreferenced files are inert); `defaultTools`
needs no change.

## 10. AGENTS.md

Section `## pi-v1 bridge (codemode + durable)` appended to
`~/.omp/agent/AGENTS.md` from local research notes (not published; adapted to
`##` heading level; `models.*` + chord rows included).

## 11. Parked + disabled (2026-10-25 — auto-selected on ask timeout, NOT an active user choice; user may override)

Post-§8 changes: `src/index.ts` gates `registerDurable` behind
`PI_V1_DURABLE=1` (proven on the bundle: default registers `codemode` only;
opt-in adds the three `durable_*` tools); `dist/pi-v1.js` rebuilt; full
smokes re-run on the final tree — codemode 5/5, bundle 4/4, durable B 14/14
PASS (A exit 137 by design). `EXCLUDED_TOOLS` mirrored in `index.ts` and
`durable.ts` (all four names).

Platform wall (verified 3 ways: 2 live model turns showing `ALL_TOOLS: []`,
`createContext(undefined, …)` at strings :815447, `invokeTool` guarded by
`hasNativeTool` at :814773, zero `reachesTools` hits, extension `pi` surface
= `exec`/`getAllTools` only at :1010003-11): an extension-registered tool
**cannot invoke host tools on omp 18.12.6**, so live codemode/durable proof
is unachievable without a platform change. User chose park + disable:
`settings.json` reverted byte-identical to a local backup (not published)
(JSON-validated); `AGENTS.md` section replaced with a PARKED note;
bridge code + docs kept on disk. Re-enable path: restore the allowlist
line IF a future omp restores `ctx.executeTool` or equivalent — then rerun
§4 live proof before claiming parity.

Corrections to earlier claims: (a) the disable was never actively chosen —
the `ask` dialog timed out and fell back to the recommended option; treat
parked status as provisional. (b) The 45s post-rollback `omp -p` run is NOT
a clean exit: it hit the timeout (pre-existing ~120s model stall); `exit: 0`
was `head`'s, not omp's. It only proves no pi-v1 load error (extension
unloaded).

Alternative parity path (strings-verified, NOT live-probed): omp's native
gated `eval` tool (approval=`exec`, strings :967023-36) already wires
per-tool `evalTools` opt-in (`:966957`, default true) plus an `eval`
setting (`o8.get(settings)`, :967055) and eval preludes
(`getEvalPreludes`, :990399). I.e. "one script calls ≥2 session tools"
may already work natively via `eval` — the advisory's `callTool` at
:961492 is the *browser* scope's, not eval's, so eval's exact invoke
mechanism is unverified. If revisited: enable `eval`, attempt one live
eval script calling 2 tools, and scope any port to what eval lacks
(QuickJS sandbox, declarations, `store`, `models.*`) instead of
rebuilding tool-calling. Approval caveat for any re-enable: nested
`ctx.executeTool` calls may bypass the agent-loop approval gates that
direct calls hit — compare nested vs direct `bash` under an
approval-requiring mode before shipping.

## 12. Resolution (2026-10-26)

Probe (§8: no `ctx` tool path; `invokeTool` key present-but-undefined)
→ source patch (`patches/oh-my-pi-v18.12.6-ctx-tools.patch`:
`ctx.tools` / `ctx.executeTool` on the extension `ctx`, resolved through
the eval bridge's ACP permission proxy — nested calls hit the same
approval gate as `eval`; explicit deny blocks even under
`--auto-approve`; extension-runner suite 106/106 PASS including a
per-call gate test) → live proofs (patched binary: `codemode`
`{ theme: dark, marker: CODEMODE_LIVE }` in one call; `durable_run`
id `durable-live-02` → `durable-done`, `durable_status` finished/ok,
`durable_resume` replayed without re-executing the write step — marker
file holds a single `STEP` line) → install/publish (patched
`dist/omp` installed over the existing binary with backup kept;
this repo publishes the patch plus README Install § patched-omp).
`omp update` overwrites the patched binary — re-apply the patch and
rebuild after updating.
