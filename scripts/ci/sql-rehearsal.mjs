#!/usr/bin/env node
// Release-day SQL rehearsal with CR LF line ends (w1-server, CR-LF item). LOCAL / CI Postgres ONLY.
//
// What it does:
//   1. <prefix>_base = supabase/schema/ (apply.mjs --local-stub) + the "base" files of supabase/release/order.txt (LF).
//   2. Two copies of it: <prefix>_lf and <prefix>_crlf.
//   3. Every "release" file, in order, one transaction each, ON_ERROR_STOP:
//      the LF text into <prefix>_lf, the same text with CR LF line ends (= a Windows paste) into <prefix>_crlf.
//   4. --twice: all release files again into both (they must be safe to run two times).
//   5. Checks: the md5 of every public function and the fingerprint.sql answer are EQUAL in the two databases;
//      no function has a CR in its text after the list (0436 is the last file); every "Check after the run (expect t…)"
//      query in a release file header answers only t.
//
// Use (libpq env vars: PGHOST, PGPORT, PGUSER, PGPASSWORD; the user must be able to create databases):
//   node scripts/ci/sql-rehearsal.mjs [--order supabase/release/order.txt] [--prefix rh] [--twice] [--base-only] [--pre 0500]
// Safety: refuses a host that looks like Supabase (supabase.co / supabase.com / pooler). It creates and replaces
// only databases named <prefix>_base, <prefix>_lf, <prefix>_crlf, <prefix>_pre.
// Local-only change to the SQL text (both copies the same): "create extension if not exists pg_cron" is commented out,
// and cron.schedule / cron.unschedule are small stubs (plain Postgres has no pg_cron).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
const ORDER = path.resolve(ROOT, opt('--order', 'supabase/release/order.txt'));
const PREFIX = opt('--prefix', 'rh');
const PRE = opt('--pre');   // e.g. --pre 0500: <prefix>_pre = a copy of <prefix>_lf just BEFORE that release file (for its own test)
const MIG = path.join(ROOT, 'supabase', 'migrations');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-'));

const host = (process.env.PGHOST || '') + ' ' + (process.env.DATABASE_URL || '');
if (/supabase\.(co|com)|pooler/i.test(host)) { console.error('refused: this tool runs on a local / CI Postgres only'); process.exit(2); }

const env = { ...process.env, PGOPTIONS: '-c client_min_messages=warning' };
function psql(db, args, input) {
  return execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args],
    { env, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 << 20 });
}
const q = (db, sql) => psql(db, ['-At', '-c', sql]).trim();

