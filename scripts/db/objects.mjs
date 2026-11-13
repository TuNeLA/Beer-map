#!/usr/bin/env node
// Lists the database objects that a migration file touches, and builds a READ-ONLY snapshot query
// whose answer is a rollback script for those objects.
//
//   node scripts/db/objects.mjs <file.sql | 4-digit number> ...        human list
//   node scripts/db/objects.mjs --json <files...>                       JSON list
//   node scripts/db/objects.mjs --snapshot-sql <files...>               one SELECT (only reads the catalog).
//        Its one row / one column "rollback_sql" is a SQL script that puts every touched object back as it is NOW:
//        functions (pg_get_functiondef + EXECUTE grants), triggers (+ enabled state), policies, RLS flag and grants of
//        the touched tables, pg_cron jobs. At the end a DO block makes objects that are NEW after the snapshot harmless
//        (function: revoke + rename to <name>__off_<time>; trigger: disable; cron job: inactive; policy: using (false)).
//        It never removes rows or objects. Added columns / tables / indexes / data rows stay (they are additive).
//   node scripts/db/objects.mjs --guard-sql <files...>                  one SELECT (only reads): run before and after the
//        apply. "untouched_fn" (md5 of every public function the file does NOT name) must stay equal; counts may only grow.
//   node scripts/db/objects.mjs --order [--json]                         every "release" file of supabase/release/order.txt
//
// The parser reads top-level statements (quotes, dollar quotes and comments respected) and the bodies of DO blocks.
// It finds: CREATE/ALTER/GRANT/REVOKE on functions, anchor patches (olnu_*_patch('public.f(..)'::regprocedure) and
// pg_get_functiondef('public.f(..)'::regproc[edure]) in DO blocks), CREATE TABLE / ALTER TABLE / CREATE INDEX /
// CREATE TRIGGER / CREATE|ALTER POLICY / GRANT|REVOKE on tables, top-level INSERT/UPDATE (data), cron.schedule names,
// and olnu_strip_cr() (touches the text of every function that holds a CR: "global", not part of the snapshot).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');

