#!/usr/bin/env node
// Apply supabase/schema/ (the live snapshot) to a NEW, EMPTY Supabase project (staging).
//
// Order: extensions, sequences, tables, functions, constraints (+ late defaults), foreign keys,
// indexes, views, triggers, grants, RLS/policies, publications. pg_cron jobs are NOT scheduled.
// Then (optional) seed.sql with fake test users and groups.
//
// Use:
//   STAGING_DB_URL="postgresql://postgres.<staging-ref>:<password>@aws-...pooler.supabase.com:5432/postgres" \
//     node supabase/staging/apply.mjs [--seed] [--smoke]
//   node supabase/staging/apply.mjs --out /tmp/apply.sql [--seed] [--local-stub]   (only write the bundle)
//
// Safety: refuses to run against the live project ref, and refuses if public already has tables
// (pass --force to skip that check on a database you know is a throwaway).
// --local-stub: prepends local-stub.sql (fake auth/roles) for a plain local Postgres, not Supabase.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LIVE_REF = 'wcdskpcevbhouvbytkhv';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(HERE, '..', 'schema');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k) => argv.includes(k);
export const SEP = '\n-- @@STMT_BOUNDARY@@\n';

export function bundleParts({ seed = false, localStub = false } = {}) {
  const parts = [];
  const add = (label, sql) => parts.push({ label, sql });
  add('header', "SET check_function_bodies = false;\nSET client_min_messages = warning;\n");
  if (localStub) add('local-stub.sql', fs.readFileSync(path.join(HERE, 'local-stub.sql'), 'utf8'));
  let ext = fs.readFileSync(path.join(SCHEMA, '00_extensions.sql'), 'utf8');
  if (localStub) ext = ext.replace(/^CREATE EXTENSION IF NOT EXISTS (pg_cron|supabase_vault)\b.*$/gm, '-- (local) skipped: $&');
  add('00_extensions.sql', ext);
  for (const f of ['01_sequences.sql', '02_tables.sql']) add(f, fs.readFileSync(path.join(SCHEMA, f), 'utf8'));
  const list = fs.readFileSync(path.join(SCHEMA, '03_functions.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  for (const f of list) add(f, fs.readFileSync(path.join(SCHEMA, f), 'utf8'));
  for (const f of ['04_constraints.sql', '05_foreign_keys.sql', '06_indexes.sql', '07_views.sql', '08_triggers.sql', '09_grants.sql', '10_rls_policies.sql', '11_publications.sql'])
    add(f, fs.readFileSync(path.join(SCHEMA, f), 'utf8'));
  add('cron', '-- pg_cron jobs are NOT scheduled on staging (see supabase/schema/12_cron.sql).\n');
  if (seed) add('seed.sql', fs.readFileSync(path.join(HERE, 'seed.sql'), 'utf8'));
  return parts;
}

export function bundle(o) {
  return bundleParts(o).map((p) => `-- ===== ${p.label} =====\n${p.sql}`).join(SEP);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const sql = bundle({ seed: has('--seed'), localStub: has('--local-stub') });
  if (opt('--out')) {
    fs.writeFileSync(opt('--out'), sql);
    console.log(`Wrote ${opt('--out')} (${sql.length} bytes)`);
    process.exit(0);
  }
  const url = process.env.STAGING_DB_URL;
  if (!url) { console.error('Set STAGING_DB_URL (staging project, Session pooler string) or use --out <file>.'); process.exit(2); }
  if (url.includes(LIVE_REF)) { console.error('STOP: this URL points at the LIVE project. Use the staging project only.'); process.exit(3); }
  const psql = (args, input) => execFileSync('psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', ...args], { input, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (!has('--force')) {
    const n = Number(psql(['-At', '-c', "select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r'"]).trim());
    if (n > 0) { console.error(`STOP: public already has ${n} tables. This script is for an EMPTY project. (--force to override)`); process.exit(4); }
  }
  console.log('Applying schema' + (has('--seed') ? ' + seed' : '') + ' in one transaction ...');
  psql(['-q', '-1', '-f', '-'], sql);
  console.log(psql(['-At', '-c', fs.readFileSync(path.join(HERE, 'verify.sql'), 'utf8')]));
  if (has('--smoke')) console.log(psql(['-At', '-f', path.join(HERE, 'smoke.sql')]));
  console.log('Done. pg_cron jobs were not scheduled.');
}
