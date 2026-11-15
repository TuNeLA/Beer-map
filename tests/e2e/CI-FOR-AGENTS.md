# CI for agents: test your copy on GitHub, not on the shared machine

The shared dev machine has 2 CPUs. Browser tests there are slow and block other agents.
GitHub Actions runs the full suite for free (public repo), about 20 shards in parallel, in about 10 min.

## Rule

- Push ONLY to branches named `ci/<agent>-<n>` (for example `ci/fxm-1`, `ci/fxm-2`).
- NEVER push to `big-update`, `main` or any other branch. The coordinator merges.
- Do not delete remote branches or runs. Do not put secrets in the repo.

## Steps

1. Work in your own copy of the repo (with `.git`). Commit there.

   ```sh
   cd <your-copy>
   git add -A && git commit -m "<what you changed>"
   ```

2. Push the commit to a `ci/` branch. Use a new number for each try (or push again to the same branch: a new push cancels the old run on that branch).

   ```sh
   git push origin HEAD:refs/heads/ci/<agent>-<n>
   ```

3. Find the run (it starts in a few seconds).

   ```sh
   gh run list -R TuNeLA/Beer-map -b ci/<agent>-<n>
   ```

4. Wait for it. Then read only the failures.

   ```sh
   gh run watch <run-id> -R TuNeLA/Beer-map --exit-status     # optional: wait until it ends
   gh run view <run-id> -R TuNeLA/Beer-map                     # shards and their result
   gh run view <run-id> -R TuNeLA/Beer-map --log-failed        # log lines of the failed shards
   ```

   Each shard prints a SUMMARY table (test, PASS count, FAIL count, status) at the end of its log and on the run page.
   Full logs per test: `gh run download <run-id> -R TuNeLA/Beer-map -n e2e-logs-<shard>`.

5. Send your patch script to the coordinator as usual. Say which `ci/` run is green.

## What runs

`.github/workflows/tests.yml` runs on every push to `big-update` and `ci/**`, on PRs to `main`, and by hand.
It calls two shared files: `guards.yml` (unit, quality) and `e2e.yml` (the browser shards). The live deploy
(`pages-bundle.yml`) calls the same two files, so "green here" and "allowed to go live" mean the same checks.

- `e2e (<shard>)`: `tests/e2e/run-all.sh 8793 8871 '<regex>'`. The shard list is `tests/e2e/shards.txt`, one line per shard
  (not a YAML matrix). A shard runs 2 tests at once (`par=1` for timing checks).
  Supabase is mocked. Anything not mocked goes to staging (`PN_TARGET=staging`), never to live.
- `gate-a`, `gate-b`: the same tests on the BUILT site (`scripts/build-site.mjs`: bundle groups + stamp). They also run before a live deploy.
- `map-*` shards: real Mapbox GL. They need the repo secret `MAPBOX_TEST_TOKEN` (set). Without it they say "skip".
- WebKit (iPhone engine) runs of `ds-motion` and `ds-layout` are in the shard that has `webkit` on its line.
- `guards / unit`: tests without a browser, split guard, stamp guard, shard guard. `schema`: the schema loads into an empty Postgres 17.
- A push that changes only docs or ops files (`*.md`, `ops/`, `android/`, `supabase/`, `scripts/dev/`) starts no e2e runner.
- On a `ci/` branch a new push cancels the run of the older commit. On `big-update` every commit gets its own full run (never cancelled).

Expected time per shard: `node scripts/ci/plan.mjs . --times`. Check the lists: `node scripts/ci/shard-guard.mjs .`
To run only some tests: locally `bash scripts/dev/quick.sh <names>` (guards + the named tests, one table), or see ".ci-only" below.

## Add a new test

1. Put the file in `tests/e2e/` (name `<x>-pw.js`). Use `require("./ds-helpers.js")` or `require("./d2-helpers.js")`,
   `require("./env.js").OUT` for screenshots and `require("./env.js").CHROME` as `executablePath`. No `/tmp/...` paths.
2. Print one line per check: `PASS <text>` or `FAIL <text>`. Exit code not 0 = fail.
3. Add `run <name> $B <file>` to `tests/e2e/run-all.sh`.
4. Add `<name>` to the regex of ONE shard line in `tests/e2e/shards.txt` (pick a shard with room: `plan.mjs --times`), or add a line.
   The unit job fails when a `*-pw.js` file is in no shard, or in two (`scripts/ci/shard-guard.mjs`).
   A test that cannot run in CI goes on `tests/e2e/not-in-ci.txt` with the reason.
5. After an action (a click that opens a sheet, a tab, a send) use `await settle(page, 1500)` and not `await wait(page, 1500)`:
   it returns as soon as the UI is still (the number is only the cap). Keep `wait()` for app timers and "nothing happens" checks.
6. Push to `ci/<agent>-<n>` and check that it is green.

## Run only your shards (13 Nov)
Put a file `.ci-only` in the root of your ci/ branch with one shard name per line (the first word of a line in `tests/e2e/shards.txt`, e.g. `ui-04`, `map-lane`, `gate-a`). No runner starts for the other e2e shards. The guards and the schema job always run. A wrong name or an empty file fails the plan job. `.ci-only` is read only on `ci/` branches; never merge it (the unit job fails on other branches if it exists).