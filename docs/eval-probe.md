# 06 — eval gate + live probe (omp native `eval`, js)

Date: 2026-10-25. No config edits made (read-only gate check + one `--no-session` probe).

## 1. Gate verdict: eval is ON under stock config — no gate flip needed

Three independent signals, all pointing the same way:

**(a) `omp config list --json` — every eval backend key defaults `true`:**

| Key | Value | Description |
|---|---|---|
| `eval.py` | `true` | "Allow the eval tool to dispatch Python cells to the IPython kernel" |
| `eval.js` | `true` | "Allow the eval tool to dispatch JavaScript cells to the in-process runtime" |
| `eval.autoProvision` | `true` | "Automatically create the managed JavaScript eval package environment on first install" |
| `eval.tools.enabled` | `true` | "Let eval cells define tools (@tool in Python, tool(fn) in JS) that task, agent(), and workpool() subagents can call" |
| `eval.workpool.freshAgents` | `false` | (reuse workers; unrelated) |
| `eval.autoBackground.enabled` | `true` | (+ `thresholdMs` 60000) |

Full key inventory is 559 keys; no `eval.enabled` master switch exists — the per-backend
`eval.js`/`eval.py` flags ARE the gate, and both ship `true`.

**(b) `~/.omp/agent/config.yml` — no eval gate block.** The only `eval:` block in the file
(lines 256–258) is `autoBackground: enabled: true`. `settings.json` likewise contains no
eval entry (`defaultTools` is just `["+codemode"]`, stale per local research notes, not published).

**(c) `omp --help` caveat (documentary only):** the "Available Tools (default-enabled unless
noted)" roster lists `read, bash, edit, write, grep, glob, lsp, python, notebook, browser,
computer (disabled by default), task, todo, web_search, ask` — `eval` is absent, which the
local research notes read as "gated". The live probe below overrides that
reading: whatever the help text implies, a stock-config fresh process invokes `eval`
with zero flags and zero settings changes. Practical verdict: **on by default; no config
change enables it, so step 3 of the assignment (report the enabling change) is moot.**

## 2. Fresh-process live probe — attempt 1: PARTIAL (2-tool parallel call proven, in-script theme extraction FAILED)

Command (this user's stock config, no `--tools`/`--model` flags):

```
omp -p 'Use the eval tool exactly once with language js: run a script that
calls tool.read on ~/.omp/agent/settings.json and tool.bash with command
"echo CODEMODE_LIVE" in parallel (Promise.all), then return the theme value
and whether the echo output contains CODEMODE_LIVE. Report both verbatim.'
--no-session
```

The model used the `tool.read` / `tool.bash` prelude API correctly on the first attempt.
Full transcript: local scratch log (not published; exit 0, seconds — no stall).
Key lines quoted verbatim from that log:

- Echo check, verbatim: "`true` — raw echo output was `'CODEMODE_LIVE\n'`, and the
  script's computed `containsCodeModeLive` was `true`."
- stderr shows only a pre-existing, unrelated `Failed to load extension ...
  Cannot find package 'typebox'` warning from an unrelated local extension
  (documented in `integration-result.md` §11; not an eval issue).

Honest accounting: attempt 1 proved one `eval` (js) cell can call two session tools in
parallel and detect `CODEMODE_LIVE` in-script. It did NOT prove in-script theme
extraction — the model's script called `JSON.parse` on `tool.read` output, which returns
hashline-anchored, line-numbered text (`[~/.omp/agent/settings.json#B659]` + `1:{` …),
NOT raw JSON, so the script returned `PARSE_ERROR: JSON Parse error: Unrecognized token
'~'` and the model read `dark` off line 3 of the error text instead. Per the bar (theme +
`CODEMODE_LIVE` produced BY the script), attempt 1 is a partial, not a pass. Lesson for
script authors: never `JSON.parse` `tool.read` output; regex the anchored text instead.

## 3. Fresh-process live probe — attempt 2: SUCCESS (script returns both values)

Corrected command (regex extraction, no `JSON.parse`):

```
omp -p 'Use the eval tool exactly once with language js. Script: const [s,e] =
await Promise.all([tool.read({path:"~/.omp/agent/settings.json", i:"probe"}),
tool.bash({command:"echo CODEMODE_LIVE", i:"probe"})]); extract theme IN-SCRIPT
with regex /"theme":\s*"(\w+)"/ on s.text (tool.read returns hashline-anchored
text, NOT raw JSON — do not JSON.parse). Return {theme, live:
e.text.includes("CODEMODE_LIVE")} verbatim.' --no-session
```

Full transcript: local scratch log (not published; exit 0). Script output,
verbatim from that log:

```
{ theme: 'dark', live: true }
```

Success criteria met at the required bar: the script itself ran `tool.read` +
`tool.bash` in parallel, extracted `theme: 'dark'` in-script via regex, computed
`live: true` in-script, and returned both. stderr: same pre-existing warning
from the unrelated local extension only.

## 4. Log paths

Both attempt transcripts live in local scratch (not published).