// ---------- lexer: top-level statements; strings, dollar quotes, comments respected ----------
export function splitStatements(sql) {
  const out = [];
  let i = 0, start = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (c === '-' && d === '-') { const e = sql.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
    if (c === '/' && d === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'") { i++; while (i < n) { if (sql[i] === "'" && sql[i + 1] === "'") i += 2; else if (sql[i] === "'") { i++; break; } else i++; } continue; }
    if (c === '"') { const e = sql.indexOf('"', i + 1); i = e < 0 ? n : e + 1; continue; }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m && !/[A-Za-z0-9_]/.test(sql[i - 1] || '')) { const e = sql.indexOf(m[0], i + m[0].length); i = e < 0 ? n : e + m[0].length; continue; }
    }
    if (c === ';') { out.push(sql.slice(start, i)); start = i + 1; }
    i++;
  }
  if (sql.slice(start).trim()) out.push(sql.slice(start));
  return out.map((s) => s.trim()).filter((s) => stripComments(s).trim());
}
export function stripComments(s) {
  let r = '', i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '-' && d === '-') { const e = s.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && d === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; r += ' '; continue; }
    if (c === "'") { const st = i; i++; while (i < n) { if (s[i] === "'" && s[i + 1] === "'") i += 2; else if (s[i] === "'") { i++; break; } else i++; } r += s.slice(st, i); continue; }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i, i + 64));
      if (m && !/[A-Za-z0-9_]/.test(s[i - 1] || '')) { const e = s.indexOf(m[0], i + m[0].length); const end = e < 0 ? n : e + m[0].length; r += s.slice(i, end); i = end; continue; }
    }
    r += c; i++;
  }
  return r;
}
// the body of the first dollar-quoted string in a statement (DO block / function body)
function dollarBody(s) {
  const m = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s);
  if (!m) return '';
  const e = s.indexOf(m[0], m.index + m[0].length);
  return e < 0 ? '' : s.slice(m.index + m[0].length, e);
}
function parenArgs(s, at) {   // s[at] === '(' → text inside the balanced parens
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (!depth) return s.slice(at + 1, i); }
  }
  return null;
}
const TYPE_START = new Set(['double', 'timestamp', 'time', 'character', 'bit', 'interval', 'national', 'char', 'varchar']);
// "p_a uuid, p_b text default null, out x int" → "uuid,text"  (identity argument types, for to_regprocedure)
export function argTypes(args) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of args) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const types = [];
  for (let p of parts) {
    p = p.replace(/\s+(default\b|=)[\s\S]*$/i, '').trim().replace(/\s+/g, ' ');
    let toks = p.split(' ');
    const mode = toks[0].toLowerCase();
    if (mode === 'out') continue;
    if (['in', 'inout', 'variadic'].includes(mode)) toks = toks.slice(1);
    if (toks.length > 1 && !TYPE_START.has(toks[0].toLowerCase().replace(/^"|"$/g, ''))) toks = toks.slice(1);
    types.push(toks.join(' ').toLowerCase());
  }
  return types.join(',');
}
const ident = (s) => s.replace(/"/g, '').toLowerCase();

// ---------- object finder ----------
export function objectsOf(sqlRaw) {
  const sql = sqlRaw.replace(/\r/g, '');
  const o = { functions: new Map(), tables: new Map(), triggers: new Set(), policies: new Set(), cron: new Set(), global: new Set(), other: new Set() };
  const fn = (name, sig, how) => {
    name = ident(name);
    const k = sig == null ? name : `${name}(${sig})`;
    const cur = o.functions.get(k) || { name, sig, how: new Set() };
    cur.how.add(how);
    o.functions.set(k, cur);
  };
  const tb = (name, how) => {
    name = ident(name);
    const cur = o.tables.get(name) || { name, how: new Set() };
    cur.how.add(how);
    o.tables.set(name, cur);
  };
  const Q = '(?:(public|[a-z_][a-z0-9_]*|"[^"]+")\\.)?("?[a-z_][a-z0-9_]*"?)';   // [schema.]name
  const isPublic = (schema) => !schema || ident(schema) === 'public';
  // a regprocedure literal: 'public.f(int, text)' → name + normalized types
  const regprocRefs = (text, how) => {
    for (const m of text.matchAll(/'(?:public\.)?([a-z_][a-z0-9_]*)\s*(\(([^']*)\))?'\s*::\s*regproc(edure)?\b/gi)) {
      fn(m[1], m[2] ? m[3].split(',').map((t) => t.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean).join(',') : null, how);
    }
  };
  function scan(stmt, inDo) {
    const s = stripComments(stmt).trim();
    const low = s.toLowerCase();
    let m;
    if ((m = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+${Q}\\s*\\(`, 'i').exec(s))) {
      const args = parenArgs(s, m.index + m[0].length - 1);
      if (isPublic(m[1])) fn(m[2], argTypes(args || ''), 'create'); else o.other.add(`function ${ident(m[1])}.${ident(m[2])}`);
      return;   // the body of a function is NOT run now: no scan inside
    }
    if ((m = new RegExp(`^(?:alter|comment\\s+on)\\s+function\\s+${Q}\\s*\\(`, 'i').exec(s))) {
      const args = parenArgs(s, m.index + m[0].length - 1);
      if (isPublic(m[1])) fn(m[2], argTypes(args || ''), 'alter'); return;
    }
    if ((m = new RegExp(`^(?:grant|revoke)\\b[\\s\\S]*?\\bon\\s+function\\s+([\\s\\S]+?)\\s+(?:to|from)\\b`, 'i').exec(s))) {
      for (const f of m[1].matchAll(new RegExp(`${Q}\\s*\\(`, 'gi'))) {
        const args = parenArgs(m[1], f.index + f[0].length - 1);
        if (isPublic(f[1])) fn(f[2], argTypes(args || ''), 'grant');
      }
      return;
    }
    if ((m = new RegExp(`^(?:grant|revoke)\\b[\\s\\S]*?\\bon\\s+(?:table\\s+)?${Q}\\s+(?:to|from)\\b`, 'i').exec(s)) && !/\bon\s+(schema|sequence|all)\b/i.test(s)) {
      if (isPublic(m[1])) tb(m[2], 'grant'); return;
    }
    if ((m = new RegExp(`^create\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${Q}`, 'i').exec(s))) { if (isPublic(m[1])) tb(m[2], 'create'); else o.other.add(`table ${ident(m[1])}.${ident(m[2])}`); return; }
    if ((m = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${Q}`, 'i').exec(s))) {
      if (isPublic(m[1])) tb(m[2], /row\s+level\s+security/i.test(s) ? 'rls' : 'alter');
      const t = /\b(enable|disable)\s+trigger\s+("?\w+"?)/i.exec(s); if (t) o.triggers.add(ident(t[2]));
      return;
    }
    if ((m = new RegExp(`^create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?("?\\w+"?\\s+)?on\\s+(?:only\\s+)?${Q}`, 'i').exec(s))) { if (isPublic(m[2])) tb(m[3], 'index'); return; }
    if ((m = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+("?\\w+"?)[\\s\\S]*?\\bon\\s+${Q}`, 'i').exec(s))) { o.triggers.add(ident(m[1])); if (isPublic(m[2])) tb(m[3], 'trigger'); return; }
    if ((m = new RegExp(`^(?:create|alter)\\s+policy\\s+("?[^"\\s]+"?|"[^"]+")\\s+on\\s+${Q}`, 'i').exec(s))) {
      o.policies.add(ident(m[1]));
      if (isPublic(m[2])) tb(m[3], 'policy'); else o.other.add(`policy target ${ident(m[2])}.${ident(m[3])}`);
      return;
    }
    if ((m = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?view\\s+(?:if\\s+not\\s+exists\\s+)?${Q}`, 'i').exec(s))) { o.other.add(`view ${ident(m[2])}`); return; }
    if ((m = new RegExp(`^(?:insert\\s+into|update)\\s+(?:only\\s+)?${Q}`, 'i').exec(s))) { if (isPublic(m[1])) tb(m[2], 'data'); return; }
    if (/^create\s+(extension|schema|sequence|type)\b/i.test(s)) { o.other.add(low.split(/\s+/).slice(0, 6).join(' ')); return; }
    if (/^do\b/i.test(s)) {
      const body = dollarBody(s);
      regprocRefs(body, 'patch');   // pg_get_functiondef('public.f(..)'::regprocedure) = an anchor patch of f
      for (const st of splitStatements(body.replace(/^\s*(declare[\s\S]*?)?\bbegin\b/i, '').replace(/\bend\s*;?\s*$/i, ''))) scan(st, true);
      for (const t of body.matchAll(/execute\s+'([^']*(?:''[^']*)*)'/gi)) for (const st of splitStatements(t[1].replace(/''/g, "'"))) scan(st, true);
      cronNames(body);
      if (/olnu_strip_cr\s*\(/i.test(body)) o.global.add('olnu_strip_cr');
      return;
    }
    // select / perform: patch helper calls, cron.schedule, strip_cr
    // helper call: the 1st argument is the function, as 'public.f(args)' (cast to regprocedure is optional: implicit)
    for (const c of s.matchAll(/\b(olnu_\w+_patch)\s*\(\s*'([^']*)'/gi)) regprocRefs(`'${c[2]}'::regprocedure`, 'patch');
    cronNames(s);
    if (/\bolnu_strip_cr\s*\(/i.test(s)) o.global.add('olnu_strip_cr');
    // inside a DO block: IF/LOOP wrappers hold statements; scan them as text
    if (inDo) for (const st of s.split(/\b(?:then|loop|else)\b/i).slice(1)) if (st.trim()) scan(st.replace(/\bend\s+(if|loop)\b[\s\S]*$/i, ''), true);
  }
  function cronNames(text) { for (const c of text.matchAll(/cron\.schedule\s*\(\s*'([^']+)'/gi)) o.cron.add(c[1]); }
  for (const st of splitStatements(sql)) scan(st, false);
  // a patched f(sig) that the same file also creates by name only is the same object: keep the most exact key
  return {
    functions: [...o.functions.values()].map((f) => ({ name: f.name, sig: f.sig, how: [...f.how].sort() })).sort((a, b) => (a.name + a.sig).localeCompare(b.name + b.sig)),
    tables: [...o.tables.values()].map((t) => ({ name: t.name, how: [...t.how].sort() })).sort((a, b) => a.name.localeCompare(b.name)),
    triggers: [...o.triggers].sort(), policies: [...o.policies].sort(), cron: [...o.cron].sort(), global: [...o.global].sort(), other: [...o.other].sort(),
  };
}

// ---------- snapshot query ----------
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(lit).join(',')}]::text[]`;
export function snapshotSql(objs, label) {
  const fnNames = [...new Set(objs.functions.map((f) => f.name))].sort();
  const trig = objs.triggers, pol = objs.policies, cron = objs.cron;
  // grants + RLS are restored ONLY for tables whose grants / RLS the file changes (a trigger or data row on a hot table
  // must not lead to a revoke/grant round on it). Column grants are restored too (a table REVOKE ALL also drops them).
  const aclTables = objs.tables.filter((t) => t.how.includes('grant') || t.how.includes('rls')).map((t) => t.name).sort();
  // Output is built in SQL. Each part is a text; NULL parts are skipped by concat_ws.
  return `-- READ-ONLY snapshot for ${label}. Answer: one row. rollback_sql = the rollback script: save it as-is.
-- Proof the file is whole: its last line is "end $rb$;" and its md5 (no newline at the end) = rollback_md5.
with fn as (
  select p.oid, p.oid::regprocedure::text as sig, p.proname
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.proname = any(${arr(fnNames)})
), fn_acl as (
  select f.sig, string_agg(format('grant execute on function public.%s to %s;', f.sig,
           case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end), E'\\n' order by a.grantee) as g
    from fn f join pg_proc p on p.oid = f.oid
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where a.privilege_type = 'EXECUTE'
   group by f.sig
), tb as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname = any(${arr(aclTables)})
), tg as (
  select t.tgname, c.relname, t.tgenabled, pg_get_triggerdef(t.oid) as def, t.tgconstraint <> 0 as is_con
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and t.tgname = any(${arr(trig)})
), po as (
  select * from pg_policies where policyname = any(${arr(pol)})
), cj as (
  ${cron.length ? `select jobname, schedule, command, active from cron.job where jobname = any(${arr(cron)})`
    : 'select null::text as jobname, null::text as schedule, null::text as command, null::boolean as active where false'}
)
select rollback_sql, length(rollback_sql) as rollback_len, md5(rollback_sql) as rollback_md5 from (select concat_ws(E'\\n',
  '-- ROLLBACK for ${label.replace(/'/g, "''")}. Snapshot taken ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') || ' UTC on ' || current_database() || '.',
  '-- It puts the touched objects back as they were at the snapshot. It removes no rows and no objects.',
  '-- Functions (' || (select count(*) from fn) || '), triggers (' || (select count(*) from tg) || '), policies (' || (select count(*) from po) || '), tables (' || (select count(*) from tb) || '), cron jobs (' || (select count(*) from cj) || ').',
  'set local check_function_bodies = off;',
  'set local search_path = public, extensions;',
  (select string_agg(pg_get_functiondef(f.oid) || ';' || E'\\n' ||
          format('revoke all on function public.%s from public, anon, authenticated, service_role;', f.sig) || E'\\n' || coalesce(a.g, ''),
          E'\\n\\n' order by f.sig) from fn f left join fn_acl a on a.sig = f.sig),
  (select string_agg(case when is_con then format('-- constraint trigger %I on %I: kept (it cannot be replaced; no file may change it)', tgname, relname)
                             else replace(def, 'CREATE TRIGGER', 'CREATE OR REPLACE TRIGGER') || ';' end ||
          format(E'\\nalter table public.%I %s trigger %I;', relname,
                 case tgenabled when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' else 'enable' end, tgname),
          E'\\n' order by relname, tgname) from tg),
  (select string_agg(format('alter policy %I on %I.%I to %s%s%s;', policyname, schemaname, tablename, array_to_string(roles, ', '),
          case when qual is not null then ' using (' || qual || ')' else '' end,
          case when with_check is not null then ' with check (' || with_check || ')' else '' end), E'\\n' order by tablename, policyname) from po),
  (select string_agg(format('alter table public.%I %s row level security;', relname, case when relrowsecurity then 'enable' else 'disable' end) ||
          case when relforcerowsecurity then format(E'\\nalter table public.%I force row level security;', relname) else '' end ||
          format(E'\\nrevoke all on table public.%I from public, anon, authenticated, service_role;', relname) ||
          coalesce((select E'\\n' || string_agg(format('grant %s on table public.%I to %s;', a.privilege_type, relname,
                      case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end), E'\\n' order by a.grantee, a.privilege_type)
                    from aclexplode(coalesce(relacl, acldefault('r', relowner))) a), '') ||
          coalesce((select E'\\n' || string_agg(format('grant %s (%I) on table public.%I to %s;', ca.privilege_type, at.attname, relname,
                      case when ca.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(ca.grantee)) end), E'\\n' order by at.attnum, ca.grantee, ca.privilege_type)
                    from pg_attribute at cross join lateral aclexplode(at.attacl) ca
                   where at.attrelid = tb.oid and at.attnum > 0 and not at.attisdropped and at.attacl is not null), ''), E'\\n' order by relname) from tb),
  (select string_agg(format('select cron.schedule(%L, %L, %L);', jobname, schedule, command) ||
          case when not active then format(E'\\nselect cron.alter_job(j.jobid, active := false) from cron.job j where j.jobname = %L;', jobname) else '' end,
          E'\\n' order by jobname) from cj),
  '-- Objects that are NEW after the snapshot: made harmless (no removal).',
  'do $rb$',
  'declare r record; stamp text := to_char(now() at time zone ''utc'', ''YYYYMMDDHH24MI'');',
  '  pre_fn text[] := ' || quote_literal(coalesce((select array_agg(sig order by sig) from fn), '{}')::text) || '::text[];',
  '  pre_tg text[] := ' || quote_literal(coalesce((select array_agg(relname || '.' || tgname order by 1) from tg), '{}')::text) || '::text[];',
  '  pre_po text[] := ' || quote_literal(coalesce((select array_agg(schemaname || '.' || tablename || '.' || policyname order by 1) from po), '{}')::text) || '::text[];',
  '  pre_cj text[] := ' || quote_literal(coalesce((select array_agg(jobname order by 1) from cj), '{}')::text) || '::text[];',
  'begin',
  '  for r in select p.oid::regprocedure as rp, p.oid::regprocedure::text as sig, p.proname from pg_proc p',
  '            where p.pronamespace = ''public''::regnamespace and p.proname = any(' || quote_literal(${arr(fnNames)}::text) || '::text[])',
  '              and p.oid::regprocedure::text <> all(pre_fn) loop',
  '    execute format(''revoke all on function %s from public, anon, authenticated'', r.rp);',
  '    execute format(''alter function %s rename to %I'', r.rp, left(r.proname, 40) || ''__off_'' || stamp);',
  '    raise notice ''new function made harmless: %'', r.sig;',
  '  end loop;',
  '  for r in select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid',
  '            where not t.tgisinternal and c.relnamespace = ''public''::regnamespace',
  '              and t.tgname = any(' || quote_literal(${arr(trig)}::text) || '::text[])',
  '              and (c.relname || ''.'' || t.tgname) <> all(pre_tg) loop',
  '    execute format(''alter table public.%I disable trigger %I'', r.relname, r.tgname);',
  '    raise notice ''new trigger disabled: %.%'', r.relname, r.tgname;',
  '  end loop;',
  '  for r in select schemaname, tablename, policyname, cmd from pg_policies',
  '            where policyname = any(' || quote_literal(${arr(pol)}::text) || '::text[])',
  '              and (schemaname || ''.'' || tablename || ''.'' || policyname) <> all(pre_po) loop',
  '    execute format(''alter policy %I on %I.%I using (false)%s'', r.policyname, r.schemaname, r.tablename,'
  '                   case when r.cmd in (''ALL'', ''UPDATE'') then '' with check (false)'' else '''' end);',
  '    raise notice ''new policy closed: %.%.%'', r.schemaname, r.tablename, r.policyname;',
  '  end loop;',
  '  if to_regclass(''cron.job'') is not null then',
  '    for r in select jobid, jobname from cron.job where jobname = any(' || quote_literal(${arr(cron)}::text) || '::text[]) and jobname <> all(pre_cj) loop',
  '      perform cron.alter_job(r.jobid, active := false);',
  '      raise notice ''new cron job paused: %'', r.jobname;',
  '    end loop;',
  '  end if;',
  'end $rb$;'
) as rollback_sql) s;
`;
}

// ---------- guard query: run it before AND after the apply; the "untouched_*" values must stay equal ----------
// untouched_fn = md5 over every public function NOT named in the file (text + EXECUTE grants). If it changes, the
// file touched a function that this parser did not see: stop and look. Counts may only grow (nothing removed).
export function guardSql(objs, label) {
  const fnNames = [...new Set(objs.functions.map((f) => f.name))].sort();
  const tables = objs.tables.map((t) => t.name).sort();
  return `-- READ-ONLY guard for ${label}. Run before and after. untouched_fn / untouched_tg must be equal; counts must not go down.
select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> all(${arr(fnNames)})) as untouched_fn_n,
       (select md5(string_agg(p.oid::regprocedure::text || md5(replace(pg_get_functiondef(p.oid), chr(13), '')) || coalesce(p.proacl::text, ''), ',' order by 1))
          from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.proname <> all(${arr(fnNames)})) as untouched_fn,
       (select md5(coalesce(string_agg(c.relname || '.' || t.tgname || t.tgenabled::text || pg_get_triggerdef(t.oid), ',' order by 1), ''))
          from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname <> all(${arr(tables)})
           and t.tgname <> all(${arr(objs.triggers)})) as untouched_tg,
       (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')) as tables_n,
       (select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped) as columns_n,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) as functions_n,
       (select count(*) from pg_policies where schemaname = 'public') as policies_n,
       (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
           and position(chr(13) in pg_get_functiondef(p.oid)) > 0) as cr_functions_n;
`;
}

// ---------- CLI ----------
function resolve(arg) {
  if (/^\d{4}$/.test(arg)) {
    const hits = fs.readdirSync(MIG).filter((f) => f.startsWith(arg + '_') && f.endsWith('.sql'));
    if (hits.length !== 1) throw new Error(`migration ${arg}: ${hits.length} files`);
    return path.join(MIG, hits[0]);
  }
  return path.resolve(arg);
}
function orderFiles() {
  const seen = new Set(), out = [];
  for (const raw of fs.readFileSync(path.join(ROOT, 'supabase', 'release', 'order.txt'), 'utf8').split('\n')) {
    const p = raw.replace(/#.*/, '').trim().split(/\s+/);
    if (p[0] === 'release' && !seen.has(p[1])) { seen.add(p[1]); out.push(resolve(p[1])); }
  }
  return out;
}
export function merge(list) {
  const m = { functions: [], tables: [], triggers: [], policies: [], cron: [], global: [], other: [] };
  for (const o of list) for (const k of Object.keys(m)) m[k].push(...o[k]);
  const byKey = (xs, key) => {   // same object in two files: one entry, the "how" lists joined
    const m2 = new Map();
    for (const x of xs) { const k = key(x), cur = m2.get(k); m2.set(k, cur ? { ...cur, how: [...new Set([...cur.how, ...x.how])].sort() } : x); }
    return [...m2.values()];
  };
  m.functions = byKey(m.functions, (f) => f.name + '(' + f.sig + ')');
  m.tables = byKey(m.tables, (t) => t.name);
  for (const k of ['triggers', 'policies', 'cron', 'global', 'other']) m[k] = [...new Set(m[k])].sort();
  return m;
}
function human(file, o) {
  const L = [`== ${path.basename(file)}`];
  for (const f of o.functions) L.push(`  function ${f.name}(${f.sig ?? '*'})  [${f.how.join(',')}]`);
  for (const t of o.tables) L.push(`  table    ${t.name}  [${t.how.join(',')}]`);
  for (const t of o.triggers) L.push(`  trigger  ${t}`);
  for (const t of o.policies) L.push(`  policy   ${t}`);
  for (const t of o.cron) L.push(`  cron     ${t}`);
  for (const t of o.global) L.push(`  global   ${t} (text of every function with a CR; not in the snapshot)`);
  for (const t of o.other) L.push(`  other    ${t}`);
  if (L.length === 1) L.push('  (nothing found)');
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  let files = argv.filter((a) => !a.startsWith('--')).map(resolve);
  if (flags.has('--order')) files = orderFiles();
  if (!files.length) { console.error('usage: objects.mjs [--json | --snapshot-sql] (<file.sql | 0xxx> ... | --order)'); process.exit(2); }
  const per = files.map((f) => ({ file: path.basename(f), ...objectsOf(fs.readFileSync(f, 'utf8')) }));
  if (flags.has('--snapshot-sql')) console.log(snapshotSql(merge(per), per.map((p) => p.file).join(' + ')));
  else if (flags.has('--guard-sql')) console.log(guardSql(merge(per), per.map((p) => p.file).join(' + ')));
  else if (flags.has('--json')) console.log(JSON.stringify(per, null, 1));
  else console.log(per.map((p) => human(p.file, p)).join('\n'));
}
