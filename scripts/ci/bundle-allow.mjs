#!/usr/bin/env node
// A10 guard (w1-server): every name the CLIENT may send in rpc_bundle2 must be on the SERVER list.
//   client = BUNDLE, BUNDLE_NEW, BUNDLE_66 (arrays) + LANE_N (object keys), searched in docs/app.js and every docs/js/app-*.js part.
//   server = the rpc_bundle2 name list in the snapshot (supabase/schema/functions/rpc_bundle2(jsonb).sql, if it has one)
//            + every rpc_bundle2 definition and anchor patch in supabase/migrations (the "legacy" list in the function text)
//            + every "insert into public.rpc_bundle_allow" row in supabase/migrations (0500 and later: the table).
// Rules: FAIL if a client name is not on the server. When the table has rows (0500), the table is the server list, and it
//        must also hold every legacy name (0500 must not lose a name).
// CHAT_RPC is NOT a bundle list (it is the not_member gate and holds writes such as post_group_msg): shown, not checked.
// usage: node scripts/ci/bundle-allow.mjs [repo root]

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const NAME = /'([a-z][a-z0-9_]*)'/g;
const names = (txt) => [...txt.matchAll(NAME)].map((m) => m[1]);
const strip = (sql) => sql.replace(/\r/g, '').replace(/--[^\n]*/g, '');   // no SQL comments (they name functions too)

// ---- client
const parts = [path.join(ROOT, 'docs', 'app.js'),
  ...fs.readdirSync(path.join(ROOT, 'docs', 'js')).filter((f) => /^app-.*\.js$/.test(f)).map((f) => path.join(ROOT, 'docs', 'js', f))]
  .filter((f) => fs.existsSync(f));
const client = new Map();   // name → list it came from
const found = {};
for (const f of parts) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bvar\s+(BUNDLE|BUNDLE_NEW|BUNDLE_66)\s*=\s*\[([\s\S]*?)\]/g)) {
    found[m[1]] = path.relative(ROOT, f);
    for (const n of [...m[2].matchAll(/["']([a-z][a-z0-9_]*)["']/g)].map((x) => x[1])) client.set(n, m[1]);
  }
  for (const m of src.matchAll(/\bvar\s+(LANE_N|CHAT_RPC)\s*=\s*\{([\s\S]*?)\}/g)) {
    found[m[1]] = path.relative(ROOT, f);
    if (m[1] === 'LANE_N') for (const n of [...m[2].matchAll(/([a-z][a-z0-9_]*)\s*:/g)].map((x) => x[1])) client.set(n, 'LANE_N');
  }
}
const fail = [];
for (const l of ['BUNDLE', 'BUNDLE_NEW', 'BUNDLE_66', 'LANE_N']) if (!found[l]) fail.push(`client list ${l} not found in docs/app.js or docs/js/app-*.js (renamed? update this check)`);

// ---- server
const legacy = new Set(), table = new Set();
const snap = path.join(ROOT, 'supabase', 'schema', 'functions', 'rpc_bundle2(jsonb).sql');
const okList = (sql) => { const m = /\bok\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]\s*;/i.exec(sql); return m ? names(m[1]) : []; };
if (fs.existsSync(snap)) okList(strip(fs.readFileSync(snap, 'utf8'))).forEach((n) => legacy.add(n));
for (const f of fs.readdirSync(MIG).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
  const sql = strip(fs.readFileSync(path.join(MIG, f), 'utf8'));
  for (const m of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.rpc_bundle2\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\2\$/gi))
    okList(m[3]).forEach((n) => legacy.add(n));
  for (const m of sql.matchAll(/olnu_\w+_patch\(\s*'public\.rpc_bundle2\(jsonb\)'([\s\S]*?)\]\s*\)\s*(as\s+\w+\s*)?;/gi))
    names(m[1]).forEach((n) => legacy.add(n));
  for (const m of sql.matchAll(/insert\s+into\s+public\.rpc_bundle_allow\b[^;]*?\bvalues\b([\s\S]*?);/gi))
    names(m[1]).forEach((n) => table.add(n));
}
const server = table.size ? table : legacy;
const missing = [...client.keys()].filter((n) => !server.has(n)).sort();
if (missing.length) fail.push(`client names NOT on the server list (${table.size ? 'rpc_bundle_allow rows' : 'rpc_bundle2 text'}): ` +
  missing.map((n) => `${n} (${client.get(n)})`).join(', ') + '\n  fix: add a row in a new migration: insert into public.rpc_bundle_allow (name) values (\'<name>\') on conflict (name) do nothing;');
if (table.size) {
  const lost = [...legacy].filter((n) => !table.has(n)).sort();
  if (lost.length) fail.push(`rpc_bundle_allow rows miss names of the old rpc_bundle2 list: ${lost.join(', ')}`);
}
const report = [
  `client: ${client.size} names (${Object.entries(found).map(([k, v]) => `${k} in ${v}`).join(', ')})`,
  `server: legacy list ${legacy.size} names, rpc_bundle_allow rows ${table.size} → checked against ${table.size ? 'the table' : 'the legacy list'}`,
  `server-only names (allowed, not used by this client): ${[...server].filter((n) => !client.has(n)).sort().join(', ') || '-'}`,
  fail.length ? `FAIL\n${fail.join('\n')}` : 'PASS: client ⊂ server',
].join('\n');
console.log(report);
process.exit(fail.length ? 1 : 0);
