#!/bin/bash
# C11 (lane ciwork, 19 Nov 2026): database backup + restore test. Used by .github/workflows/backup.yml. Steps of a run:
#   check              is the source secret there? No: a clear "skipped" message, exit 0 (the job stays green)
#   dump <dir>         READ-ONLY on the source: counts, then `supabase db dump` (roles, schema, data) like
#                      supabase/schema/BACKUP.md, then ONE encrypted 7z (AES-256, file names hidden). Plain .sql files are removed.
#   restore <7z>       open the 7z, start a LOCAL Supabase database on the runner (Docker), load roles + schema + data the
#                      way BACKUP.md restores a new project, then compare counts with the dump. Never a real project.
# Env: SRC_DB_URL (the Session pooler connection string of the source; never printed), SRC_NAME (live | staging),
#      BACKUP_KEY (the 7z password; the workflow sets BACKUP_PASSPHRASE, or the connection string when that is empty).
# Safety: the source is only READ (pg_dump, and counts in a READ ONLY transaction). The restore target is the local
# database 127.0.0.1:54322 inside the runner. Nothing here connects to a Supabase project to write.
set -euo pipefail
cmd=${1:-}; LOCAL_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
say() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }
mask() {   # hide the password part of the connection string too (GitHub masks only the whole secret)
  [ -n "${GITHUB_ACTIONS:-}" ] || return 0
  local pw; pw=$(python3 -c 'import os,urllib.parse as u;print(u.unquote(u.urlsplit(os.environ["SRC_DB_URL"]).password or ""))' 2>/dev/null || true)
  [ -n "$pw" ] && echo "::add-mask::$pw"; [ -n "${BACKUP_KEY:-}" ] && echo "::add-mask::$BACKUP_KEY"; return 0
}
# counts = the numbers the restore must give back (read only; a 2nd query after the dump would see newer rows: allow a margin)
COUNTS_SQL="begin read only;
select 'users', count(*) from auth.users
union all select 'beers', count(*) from public.beers
union all select 'groups', count(*) from public.groups
union all select 'public_tables', count(*) from pg_tables where schemaname = 'public'
union all select 'public_functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
commit;"
counts() { psql "$1" -X -q -At -F ' ' -v ON_ERROR_STOP=1 -c "$COUNTS_SQL" | { grep -v '^\(BEGIN\|COMMIT\)$' || true; }; }

case "$cmd" in
check)
  if [ -z "${SRC_DB_URL:-}" ]; then
    say "### DB backup ($SRC_NAME): SKIPPED"
    say "The secret for the $SRC_NAME database is not set, so no backup was made. This is not an error."
    [ "$SRC_NAME" = live ] && say "Owner step: add the secret LIVE_DB_URL in the GitHub environment db-backup (steps: the private ops repo, RUNBOOK.md, part Backup)."
    echo "ok=false" >> "${GITHUB_OUTPUT:-/dev/null}"; exit 0
  fi
  echo "ok=true" >> "${GITHUB_OUTPUT:-/dev/null}" ;;
dump)
  out=${2:?dump <dir>}; mkdir -p "$out"; mask; d="pintsnow-$SRC_NAME-$(date -u +%Y-%m-%d)"; w=$(mktemp -d); mkdir -p "$w/$d"
  counts "$SRC_DB_URL" > "$w/$d/counts.txt"
  supabase db dump --db-url "$SRC_DB_URL" -f "$w/$d/roles.sql" --role-only
  supabase db dump --db-url "$SRC_DB_URL" -f "$w/$d/schema.sql"
  supabase db dump --db-url "$SRC_DB_URL" -f "$w/$d/data.sql" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
  { echo "made $(date -u +%FT%TZ) from the $SRC_NAME project by ${GITHUB_REPOSITORY:-?} run ${GITHUB_RUN_ID:-?} (commit ${GITHUB_SHA:-?})";
    echo "restore: supabase/schema/BACKUP.md (new project) or scripts/ci/db-backup.sh restore (test)"; } > "$w/$d/README.txt"
  case "$SRC_NAME" in live) min=1000000;; staging) min=20000;; *) min=1000;; esac   # the owner's packed live backup of 15 Nov was 2.7 MB
  sz=$(stat -c %s "$w/$d/data.sql"); say "### DB backup ($SRC_NAME): data.sql $sz bytes, schema.sql $(stat -c %s "$w/$d/schema.sql") bytes"
  say '```'; while read -r k v; do say "$k $v"; done < "$w/$d/counts.txt"; say '```'
  [ "$sz" -ge "$min" ] || { say "FAIL: data.sql is under $min bytes: the dump is not complete"; exit 1; }
  (cd "$w" && 7z a -t7z -mhe=on -mx=7 "-p$BACKUP_KEY" "$out/$d.7z" "$d" > /dev/null)
  rm -rf "$w"   # the plain files never leave the runner
  7z t "-p$BACKUP_KEY" "$out/$d.7z" > /dev/null && say "encrypted: $d.7z ($(stat -c %s "$out/$d.7z") bytes, AES-256, names hidden)" ;;
restore)
  arc=${2:?restore <7z>}; mask; w=$(mktemp -d)
  7z x -y "-p$BACKUP_KEY" "-o$w" "$arc" > /dev/null; d=$(ls "$w"); cd "$w"
  mkdir -p stack && (cd stack && supabase init --force > /dev/null 2>&1 || supabase init > /dev/null)
  sed -i 's/^major_version = .*/major_version = 17/' stack/supabase/config.toml
  (cd stack && supabase start -x imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor)
  psql "$LOCAL_URL" -X -q --single-transaction -v ON_ERROR_STOP=1 -f "$d/roles.sql" -f "$d/schema.sql" \
    -c "SET session_replication_role = replica" -f "$d/data.sql" > restore.log 2>&1 || { tail -n 30 restore.log; say "FAIL: the restore stopped with an error (last lines above)"; exit 1; }
  counts "$LOCAL_URL" > got.txt
  say "### Restore test ($SRC_NAME dump $d into a local Supabase database)"; say '| what | in the dump run | restored | ok |'; say '|---|---|---|---|'
  bad=0
  while read -r k want; do
    got=$(awk -v k="$k" '$1==k{print $2}' got.txt); got=${got:-0}
    if [ "$k" = public_tables ] || [ "$k" = public_functions ]; then ok=$([ "$got" = "$want" ] && echo yes || echo NO)
    else margin=$(( want / 50 > 5 ? want / 50 : 5 )); diff=$(( got > want ? got - want : want - got ))
      ok=$([ "$diff" -le "$margin" ] && { [ "$want" = 0 ] || [ "$got" -gt 0 ]; } && echo yes || echo NO); fi
    say "| $k | $want | $got | $ok |"; [ "$ok" = yes ] || bad=1
  done < "$d/counts.txt"
  (cd stack && supabase stop --no-backup > /dev/null 2>&1 || true); cd /; rm -rf "$w"
  [ $bad = 0 ] && say "Restore test: OK" || { say "Restore test: FAIL (a count is off)"; exit 1; } ;;
*) echo "usage: db-backup.sh check | dump <dir> | restore <file.7z>"; exit 2 ;;
esac
