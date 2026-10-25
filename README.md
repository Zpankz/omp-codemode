# omp-codemode

Codemode tool for [oh-my-pi](https://github.com/earendil-works/pi): run JavaScript
that calls host tools inside a QuickJS sandbox, plus an experimental durable
journal for kill-and-resume script runs. Built on `@earendil-works/pi-codemode`
(QuickJS + WASI worker).

## STATUS — read before installing

**Codemode WORKS with the bundled patch applied to omp v18.12.6.**
`patches/oh-my-pi-v18.12.6-ctx-tools.patch` exposes `ctx.tools` /
`ctx.executeTool` on the extension `ctx`, resolved through the eval bridge's
ACP permission proxy — nested calls hit the same approval gate as `eval`;
an explicit deny blocks even under `--auto-approve`.
Live-verified on the patched binary: `codemode` returned
`{ theme: dark, marker: CODEMODE_LIVE }`, and `durable_run` /
`durable_resume` proved exactly-once resume (single `STEP` line after resume).
**UNPATCHED omp: zero tools bound (parked)** — diagnosis and binary evidence
in `docs/integration-result.md` §8.

Two notes follow from that:

- **`omp update` overwrites the patched binary** — re-apply the patch and
  rebuild after updating (see Install § patched-omp).
- **Codemode core is covered natively today.** omp's built-in `eval` tool
  (approval-gated, ON by default) already runs one JS script that calls tools in
  parallel and filters large output — the vanilla Pi v1.4 codemode function.
  See `docs/eval-probe.md` for the gate check + live probe, and
  `docs/final-parity.md` for the full vanilla→omp function table. This is still
  true with no binary patch needed.
- **Durable is experimental and OFF by default.** `durable_run` /
  `durable_resume` / `durable_status` register only with `PI_V1_DURABLE=1`.
  The journal semantics (commit-before-show, seq+name+argsHash replay,
  exactly-once resume) are proven by `test/smoke-durable.ts` and by the live
  exactly-once probe in `docs/integration-result.md` §12.

## Install

### Patched omp (required for host-tool calls)

```sh
git clone https://github.com/can1357/oh-my-pi
cd oh-my-pi && git checkout v18.12.6
git apply /path/to/omp-codemode/patches/oh-my-pi-v18.12.6-ctx-tools.patch
bun install
bun --cwd=packages/natives run build
bun --cwd=packages/coding-agent run build
cp ~/.local/bin/omp ~/.local/bin/omp.upstream-18.12.6  # backup existing binary
cp packages/coding-agent/dist/omp ~/.local/bin/omp && chmod +x ~/.local/bin/omp
omp --version  # → omp/18.12.6
```

### Plugin

Tested end-to-end on patched omp 18.12.6 (2026-10-26): install registers the
`codemode` tool, a fresh `omp -p` session executed a script reading
settings.json plus `echo CODEMODE_LIVE` → `{ theme: dark,
marker: CODEMODE_LIVE }` through the sandbox, and uninstall restored
`settings.json` byte-identical.

```sh
git clone https://github.com/Zpankz/omp-codemode
cd omp-codemode && bun install && bun run build
omp plugin install "$PWD"        # links the plugin; no settings.json edit needed
omp plugin list                  # → omp-codemode@0.1.0
```

Remove with `omp plugin uninstall omp-codemode`.

The plugin entry (`extensions/index.ts`) re-exports the prebuilt
`dist/omp-codemode.js` bundle — the omp loader cannot resolve bare
third-party imports from source, so the bundled dist is the load path.
Do NOT add anything to the `extensions` allowlist in `settings.json`;
the plugin manager owns registration (verified: settings untouched by
install/uninstall).

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
