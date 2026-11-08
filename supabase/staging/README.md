# supabase/staging – a test copy of the live database (no real data)

Staging project: **`pintsnow-staging`**, ref **`vdtmzsxajpvzwwbhnfmr`**, region eu-west-3, Free plan.
URL: `https://vdtmzsxajpvzwwbhnfmr.supabase.co`. Live (`wcdskpcevbhouvbytkhv`) is **never** written by these tools.

## Status (2026-11-08, 02:10 UTC)

| Check | Result |
|---|---|
| Schema loaded from `supabase/schema/` (snapshot 02:04 UTC, commit `2290e28`) | done, no errors |
| Counts staging vs live | tables 189 = 189, functions 781 = 781 (665 SECURITY DEFINER), sequences 61, indexes 397, constraints 363, triggers 92, RLS tables 189, policies 0 |
| Object-by-object compare vs live (`fingerprint.sql` style, per object) | **0 differences**: 781 function bodies (md5) + EXECUTE grants, 1 378 columns, 363 constraints, 397 indexes, 92 triggers, 251 table/view/sequence grants + RLS flags |
| pg_cron | extension on, **0 jobs** (on purpose) |
| Seed (`seed.sql`) | 4 fake anonymous users (`00000000-0000-4000-8000-00000000000{1..4}`, marked `test=true`), group "Testgänget" (users 1–3), group "Ensam testgrupp" (user 4), 2 beers + 1 check-in in the test zone 68.35 / 18.80 |
| Smoke test as user 1 with role `authenticated` | `poll_v2` ok, `poll_public` ok, `my_groups` → "Testgänget:3", `group_status_v3` → 3 members, `stop_beer` ok, `check_in` ok (`ok:true`) |
| Smoke test as user 4 | `post_beer_v2` accepted (`is_new:true`), `undo_beer` ok (`ok:true`, `undos_left:2`), `live_beers` returns rows |
| anon / authenticated can read tables directly | no (0 tables) – same as live |
| Anonymous sign-ins | **owner step** (the MCP tools cannot change Auth settings) |

The same load is also tested in CI on every push: job `schema` in `.github/workflows/tests.yml` loads the snapshot into an
empty Postgres 17 with a fake `auth` stub, checks all counts against `supabase/schema/counts.json`, and runs `smoke.sql`.

## Files

| File | Use |
|---|---|
| `apply.mjs` | builds the load bundle in the safe order and (with `STAGING_DB_URL`) runs it in **one transaction** |
| `seed.sql` | fake users, groups, beers, check-in (through the real RPCs) |
| `verify.sql` | counts to compare with `supabase/schema/counts.json` |
| `fingerprint.sql` | md5 per object type. Run on live and staging: all values must be equal |
| `smoke.sql` | core RPCs as seeded user 1 with role `authenticated`; rolled back. Each line `name|t|detail` (`f` = fail) |
| `local-stub.sql` | fake `auth`/roles for a plain Postgres (CI, laptop). **Never** on a Supabase project |

Load order in `apply.mjs`: extensions → sequences → tables → functions (one file each, `check_function_bodies = off`)
→ PK/UNIQUE/CHECK + 4 late defaults → foreign keys → indexes → views → triggers → grants → RLS/policies → publications
→ (seed). pg_cron jobs are **not** scheduled.

## Load a NEW empty project (owner or agent with the password)

```sh
STAGING_DB_URL="postgresql://postgres.<staging-ref>:<password>@aws-...-eu-west-3.pooler.supabase.com:5432/postgres" \
  node supabase/staging/apply.mjs --seed --smoke
```

The script stops if the URL contains the live ref, or if `public` already has tables (`--force` to override).
It needs `psql` (PostgreSQL 17 client).

## How it was loaded this time (no password, Supabase MCP only)

The agent had no database password. It used the Supabase MCP `execute_sql` on the **staging** ref only:

1. `create extension http with schema extensions;` and a small helper schema `staging_tools` (only `postgres` can use it).
2. `staging_tools.run(path)` downloads one file from `raw.githubusercontent.com/TuNeLA/Beer-map/<commit>/…` (a **pinned commit**,
   not a branch) and runs it. `staging_tools.run_functions(from, to)` loads the function files from `03_functions.txt` in batches of 200.
3. Then `seed.sql` the same way, then the smoke test by SQL with `set local role authenticated` and `request.jwt.claims`.
4. When live got 4 new tables and 23 new functions during the work, only the new objects were added (no drops).

To sync staging again later: make a new snapshot (`scripts/schema-snapshot.mjs`), push it, point `staging_tools.fetch` at the new
commit, and apply only the new or changed objects. A full reload needs an empty `public` schema first (that is a destructive step:
ask the owner).

## Owner steps

1. **Turn on anonymous sign-ins on staging** (the app logs in anonymously):
   Dashboard → project `pintsnow-staging` → **Authentication → Sign In / Providers** → **Allow anonymous sign-ins** → on → Save.
2. Optional: for `apply.mjs` without the MCP, set a staging database password (Project Settings → Database) and keep it in your
   password manager. Never paste it in chat.
3. Do not put real user data in staging. Use `seed.sql` users only.
