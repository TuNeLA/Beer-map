// lane ciwork (C11): the weekly DB backup + restore test (.github/workflows/backup.yml, scripts/ci/db-backup.sh).
// The script runs here with fake `supabase`, `psql` and `7z` commands on PATH (no database, no Docker), so the checks
// cover the logic: skip without the secret, read-only counts, encrypted file only, size gate, count compare, no secret in the output.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("../..", import.meta.url).pathname;
const SH = join(ROOT, "scripts/ci/db-backup.sh"), YML = readFileSync(join(ROOT, ".github/workflows/backup.yml"), "utf8");
const SRC = readFileSync(SH, "utf8");
const PW = "s3cret-Pw-for-the-test";
const URL_ = `postgresql://postgres.abcdefghijklmnopqrst:${PW}@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`;

function fakes(dir) {
  const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
  const w = (n, s) => { writeFileSync(join(bin, n), "#!/bin/bash\n" + s + "\n"); chmodSync(join(bin, n), 0o755); };
  w("supabase", `case "$1" in
  db) f=""; data=0; while [ $# -gt 0 ]; do [ "$1" = -f ] && f=$2; [ "$1" = --data-only ] && data=1; shift; done
      if [ $data = 1 ]; then head -c "\${FAKE_DATA_BYTES:-2000000}" /dev/zero > "$f"; else echo "-- sql" > "$f"; fi ;;
  init) mkdir -p supabase; echo "major_version = 15" > supabase/config.toml ;;
  *) exit 0 ;;
esac`);
  w("psql", `url=$1; for a in "$@"; do case "$a" in *"begin read only"*) c=1;; *.sql) r=1;; esac; done
if [ -n "$c" ]; then case "$url" in *127.0.0.1*) printf '%s\\n' "\${FAKE_LOCAL:-$FAKE_SRC}" | tr ';' '\\n';; *) printf '%s\\n' "$FAKE_SRC" | tr ';' '\\n';; esac; exit 0; fi
case "$url" in *127.0.0.1*) ;; *) echo "psql wrote to a non-local database" >&2; exit 9;; esac
[ -n "$r" ] || exit 0
[ -n "$FAKE_RESTORE_MSG" ] && printf '%s\\n' "$FAKE_RESTORE_MSG" | tr ';' '\\n' >&2
exit \${FAKE_RESTORE_RC:-0}`);
  w("7z", `op=$1; shift; out=""; o=""; for a in "$@"; do case "$a" in -o*) o=\${a#-o};; -*) ;; *) [ -z "$out" ] && out=$a || src=$a;; esac; done
case $op in a) tar -cf "$out" "$src";; t) [ -f "$out" ];; x) tar -xf "$out" -C "$o";; esac`);
  return bin;
}
function run(args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bk-")), bin = fakes(dir), outp = join(dir, "out.txt"), sum = join(dir, "sum.md");
  writeFileSync(outp, ""); writeFileSync(sum, "");
  const r = spawnSync("bash", [SH, ...args.map((a) => a.replace("$D", dir))], { encoding: "utf8", cwd: dir,
    env: { ...process.env, PATH: bin + ":" + process.env.PATH, GITHUB_ACTIONS: "", GITHUB_OUTPUT: outp, GITHUB_STEP_SUMMARY: sum,
      SRC_NAME: "live", FAKE_SRC: "users 570;beers 9000;groups 120;public_tables 80;public_functions 400", ...env } });
  return { dir, code: r.status, out: r.stdout + r.stderr, gh: readFileSync(outp, "utf8"), sum: readFileSync(sum, "utf8") };
}
const clean = (r) => rmSync(r.dir, { recursive: true, force: true });

