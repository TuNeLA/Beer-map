#!/usr/bin/env node
// A3 snapshot md5 tool (w1-server). Compares the md5 of every function between the snapshot files and a database.
// The snapshot (supabase/schema/functions/<name>(<args>).sql) has the LIVE md5(pg_get_functiondef) on its 2nd line.
//
//   node scripts/ci/schema-md5.mjs load  -d <db>      the snapshot loaded into <db> must give the SAME md5 for every
//                                                    snapshot function (proves the snapshot files are exact). Exit 1 if not.
//   node scripts/ci/schema-md5.mjs diff  -d <db>      report: functions that differ from the snapshot / are new / are
//                                                    missing (= what the migrations after the snapshot change). Exit 0.
//        add --fail to exit 1 when anything differs (e.g. staging after the release = drift).
//   node scripts/ci/schema-md5.mjs fingerprint -d <db> [--expect supabase/schema/fingerprint.json] [--keys k1,k2]
//                                                    runs supabase/staging/fingerprint.sql and compares every key
//                                                    (--keys: only these fail; the others are shown as "info").
//                                                    No expect file yet = print the answer, exit 0 (W0 commits the file).
// Connection: -d <db name> with the libpq env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD), or --url-env <VAR> (a URL in that
// env var, e.g. STAGING_DB_URL). Only SELECT statements are sent. Refuses the live project.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LIVE_REF = 'wcdskpcevbhouvbytkhv';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SNAP = path.resolve(ROOT, opt('--schema', 'supabase/schema'));
const urlVar = opt('--url-env');
const target = urlVar ? process.env[urlVar] : opt('-d');
if (!['load', 'diff', 'fingerprint'].includes(mode) || !target) {
  console.error('usage: schema-md5.mjs load|diff|fingerprint (-d <db> | --url-env <VAR>) [--fail] [--expect file] [--schema dir]');
  process.exit(2);
}
if ((target + ' ' + (process.env.PGHOST || '')).includes(LIVE_REF)) { console.error('refused: never the live project'); process.exit(2); }

function q(sql) {
  return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', target, '-c', 'set default_transaction_read_only = on;', '-c', sql],
    { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// snapshot: key "name(identity args)" → md5. Key form = pg_get_function_identity_arguments (line 1 of each file).
function snapshot() {
  const dir = path.join(SNAP, 'functions');
  const m = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const [l1, l2] = fs.readFileSync(path.join(dir, f), 'utf8').split('\n', 2);
    const k = /^-- public\.(\S+?\(.*\))\s*$/.exec(l1);
    const h = /md5\(pg_get_functiondef\) = ([0-9a-f]{32})/.exec(l2 || '');
    if (!k || !h) throw new Error(`snapshot file without name/md5 header: ${f}`);
    m.set(k[1], h[1]);
  }
  return m;
}
function database() {
  const rows = q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || '\t' || md5(pg_get_functiondef(p.oid))
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1`);
  return new Map(rows ? rows.split('\n').map((l) => l.split('\t')) : []);
}

const out = [];
let bad = false;
if (mode === 'fingerprint') {
  const got = JSON.parse(q(fs.readFileSync(path.join(ROOT, 'supabase', 'staging', 'fingerprint.sql'), 'utf8')));
  const expFile = path.resolve(ROOT, opt('--expect', 'supabase/schema/fingerprint.json'));
  if (!fs.existsSync(expFile)) {
    out.push(`no ${path.relative(ROOT, expFile)} yet (the W0 snapshot commits it). Answer of this database:`, JSON.stringify(got, null, 2));
  } else {
    const exp = JSON.parse(fs.readFileSync(expFile, 'utf8'));
    const strict = opt('--keys') ? opt('--keys').split(',') : Object.keys(exp);   // other keys: shown, not checked
    for (const k of Object.keys(exp)) {
      const ok = exp[k] === got[k];
      if (!ok && strict.includes(k)) bad = true;
      out.push(`${ok ? 'ok  ' : strict.includes(k) ? 'DIFF' : 'info'} ${k.padEnd(18)} ${exp[k]} ${ok ? '' : '→ ' + got[k]}`);
    }
  }
} else {
  const s = snapshot(), d = database();
  const changed = [...s.keys()].filter((k) => d.has(k) && d.get(k) !== s.get(k));
  const missing = [...s.keys()].filter((k) => !d.has(k));
  const added = [...d.keys()].filter((k) => !s.has(k));
  out.push(`snapshot ${s.size} functions · database ${d.size} · same ${s.size - changed.length - missing.length} · changed ${changed.length} · missing ${missing.length} · new ${added.length}`);
  for (const [t, list] of [['changed', changed], ['missing', missing], ['new', added]]) for (const k of list) out.push(`${t.padEnd(8)} ${k}`);
  if (mode === 'load') bad = changed.length > 0 || missing.length > 0;
  if (mode === 'diff' && argv.includes('--fail')) bad = changed.length + missing.length + added.length > 0;
}
const report = out.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### schema-md5 ${mode}\n\`\`\`\n${report.slice(0, 60000)}\n\`\`\`\n`);
process.exit(bad ? 1 : 0);
