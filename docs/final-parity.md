# 06 — Final parity: vanilla Pi v1.4 → omp 18.12.6 (+ parked pi-v1-bridge)

Date: 2026-10-25. Scope: every vanilla Pi v1.4 user-facing function attributable to
pi-codemode / pi-durable / chord, per the feature table in local research notes (not published).
Each row: vanilla function | omp equivalent | evidence | status.
Statuses: `covered-native` | `available-inert` (parked bridge) | `partial` |
`parity-by-absence` | `none-intentional`.

## Parity table

| # | Vanilla Pi v1.4 function | omp equivalent | Evidence | Status |
|---|---|---|---|---|
| 1 | `codemode` core: model writes JS calling other tools; single `{ code }` param; parallel fan-out; large-output filtering (research notes; upstream `tool.js:32,36-40,49-51`) | omp native `eval` tool (approval=`exec`, ON by default): one JS script calls tools in parallel and filters large output | PROVEN in-session 2026-10-25 (parent session): one JS script, `Promise.all(tool.read settings.json, tool.bash echo CODEMODE_LIVE)`, returned theme dark + CODEMODE_LIVE. omp side: `name = "eval"`, `approval = "exec"`, `loadMode = "essential"` (research notes, strings `:967023-36`); `config.yml` `eval:` keys are autoBackground only — no enable gate; eval ON by default per `eval-probe.md` gate check (absent from `--help` default-enabled roster, documentary only). Fresh-process: attempt 1 proved 2 parallel calls + in-script CODEMODE_LIVE detection but theme extraction failed in-script (PARSE_ERROR); attempt 2 (regex extraction) in `eval-probe.md` | covered-native (in-session; fresh-process attempt 2) |
| 2 | Script globals: `tools`, `ALL_TOOLS`, `text`/`image`/`exit`/`store`/`load`, `console`, `models` (research notes; upstream `tool.js:1-21,53-64`; `docs/codemode.md`) | `eval` uses `tool.<name>` (untyped) instead of vanilla's typed `tools.*` declarations | omp eval-bridge `callTool` exists (research notes, strings `:961492-95`) but `checkpoint`/`rewind` explicitly cannot run through it (research notes, strings `:961319-20`); typed `tools.*` declarations have no omp counterpart (bridge design, integration-result.md §8). Vanilla globals as documented in research notes | partial (untyped call path, exclusions apply) |
| 3 | Exposure filtering (`direct`/`model-only`/`codemode`/`deferred`/`hidden`) + `getCodemodeCallableTools` / `prepareCodemodeLoadout` `on`/`only` (research notes; upstream `tool.js:82-85,198-241`; `types.d.ts:384-395`; `settings.md:43-44`; `tool.js:66`) | No omp counterpart: no exposure kinds, no `only` mode, no `inlineBudget` | omp tools carry `approval = "exec"\|"read"…` and gated tools need settings opt-in; no exposure kinds (research notes); `codeMode: auto` key is dead config (research notes). Mode effectively `on`-only by absence | partial |
| 4 | `searchTools` / `describeTool` / `describeNamespace` / `ALL_TOOLS` + `tool_search` BM25 tool (research notes; upstream `tool-search/tool.js:11,159`; `codemode.md:50-52`; `cli.md:180-182`) | Not ported — intentionally: omp has no deferred-exposure model; every active tool is already enumerated | Research notes: extension `pi` API enumerates via `getAllTools`/`getActiveTools` (strings `:981070-72`, `:1010007-08`); local extensions use only `pi.on` + `registerCommand`. Research-notes verdict (unchanged) | none-intentional |
| 5 | `models.classify()` / `models.generateImages()` in scripts with session credentials, usage → session cost (research notes; upstream `codemode.md:60-95`; CHANGELOG 1.4.0:7,16; 1.0.0:340) | omp separates these: `judge()`/`completion()` (registry-backed, error paths in binary) and gated `generate_image` model tool — not in-script `models.*` globals | Research-notes verdict: catalog feasible-now via `ctx.modelRegistry.getAvailable()` + `hasConfiguredAuth`; `classify` feasible-hard behind a spike; `generateImages` deferred (no registry target; do not fake with direct provider call). omp strings: `generate_image` `:871031-34`, gated `:712665-73`; zero hits for `generateImages`/`models.classify`/`getAvailableOfType` (research notes). In-script `models.*` unbound | partial |
| 6 | MCP default `codemode` exposure (`codemode-deferred` alias, background connect, servers hidden from prompt, callable from scripts) (research notes; upstream `cli.md:132-138`; CHANGELOG 0.99.0:389-391) | No alias/hiding ported: omp MCP tools are first-class invokables called by real names | Research notes: MCP via `callMCP` / `canonicalMCPToolNameCandidates` (strings `:1266669-71`); no hiding/alias machinery. Background-connect semantics not a bridge concern | partial (by design) |
| 7 | Worker admission: 2 live workers, queue ≤ 60 s, `PI_CODEMODE_MAX_WORKERS` (research notes; CHANGELOG 1.4.0:10; 1.3.0:83-84) | No omp worker substrate; `eval` has no `PI_CODEMODE_MAX_WORKERS` cap | omp has no worker substrate (research notes, pre-bridge wording). Bridge implemented admission via pi-codemode runtime but is PARKED (integration-result.md §8/§11) — available-inert, not live | available-inert (bridge parked) |
| 8 | `store()` per-branch persistence / `codemode-store` session entries (research notes; upstream `tool.js:33-34`; `codemode.md:56`) | No omp store primitive; `eval` has no `store()` | No store primitive (research notes). Bridge kept an in-memory store passed via `runCodemode` opts; persistence to the session gated on extension API. PARKED (integration-result.md §8/§11) — available-inert | available-inert (bridge parked) |
| 9 | QuickJS/WASM sandbox isolation (research notes: "run as an async function body in a QuickJS sandbox: No Node, file system, network, or timers"; upstream `tool.js:49-51`) | omp `eval` runs on host Bun, NOT sandboxed; isolation replaced by `approval=exec` gating | Vanilla sandbox claim (research notes) verbatim quote; omp `eval` `approval = "exec"` (research notes). No QuickJS/sandbox in binary (research notes: zero `QuickJS`/`quickjs` hits). Bridge `CodemodeSandbox` from pi-codemode 1.4.0 exists on disk (`node_modules/quickjs-wasi/quickjs.wasm`, integration-result.md §4) but PARKED (integration-result.md §8/§11) | available-inert (bridge parked); native path unisolated-by-design |
| 10 | `--tools` / `--exclude-tools` + `defaultTools` (defaults `read,bash,edit,write`) (research notes; upstream `cli.md:119-138`; `settings.md:42,46-53`) | No CLI change: omp tool flags exist; stale `+codemode` entry now refers to parked bridge, not live tool | omp flags exist; `defaultTools: ["+codemode"]` was stale while no `codemode` tool registered (research notes). With bridge parked + disabled (integration-result.md §11: settings reverted byte-identical to backup), entry is inert again | none-intentional (no CLI change) |
| 11 | 17 built-in slash commands (research notes; upstream `slash-commands.md:7-53`) | Out of scope: omp command surface is its own (`registerCommand`) | Research notes (unchanged) | none-intentional |
| 12 | Session CLI flags + JSONL persistence, own `session-manager.ts` (research notes; upstream `cli.md:86-107`; `session-format.md:8-14`) | omp equivalents: per-cwd-slug `<ts>_<uuid>.jsonl` + sqlite index; `-c`/`-r`/`--restore`/`--session-dir`/`--no-session`; copy-on-resume fork | Research notes (flags; session layout, `branchWithSummary` on rewind path). Bridge keeps omp sessions; `durable_run` journal dir separate and complementary, not a session replacement (research notes). Vanilla sessions persist via coding-agent's own backend, NOT pi-durable (research notes) | parity-by-absence (nothing to port) |
| 13 | Durable harness (`Harness.open`, conversations/turns committed, resume-after-death, child tasks, documents, storage backends) — internal-only package API, NO CLI surface (research notes; pi-durable README) | No vanilla user function to port. omp equivalents for the durable-*user-visible* parts: session JSONL + `--continue`/`--resume`/`--restore` (research notes), `checkpoint`/`rewind` context tools (research notes, gated `checkpoint.enabled`) | No dep edge from CLI to pi-durable; CLI sessions via own `session-manager.ts` (research notes). omp has no Harness/memo/workflow-engine strings (research notes). Bridge `durable_run`/`durable_resume` = omp-side journal-semantics equivalent (commit-before-show, seq+name+argsHash replay, divergence truncation) — NOT a `Harness` port (no conversations/tasks/documents/storage backends; no chord document layer) (research notes). Bridge journal engine experimental, OFF by default (`PI_V1_DURABLE=1`), kill/resume smoke-proven at library level; PARKED with the rest (integration-result.md §11) | parity-by-absence (no CLI surface in vanilla); bridge engine available-inert |
| 14 | chord object/RPC/hot-reload substrate — ZERO CLI surface; vanilla removed its chord dependency in 1.2.0 (research notes; CHANGELOG 1.2.0:165-166) | omp `task` = agent-turn delegation fan-out (not chord); chord-shape strings absent from omp binary | Research notes: `chord` hits are keyboard-chord only; no object substrate. Research-notes verdict: omp `task` vs chord `task` are different mechanisms (agent-turn delegation vs per-object background fiber) — complementary, not redundant. Research notes: chord survives only transitively as pi-durable's document-state layer. Research notes: omp action = none | parity-by-absence |