function readOrder() {
  const out = { base: [], release: [] };
  for (const raw of fs.readFileSync(ORDER, 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [kind, num, flag] = line.split(/\s+/);
    if (!out[kind] || !/^\d{4}$/.test(num || '') || (flag && !(kind === 'release' && flag === 'xfail'))) throw new Error(`order.txt: bad line "${raw}"`);
    const hits = fs.readdirSync(MIG).filter((f) => f.startsWith(num + '_') && f.endsWith('.sql'));
    if (hits.length !== 1) throw new Error(`order.txt: migration ${num} matches ${hits.length} files`);
    if (kind === 'release') out.release.push({ file: hits[0], xfail: flag === 'xfail' });
    else out.base.push(hits[0]);
  }
  return out;
}

const localize = (sql) => sql.replace(/\r/g, '').replace(/^([ \t]*create[ \t]+extension[ \t]+if[ \t]+not[ \t]+exists[ \t]+pg_cron\b.*)$/gim, '-- (local rehearsal) $1');
function copyOf(file, crlf) {
  let sql = localize(fs.readFileSync(path.join(MIG, file), 'utf8'));
  if (crlf) sql = sql.replace(/\n/g, '\r\n');
  const p = path.join(TMP, (crlf ? 'crlf-' : 'lf-') + file);
  fs.writeFileSync(p, sql);
  return p;
}
function run(db, file, crlf) {
  const t = Date.now();
  try { psql(db, ['-1', '-f', copyOf(file, crlf)]); }
  catch (e) { throw new Error(`${file} (${crlf ? 'CR LF' : 'LF'}) failed in ${db}:\n${String(e.stderr || e.message).trim().split('\n').slice(0, 6).join('\n')}`); }
  return Date.now() - t;
}

// "-- Check after the run (expect t, t):" + "--   select …" lines → the query (only when every expected value is t)
function checkQuery(file) {
  const lines = fs.readFileSync(path.join(MIG, file), 'utf8').replace(/\r/g, '').split('\n');
  const i = lines.findIndex((l) => /^-- Check after the run \(expect (t(, t)*)\)/i.test(l));
  if (i < 0) return null;
  const body = [];
  for (let j = i + 1; j < lines.length && /^--\s{2,}\S/.test(lines[j]); j++) body.push(lines[j].replace(/^--\s+/, ''));
  return body.length ? body.join('\n') : null;
}

const FN_MD5 = `select p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') order by 1`;
const CR_FNS = `select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
  and position(chr(13) in pg_get_functiondef(p.oid)) > 0`;
const FINGERPRINT = fs.readFileSync(path.join(ROOT, 'supabase', 'staging', 'fingerprint.sql'), 'utf8');

const fail = [];
const summary = [];
const order = readOrder();
const [B, L, C] = [`${PREFIX}_base`, `${PREFIX}_lf`, `${PREFIX}_crlf`];

console.log(`base: ${order.base.length} files, release: ${order.release.length} files`);
psql('postgres', ['-c', `drop database if exists ${L}`, '-c', `drop database if exists ${C}`, '-c', `drop database if exists ${PREFIX}_pre`,
  '-c', `drop database if exists ${B}`, '-c', `create database ${B}`]);
const bundle = path.join(TMP, 'apply.sql');
execFileSync(process.execPath, [path.join(ROOT, 'supabase', 'staging', 'apply.mjs'), '--local-stub', '--out', bundle], { stdio: 'ignore' });
psql(B, ['-1', '-f', bundle]);
psql(B, ['-c', `create schema if not exists cron;
  create or replace function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
  create or replace function cron.schedule(text, text) returns bigint language sql as $$ select 1::bigint $$;
  create or replace function cron.unschedule(text) returns boolean language sql as $$ select true $$;
  create or replace function cron.unschedule(bigint) returns boolean language sql as $$ select true $$;`]);
for (const f of order.base) run(B, f, false);
console.log(`${B}: snapshot + ${order.base.length} base files, ${q(B, "select count(*) from pg_proc where pronamespace = 'public'::regnamespace")} functions`);
if (has('--base-only')) process.exit(0);

psql('postgres', ['-c', `create database ${L} template ${B}`, '-c', `create database ${C} template ${B}`]);
const passes = has('--twice') ? 2 : 1;
for (let pass = 1; pass <= passes; pass++) {
  for (const { file: f, xfail } of order.release) {
    if (pass === 1 && PRE && f.startsWith(PRE + '_')) psql('postgres', ['-c', `create database ${PREFIX}_pre template ${L}`]);
    if (xfail) {   // a KNOWN release-day bug: the file must still fail (LF and CR LF); its transaction rolls back
      const errs = [L, C].map((db, i) => { try { run(db, f, i === 1); return null; } catch (e) { return e.message.split('\n')[1] || e.message; } });
      if (errs.every(Boolean)) summary.push(`pass ${pass}  ${f.padEnd(40)} XFAIL (known, see order.txt): ${errs[0]}`);
      else { fail.push(`pass ${pass}: ${f} is marked xfail in order.txt but it now runs: remove "xfail"`); break; }
      continue;
    }
    try {
      const a = run(L, f, false), b = run(C, f, true);
      summary.push(`pass ${pass}  ${f.padEnd(40)} LF ${String(a).padStart(6)} ms   CR LF ${String(b).padStart(6)} ms`);
    } catch (e) { fail.push(`pass ${pass}: ${e.message}`); break; }
  }
  if (fail.length) break;
}

if (!fail.length) {
  const a = q(L, FN_MD5).split('\n'), b = q(C, FN_MD5).split('\n');
  const ma = new Map(a.map((l) => [l.slice(0, l.lastIndexOf(' ')), l.slice(l.lastIndexOf(' ') + 1)]));
  const mb = new Map(b.map((l) => [l.slice(0, l.lastIndexOf(' ')), l.slice(l.lastIndexOf(' ') + 1)]));
  const diff = [...new Set([...ma.keys(), ...mb.keys()])].filter((k) => ma.get(k) !== mb.get(k));
  if (diff.length) fail.push(`function md5 differs LF vs CR LF (${diff.length}): ${diff.slice(0, 20).join(', ')}`);
  else summary.push(`function md5: ${ma.size} functions, LF = CR LF`);
  const fa = q(L, FINGERPRINT), fb = q(C, FINGERPRINT);
  if (fa !== fb) fail.push(`fingerprint.sql differs:\n  LF    ${fa}\n  CR LF ${fb}`);
  else summary.push('fingerprint.sql: LF = CR LF');
  for (const db of [L, C]) {
    const n = Number(q(db, CR_FNS));
    if (n) fail.push(`${db}: ${n} functions still have a CR in their text (is 0436 the last release file?)`);
  }
  for (const { file: f, xfail } of order.release) {
    const cq = xfail ? null : checkQuery(f);
    if (!cq) continue;
    for (const db of [L, C]) {
      let got;
      try { got = q(db, cq); } catch (e) { got = 'ERROR ' + String(e.stderr || e.message).split('\n')[0]; }
      const ok = got.split('|').every((v) => v.trim() === 't');
      summary.push(`check ${f.padEnd(40)} ${db.padEnd(10)} ${ok ? 'ok' : 'FAIL'} (${got})`);
      if (!ok) fail.push(`check query of ${f} in ${db}: ${got}`);
    }
  }
}

const report = [...summary, '', fail.length ? `FAIL (${fail.length})` : 'PASS', ...fail].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### SQL rehearsal (LF vs CR LF)\n```\n' + report + '\n```\n');
process.exit(fail.length ? 1 : 0);
