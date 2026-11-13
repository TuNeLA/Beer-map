#!/usr/bin/env node
// A3 guard (w1-server): migration rules. See supabase/README.md.
// For every migration numbered >= 0500 (FROM):
//   1. no anchor patch: no call of an olnu_*_patch( helper, and no own "execute replace(… pg_get_functiondef …)" / "execute v_def"
//      (a function change = a full CREATE OR REPLACE copied from the snapshot, then edited). Helper DEFINITIONS are allowed.
//   2. no DELETE / DROP / TRUNCATE word anywhere in the file (also not in comments: the owner reads the file).
//   3. the last statement is "select public.olnu_strip_cr();" (CR-safe after a Windows paste).
//   4. the file is listed in supabase/release/order.txt (so the CR LF rehearsal runs it).
// For every migration numbered >= 0436: every olnu_*_patch helper definition is CR-safe (has chr(13), like 0436 / 0501).
// usage: node scripts/ci/no-anchor-patch.mjs [repo root]

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const FROM = 500, CRSAFE_FROM = 436;
const order = fs.existsSync(path.join(ROOT, 'supabase', 'release', 'order.txt'))
  ? new Set(fs.readFileSync(path.join(ROOT, 'supabase', 'release', 'order.txt'), 'utf8').split('\n')
      .map((l) => l.replace(/#.*/, '').trim().split(/\s+/)).filter((p) => p[0] === 'release').map((p) => p[1]))
  : new Set();
const fail = [];
let n = 0;

// helper definitions: "create or replace function public.olnu_x_patch(" … "end $$;" (or the next "$$;")
const DEF = /create\s+or\s+replace\s+function\s+public\.(olnu_\w+_patch|olnu_strip_cr)\s*\(/gi;
function blocks(sql) {
  const out = [];
  for (const m of sql.matchAll(DEF)) {
    const start = m.index;
    const tag = /\bas\s+(\$\w*\$)/i.exec(sql.slice(start));
    if (!tag) continue;
    const bodyAt = start + tag.index + tag[0].length;
    const end = sql.indexOf(tag[1], bodyAt);
    out.push({ name: m[1], start, end: end < 0 ? sql.length : end + tag[1].length });
  }
  return out;
}

for (const f of fs.readdirSync(MIG).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
  const num = Number(f.slice(0, 4));
  const raw = fs.readFileSync(path.join(MIG, f), 'utf8').replace(/\r/g, '');
  const defs = blocks(raw);
  if (num >= CRSAFE_FROM)
    for (const d of defs) if (/_patch$/.test(d.name) && !raw.slice(d.start, d.end).includes('chr(13)'))
      fail.push(`${f}: helper ${d.name} is not CR-safe (strip chr(13) from the stored text, anchors, new texts, marker — see 0501)`);
  if (num < FROM) continue;
  n++;
  // the text outside helper definitions, without comments
  let rest = '', at = 0;
  for (const d of defs) { rest += raw.slice(at, d.start); at = d.end; }
  rest += raw.slice(at);
  const code = rest.replace(/--[^\n]*/g, '');
  // a call = the helper name not right after "function " (a REVOKE / GRANT "on function public.x(…)" names it, it does not call it)
  const calls = [...code.matchAll(/\b(olnu_\w+_patch)\s*\(/gi)]
    .filter((m) => !/\bfunction\s+(public\.)?$/i.test(code.slice(Math.max(0, m.index - 30), m.index)));
  // A3 exception (13 Nov, 0510): a hotfix that must patch BOTH the live model and the later release model may keep anchor calls,
  // if the file says why on a line "-- A3-EXCEPTION: <reason>" and the coordinator dry-runs it on live in a rolled-back transaction first.
  const a3x = /^--\s*A3-EXCEPTION:\s*\S/m.test(raw);
  if (calls.length && !a3x) fail.push(`${f}: calls an anchor helper (${[...new Set(calls.map((m) => m[1]))].join(', ')}). Rule A3: full CREATE OR REPLACE from the snapshot.`);
  if (!a3x && /\bexecute\s+(replace\s*\(|v_def\b)/i.test(code)) fail.push(`${f}: own anchor patch (execute replace(…)/v_def). Rule A3: full CREATE OR REPLACE from the snapshot.`);
  const words = [...raw.matchAll(/\b(delete|drop|truncate)\b/gi)].map((m) => `"${m[1]}" on line ${raw.slice(0, m.index).split('\n').length}`);
  if (words.length) fail.push(`${f}: forbidden word ${words.slice(0, 5).join(', ')} (no DELETE/DROP/TRUNCATE, also not in comments)`);
  const stmts = code.split(';').map((s) => s.trim()).filter(Boolean);
  if (!/^select\s+public\.olnu_strip_cr\(\)(\s+as\s+\w+)?$/i.test(stmts[stmts.length - 1] || ''))
    fail.push(`${f}: the last statement must be "select public.olnu_strip_cr();"`);
  if (!order.has(f.slice(0, 4))) fail.push(`${f}: not in supabase/release/order.txt (add a "release ${f.slice(0, 4)}" line before 0436)`);
}
console.log(fail.length ? `FAIL (${fail.length})\n${fail.join('\n')}` : `PASS: ${n} migration(s) >= 0${FROM} follow the rules; anchor helpers >= 0${CRSAFE_FROM} are CR-safe`);
process.exit(fail.length ? 1 : 0);
