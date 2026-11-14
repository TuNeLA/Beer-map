# PintsNow — rules for agents (keep this file under 80 lines)

Social beer-map PWA. Vanilla JS, no framework. App code is in `docs/`.
Details: `scripts/split/README.md` (structure), `DESIGN.md` (design), `CONTRACT.md` (API),
`tests/e2e/CI-FOR-AGENTS.md` (e2e).

## Hard rules (the owner decides; do not break these)
- Agents NEVER push to `main` or `big-update`. Only the coordinator merges and goes live, and only work that passed
  unit tests + guards + its own e2e + the main e2e (owner rule 14 Nov 2026).
- The normal beta URL uses the LIVE database. Only `/test/` uses staging.
  Before a browser job, check that `config.js` points at staging. Never write to the live project.
- No secrets in the repo. No keys in code, tests, logs or commit messages.
- SQL files: additive and idempotent. No DELETE, DROP or TRUNCATE anywhere, not even in a comment.
  Each file ends with `select public.olnu_strip_cr();`. The owner runs SQL. Use the next free number.
- Each `security definer` function: a fixed `search_path`, an `auth.uid()` / membership check in the body,
  execute revoked from `public` and `anon` unless the function is public on purpose.
- Safety, privacy, legal and 18+ rules are not design rules. They always hold.
- Never text or effects that push drinking more. A count is information only. Store builds (`window.OLNU_STORE`)
  show no drinking celebration. One text pop-up per tap.
- A rough position (accuracy > 100 m) is never shown or sent as an exact pin (`docs/js/fastpos.js`).

## Structure traps
- App code: `docs/js/app-<area>.js` (parts). `docs/app.js` is boot only. Add no features there.
- NEVER edit between `<split:imports>` … `</split:imports>`, `<split:core>` or `<split:put/>`.
  These blocks are generated. A helper that you put inside a generated block is deleted on the next regen.
- You call a function of another part: call it by name, then run `node scripts/split/move.mjs . --regen`.
- Shared state is `PN.s.<name>` only. Only the writer parts in `scripts/split/plan.json` may assign it.
- New module (not a part): add `if (window.PN) PN.mod("NAME");` after `window.NAME = ...`.
- Never write `?v=` or the `sw.js` VERSION by hand. The deploy stamps them (`scripts/stamp.mjs`).
- Find the real function: `grep -n "function NAME(" docs/js/app-*.js | grep -v "return PN\."`

## Quality rules
- No emoji in JS strings (put them in CSS `content:`). No raw hex colours in CSS outside the token files
  (define `--x: #hex` custom properties instead). New files must be `git add`-ed before the quality check sees them.
- Motion and size values come from the tokens. Reduced motion = still.
- No function over 150 lines. Do not hand-edit `quality-baseline.json`
  (only `node tests/quality/check.mjs . --shrink`).
- Do not commit `tests/quality/report.json`.
- One click router for the map: a tap that closes a popup or sheet must not select a feature.

## Checks to run before you deliver
- `node --test "tests/unit/*.test.mjs"`
- `node tests/quality/check.mjs .`
- `bash scripts/split/ci.sh`   (needs `npm i --no-save acorn@8.12.1` and the full git history)
  or `node scripts/split/move.mjs . --check && node scripts/split/verify.mjs --structure`
- `node scripts/ci/stamp-guard.mjs docs`
- e2e: `PN_TARGET=staging python3 tests/e2e/serve.py <port> docs`, then your own `*-pw.js` test
  and the main test. Shards: `bash tests/e2e/run-all.sh <port> <port2> '<filter>'`.
  Map tests with real GL need `MAPBOX_TEST_TOKEN` (CI has it; use the stub path locally).

## How to work
- Work in your own git worktree. Edit only the files that your brief lists.
  If you need a file of another lane: do not edit it. Write a conflict note.
- Read little: `grep -n` first, then read a line range. Never read a big file whole. Use `tail` on logs.
- A bug fix needs a test that FAILS on the old code and PASSES on the new code.
- Show proof: the command and its output. Do not write "it works" with no output.
- Deliver and STOP. Do not wait for CI. Do not start work that the brief does not name.
- Final message: at most 20 lines, short simple English sentences. Details go in your DONE file.
- If the owner's wish and a design rule conflict: follow the owner and write the exception down.

## When you compact
Keep: the brief, the list of changed files, the test commands and their last result.
