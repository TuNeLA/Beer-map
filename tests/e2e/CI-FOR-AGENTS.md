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

- `e2e (<shard>)`: `tests/e2e/run-all.sh 8793 8871 '<regex>'`. Each shard has its own test-name regex (see the matrix).
  Supabase is mocked. Anything not mocked goes to staging (`PN_TARGET=staging`), never to live.
- `webkit` shard: WebKit (iPhone engine) runs of `ds-motion` and `ds-layout`.
- `map-*` shards: real Mapbox GL. They need the repo secret `MAPBOX_TEST_TOKEN` (set). Without it they say "skip".
- `unit`: tests without a browser. `schema`: the schema loads into an empty Postgres 17.

To run only some tests: there is no input for that. Run the one test locally through the queue, or push and read only its shard.

## Add a new test

1. Put the file in `tests/e2e/` (name `<x>-pw.js`). Use `require("./ds-helpers.js")` or `require("./d2-helpers.js")`,
   `require("./env.js").OUT` for screenshots and `require("./env.js").CHROME` as `executablePath`. No `/tmp/...` paths.
2. Print one line per check: `PASS <text>` or `FAIL <text>`. Exit code not 0 = fail.
3. Add `run <name> $B <file>` to `tests/e2e/run-all.sh`.
4. Add the name to a shard regex in `.github/workflows/tests.yml` (or a new shard). Keep each shard under about 10 min.
5. Push to `ci/<agent>-<n>` and check that it is green.

## Run only your shards (13 Nov)
Put a file `.ci-only` in the root of your ci/ branch with one shard name per line (the `name:` values of the e2e matrix in .github/workflows/tests.yml, e.g. `ui-1`, `ride`, `mapzoom`, and the shard your build.sh adds for your new test). All other e2e shards skip in ~10 s. The unit/quality/schema jobs always run. Never merge `.ci-only` (CI fails on big-update/main if it exists).