## Codemode extras eval lacks (bridge covers, PARKED)

The bridge at `~/.omp/agent/pi-v1-bridge` implements the vanilla extras the
native `eval` path does not: QuickJS/WASM sandbox isolation (integration-result.md §4: `quickjs.wasm`
+ `worker.js` on disk), typed `tools.*` declarations, `store()` per-branch
persistence, in-script `models.classify`/`generateImages`, worker cap
`PI_CODEMODE_MAX_WORKERS`. Status of all of it: **available-inert** — code on
disk, NOT loaded. Reason: omp platform wall — an extension-registered tool
cannot invoke host tools on omp 18.12.6 (integration-result.md §8 diagnosis: zero `reachesTools`
hits; `createContext(undefined, …)` strings `:815447`; `invokeTool` guarded by
`hasNativeTool` `:814773-78`; extension `pi` surface = `exec`/`getAllTools`
only `:1010003-11`; scripts run with zero bound tools regardless of bridge
code). Parked + disabled 2026-10-25 (integration-result.md §11: `registerDurable` gated behind
`PI_V1_DURABLE=1`; settings reverted byte-identical to a local backup (not
published); AGENTS.md now carries the eval-first `## pi-v1 parity` section, bridge referenced as parked). Re-enable
path: restore the allowlist line IF a future omp restores `ctx.executeTool` or
equivalent — then rerun the §4 live proof before claiming parity.
Parking was auto-selected on ask-timeout, NOT an active user choice; user may
override (integration-result.md §11).

