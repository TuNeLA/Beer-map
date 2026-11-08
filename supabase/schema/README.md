# supabase/schema – snapshot of the live database

This folder is a read-only copy of the **live** schema `public` in project `wcdskpcevbhouvbytkhv`.
It shows what is really live, also for the 21 functions that were changed by "anchored text edits"
and for the migrations that were run by hand in the SQL Editor.

- Made: **2026-11-08 02:04 UTC**, Postgres 17.11. (Live changes during the big update. Make it again before you trust it.)
- Made with: `scripts/schema-snapshot.mjs` (only `SELECT` queries on the catalog; nothing was written).
- It is **not** a migration. Do not run it on live. Use it to read, to diff, and to build staging.
- It has **no data**. For a data backup, see [BACKUP.md](BACKUP.md).

## Files (load order)

| File | Content |
|---|---|
| `00_extensions.sql` | `CREATE EXTENSION IF NOT EXISTS` for the 6 extensions |
| `01_sequences.sql` | 61 sequences |
| `02_tables.sql` | 189 tables: columns, types, defaults, NOT NULL, `OWNED BY` for sequences |
| `03_functions.txt` | load list for `functions/` |
| `functions/<name>(<arg types>).sql` | **781 files**, one per function, exact `pg_get_functiondef` + `;`. The 2nd line has the live md5 |
| `04_constraints.sql` | 186 PK, 14 UNIQUE, 139 CHECK + 4 defaults that call `olnu_next_expiry()` (need the function first) |
| `05_foreign_keys.sql` | 23 FKs (7 point at `auth.users`) |
| `06_indexes.sql` | 197 indexes (the other 200 of 397 belong to PK/UNIQUE constraints) |
| `07_views.sql` | 1 view (`owner_wishes_v`) |
| `08_triggers.sql` | 92 triggers (91 + 1 constraint trigger) |
| `09_grants.sql` | grants for tables, view, sequences, **who can EXECUTE each function**, default privileges |
| `10_rls_policies.sql` | RLS on for all 189 tables; 0 policies (all access goes through functions) |
| `11_publications.sql` | realtime publications (none) |
| `12_cron.sql` | 1 pg_cron job (`olnu-retention`, `17 3 * * *`). Secrets are redacted. **Not** applied to staging |
| `DEPENDENCIES.md` | objects outside `public` we depend on (`auth.users`, `auth.sessions`, `auth.uid()`, `extensions.digest`, `extensions.gen_random_bytes`) |
| `counts.json` | all counts + the catalog counts used for the check |
| `BACKUP.md` | how the owner makes a full backup (schema + data) on his PC – in Swedish |

## Counts (checked against the catalog)

The script counts the catalog directly and compares with what it wrote. All match.

| Object | Live catalog | Snapshot |
|---|---|---|
| Tables | 189 | 189 (1 378 columns) |
| Functions | 781 | 781 files (665 `SECURITY DEFINER`, 68 trigger functions) |
| Sequences | 61 | 61 |
| Views | 1 | 1 |
| Indexes | 397 | 397 (197 + 200 from constraints) |
| Constraints | 363 | 363 (p 186, u 14, c 139, f 23, t 1) |
| Triggers | 92 | 92 |
| Tables with RLS | 189 | 189 |
| Policies | 0 | 0 |
| md5 of each function | – | 781 of 781 match |

Function EXECUTE grants: 407 functions only `postgres`/`service_role`, 374 for `authenticated`, 43 for `anon`, 10 for `PUBLIC`.

The snapshot was also loaded into an empty Postgres (local test with a fake `auth` schema, and the staging project –
see `supabase/staging/README.md`). It loads with no errors and gives the same counts.

## How to make it again

With a database URL (read-only use, Session pooler string, needs `psql`):

```sh
SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-...pooler.supabase.com:5432/postgres" \
  node scripts/schema-snapshot.mjs
```

Without a password (an agent with the Supabase MCP `execute_sql` tool):

```sh
node scripts/schema-snapshot.mjs --print-sql catalog     # run this SQL, save the JSON value to catalog.json
node scripts/schema-snapshot.mjs --print-sql functions   # run this SQL, save the JSON value to fndefs.json
node scripts/schema-snapshot.mjs --catalog catalog.json --fndefs fndefs.json
```

Add `--check` to only compare counts and write nothing. The script deletes old files in `functions/` first,
so a dropped function also disappears from the snapshot. Then `git diff supabase/schema` shows every live change.

## Rules

- Do not edit these files by hand. Change the database with a migration, then make the snapshot again.
- Before you change a function, read its file here. This is the live code. A migration file can be older.
- The snapshot has no secrets. The owner key is only stored as a hash in a table, and table data is not in the snapshot.
