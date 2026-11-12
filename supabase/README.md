# supabase/ — rules for the database

The live database is changed only by the owner, in the Supabase SQL editor (Windows), one file at a time.
These rules keep that safe. CI checks most of them.

## Folders

| Folder | What |
|---|---|
| `migrations/` | One file per change, `NNNN_name.sql`. Reserve the number first (`scratchpad/migration-numbers.md`). |
| `schema/` | Read-only snapshot of the live schema (`scripts/schema-snapshot.mjs`, SELECT only). Each function file has the live md5 on line 2. Release tag: `schema-YYYY-MM-DD`. |
| `staging/` | Load the snapshot into an empty Postgres (`apply.mjs`), `fingerprint.sql`, `verify.sql`, `smoke.sql`. |
| `release/order.txt` | The release-day order of the owner-run files (and the "base" files that are live but not yet in the snapshot). |
| `tests/` | SQL tests. Each runs in one transaction and ends with ROLLBACK. Output `name|t|detail`; a `|f|` = fail. |
| `archive/` | Old one-off files (`setup.sql`, `update-now.sql`, `RUN-ME-owner*.sql`). Do not run them. They are history only. |

## Rule A3 — change a function from the snapshot (from 0500)

1. A migration that changes a function = a **full `create or replace`**. Copy the text from `schema/functions/<name>(<args>).sql`
   (or from a local database that has the release files, when the function changed after the snapshot), then edit it.
   Say in the header which text you copied (snapshot date, or "after 0465 + 0466 + 0480").
2. **No new anchor patches.** No call of an `olnu_*_patch(` helper and no own `execute replace(pg_get_functiondef(…))`.
   The helpers stay only for the files that already use them (0149–0490). Removing the helpers is a later owner job,
   after the release (the owner writes and runs that file himself).
3. Every migration is additive and idempotent: `create … if not exists`, `insert … on conflict do nothing`,
   `create or replace`. The words DELETE / DROP / TRUNCATE are not in the file at all (also not in comments).
4. Every migration is CR-safe and ends with `select public.olnu_strip_cr();` (a Windows paste adds CR to every line end).
5. Add the file to `release/order.txt` (before the last line, `release 0436`).
6. A new name for `rpc_bundle2` = one row: `insert into public.rpc_bundle_allow (name) values ('<name>') on conflict (name) do nothing;`
   (table since 0500). The client lists are in `docs/js/app-net.js` (`BUNDLE`, `BUNDLE_NEW`, `BUNDLE_66`, `LANE_N`).

## CI checks (`.github/workflows/tests.yml`)

| Check | Job | Tool |
|---|---|---|
| Snapshot loads byte-exact: md5 of all functions = line 2 of each snapshot file | schema | `scripts/ci/schema-md5.mjs load` |
| Fingerprint = `schema/fingerprint.json` (committed with the snapshot) | schema | `scripts/ci/schema-md5.mjs fingerprint` |
| Release rehearsal: every release file, in order, LF and CR LF, two times; both databases end equal; each file's "Check after the run" query = `t` | schema | `scripts/ci/sql-rehearsal.mjs` |
| Every anchor helper works with CR LF anchors and CR LF function text | schema | `tests/crlf-anchors.test.sql` |
| `rpc_bundle2` gives the same answers with the table (0500) | schema | `tests/rpc-bundle-allow-0500.test.sql` |
| Staging drift report (optional, secret `STAGING_DB_URL`, read-only) | schema | `scripts/ci/schema-md5.mjs diff` |
| Client bundle names ⊂ server list | unit | `scripts/ci/bundle-allow.mjs` |
| Rules 2–5 above for files ≥ 0500; anchor helpers ≥ 0436 are CR-safe | unit | `scripts/ci/no-anchor-patch.mjs` |

Run locally (a plain local Postgres, never Supabase):

```sh
export PGHOST=<socket dir or 127.0.0.1> PGPORT=<port> PGUSER=postgres
node scripts/ci/sql-rehearsal.mjs --twice --pre 0500          # makes rh_base, rh_lf, rh_crlf, rh_pre
psql -d rh_crlf -X -f supabase/tests/crlf-anchors.test.sql
psql -d rh_pre -X -v mig=supabase/migrations/0500_rpc_bundle_allow.sql -f supabase/tests/rpc-bundle-allow-0500.test.sql
node scripts/ci/schema-md5.mjs diff -d rh_lf                  # what the release files change against the snapshot
```

## After a new snapshot (W0)

1. `scripts/schema-snapshot.mjs` against live (SELECT only) → `schema/` + `schema/fingerprint.json` (`staging/fingerprint.sql` on live).
2. In `release/order.txt` remove the `base` lines that the new snapshot already has, and the `release` lines that are live now.
3. Tag the commit `schema-YYYY-MM-DD`.
