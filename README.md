# omp-codemode

Codemode tool for [oh-my-pi](https://github.com/earendil-works/pi): run JavaScript
that calls host tools inside a QuickJS sandbox, plus an experimental durable
journal for kill-and-resume script runs. Built on `@earendil-works/pi-codemode`
(QuickJS + WASI worker).

## STATUS — read before installing

**Parked on the omp 18.12.6 platform wall.** An extension-registered tool cannot
invoke host tools on omp 18.12.6: the extension `pi` surface exposes `exec` and
tool enumeration only, so `codemode` scripts bind **zero tools** regardless of
bridge code (diagnosis and binary evidence in
`docs/integration-result.md` §8). Until a future omp restores a nested-invoke
API (`ctx.executeTool` / `reachesTools`), this plugin is **available-inert**:
code on disk, not live.

Two consequences follow from that:

- **Codemode core is covered natively today.** omp's built-in `eval` tool
  (approval-gated, ON by default) already runs one JS script that calls tools in
  parallel and filters large output — the vanilla Pi v1.4 codemode function.
  See `docs/eval-probe.md` for the gate check + live probe, and
  `docs/final-parity.md` for the full vanilla→omp function table.
- **Durable is experimental and OFF by default.** `durable_run` /
  `durable_resume` / `durable_status` register only with `PI_V1_DURABLE=1`.
  The journal semantics (commit-before-show, seq+name+argsHash replay,
  exactly-once resume) are proven by `test/smoke-durable.ts`; wiring them into a
  live session waits on the same platform fix.

## Install

Via plugin manager (from the repo root):

```sh
omp plugin install <repo-url>
```

or manually:

```sh
git clone <repo-url> omp-codemode
cd omp-codemode
bun install
bun run build
```

Then enable the extension entry (`extensions/index.ts` re-exports the
prebuilt `dist/omp-codemode.js` bundle — the omp loader cannot resolve bare
third-party imports from source, so the bundled dist is the load path):

```json
{ "extensions": ["+extensions/omp-codemode"] }
```

depending on your omp extensions allowlist layout; see your `settings.json`.

## Usage

- `codemode` tool: one `{ code }` string — raw JavaScript run as an async
  function body in the sandbox. `await tools.<name>(args)`, top-level
  `await`/`return`, `store()`/`load()` per-branch persistence, `searchTools` /
  `describeTool` / `describeNamespace` discovery globals.
- Durable (opt-in): `PI_V1_DURABLE=1` registers `durable_run`,
  `durable_resume`, `durable_status` alongside `codemode`. Journals live under
  `PI_V1_DURABLE_DIR`, else `~/.omp/agent/durable/`.
- `pi-v1-status` command: reports whether durable is enabled.

## Development

```sh
bun install
bun run build   # dist/omp-codemode.js + dist/pi-worker.js
bun run test    # codemode 5, bundle 4, durable A (kill) + B (resume, 14)
```

Bundle recipe (both required; the worker bundle exists because the stock
pi-codemode worker's bare `quickjs-wasi` import cannot resolve under the omp
loader — `SPIKE.md` has the full story):

```sh
bun build src/index.ts --outfile dist/omp-codemode.js --target bun
bun build node_modules/@earendil-works/pi-codemode/dist/runtime/worker.js --outfile dist/pi-worker.js --target bun
```

`src/core.ts` resolves both runtime files relative to the project root, valid
from `src/` and `dist/`. Never commit `node_modules/`, `test/tmp-*/`, or
`*.log`; `bun.lock` IS committed intentionally for reproducible installs.

## Docs

- `SPIKE.md` — tool-invocation contract + loader findings.
- `docs/integration-result.md` — omp-level wiring and live proof.
- `docs/final-parity.md` — vanilla Pi v1.4 → omp function table.
- `docs/eval-probe.md` — native `eval` gate check + live probe.

## License

MIT — see `LICENSE` (`omp-codemode contributors`).