## tool_search / deferred MCP discovery

Omp has no deferred-exposure model, so there is nothing for BM25 discovery to
retrieve: every active tool is already enumerated (research notes:
`getAllTools`/`getActiveTools`). Stated as research notes report it;
no omp search-surface beyond this is claimed. Vanilla `tool_search` intentionally
not ported (research notes: `none-intentional`).

## Verdict

Initial request ("integrate the three packages so omp performs the same
functions as vanilla Pi since v1.0") assessed function-by-function against research notes:
**the only user-facing v1.0+ function is codemode** (codemode itself
a 0.99.0 feature, v1.0–v1.4 refinements only), and it is covered
natively by omp's `eval` tool (in-session proof 2026-10-25 above;
fresh-process confirmed in `eval-probe.md` attempt 2 (script itself returned `{theme: "dark", live: true}`, EXIT 0)) plus the parked
bridge for the sandbox extras (QuickJS isolation, typed declarations, `store()`,
in-script `models.*`, worker cap — available-inert per integration-result.md §8/§11).
**Durable and chord have no vanilla CLI user function to port** (research notes:
no dep edge, own `session-manager.ts` backend; chord removed in 1.2.0) — omp
session JSONL + `--continue`/`--resume`/`--restore` and `task` fan-out are the
standing equivalents (research notes). Net: no open user-function gap; remaining
items are platform-gated (nested-invoke API) or explicitly out of scope.