test("check: no secret = SKIPPED, exit 0, ok=false; with the secret ok=true", () => {
  const a = run(["check"], { SRC_DB_URL: "" });
  assert.equal(a.code, 0); assert.match(a.sum, /SKIPPED/); assert.match(a.gh, /ok=false/); assert.match(a.out, /LIVE_DB_URL/); clean(a);
  const b = run(["check"], { SRC_DB_URL: URL_ }); assert.equal(b.code, 0); assert.match(b.gh, /ok=true/); clean(b);
});
test("dump: one encrypted 7z, no plain .sql left, counts in the summary, the password never in the output", () => {
  const r = run(["dump", "$D/o"], { SRC_DB_URL: URL_, BACKUP_KEY: URL_ });
  assert.equal(r.code, 0, r.out);
  const files = readdirSync(join(r.dir, "o"));
  assert.equal(files.length, 1); assert.match(files[0], /^pintsnow-live-\d{4}-\d\d-\d\d\.7z$/);
  assert.match(r.sum, /users 570/); assert.match(r.sum, /encrypted: .*AES-256/);
  assert.ok(!r.out.includes(PW) && !r.sum.includes(PW), "the password is printed");
  clean(r);
});
test("dump: a too small data.sql fails (an empty or cut dump is not a backup)", () => {
  const r = run(["dump", "$D/o"], { SRC_DB_URL: URL_, BACKUP_KEY: URL_, FAKE_DATA_BYTES: "1000" });
  assert.equal(r.code, 1); assert.match(r.sum, /FAIL: data\.sql is under/); clean(r);
});
test("restore: same counts = OK; a lost row block or a restore error = FAIL; the restore writes only to 127.0.0.1", () => {
  const d = run(["dump", "$D/o"], { SRC_DB_URL: URL_, BACKUP_KEY: URL_ });
  const arc = join(d.dir, "o", readdirSync(join(d.dir, "o"))[0]);
  const ok = run(["restore", arc], { SRC_DB_URL: URL_, BACKUP_KEY: URL_ });
  assert.equal(ok.code, 0, ok.out); assert.match(ok.sum, /Restore test: OK/); assert.match(ok.sum, /\| users \| 570 \| 570 \| yes \|/); clean(ok);
  const lost = run(["restore", arc], { SRC_DB_URL: URL_, BACKUP_KEY: URL_, FAKE_LOCAL: "users 500;beers 9000;groups 120;public_tables 80;public_functions 400" });
  assert.equal(lost.code, 1); assert.match(lost.sum, /\| users \| 570 \| 500 \| NO \|/); clean(lost);
  const fn = run(["restore", arc], { SRC_DB_URL: URL_, BACKUP_KEY: URL_, FAKE_LOCAL: "users 570;beers 9000;groups 120;public_tables 80;public_functions 399" });
  assert.equal(fn.code, 1, "one function missing must fail"); clean(fn);
  const err = run(["restore", arc], { SRC_DB_URL: URL_, BACKUP_KEY: URL_, FAKE_RESTORE_RC: "3" });
  assert.equal(err.code, 1, err.out); assert.match(err.sum, /FAIL: the restore stopped with an error/, err.out); clean(err);
  const priv = run(["restore", arc], { SRC_DB_URL: URL_, BACKUP_KEY: URL_, FAKE_RESTORE_RC: "3",
    FAKE_RESTORE_MSG: "psql:x/data.sql:77: ERROR:  duplicate key anna@example.se;CONTEXT:  COPY users, line 1: anna@example.se" });
  assert.equal(priv.code, 1); assert.match(priv.out, /data\.sql line 77: an error \(text hidden/);
  assert.ok(!/anna@example\.se/.test(priv.out + priv.sum), "a data.sql error printed user data"); clean(priv);
  clean(d);
});
test("the source is only read: counts in a READ ONLY transaction, no psql -f on the source, restore target is local", () => {
  assert.match(SRC, /COUNTS_SQL="begin read only;/);
  assert.ok(!/psql "\$SRC_DB_URL"/.test(SRC), "a direct psql on the source");
  assert.match(SRC, /LOCAL_URL="postgresql:\/\/postgres:postgres@127\.0\.0\.1:54322\/postgres"/);
  assert.ok(!/echo[^\n]*\$(SRC_DB_URL|BACKUP_KEY)/.test(SRC.replace(/echo "::add-mask::\$BACKUP_KEY"/g, "")), "a secret is echoed");
});
test("workflow: live only on main, in the environment db-backup; the proof job never sees the live secret; no DELETE/DROP/TRUNCATE", () => {
  const live = YML.slice(YML.indexOf("\n  live:"), YML.indexOf("\n  staging-proof:")), proof = YML.slice(YML.indexOf("\n  staging-proof:"));
  assert.match(live, /if: github\.event_name != 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(live, /environment: db-backup/);
  assert.match(live, /retention-days: 90/);
  assert.ok(!/LIVE_DB_URL/.test(proof), "the staging proof job references the live secret");
  assert.match(YML, /cron: "17 3 \* \* 0"/); assert.match(YML, /cron: "43 4 2 \* \*"/);
  for (const t of [YML, SRC]) assert.ok(!/\b(delete|drop|truncate)\b/i.test(t.replace(/supabase stop --no-backup/g, "")), "a forbidden SQL word");
});
test(".ci-backup (the staging proof marker) is never on big-update or main", () => {
  const ref = process.env.GITHUB_REF || "";
  if (existsSync(join(ROOT, ".ci-backup"))) assert.ok(ref.startsWith("refs/heads/ci/") || ref === "", ".ci-backup must not be merged (ref " + ref + ")");
});
