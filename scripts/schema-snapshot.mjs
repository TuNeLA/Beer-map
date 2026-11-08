#!/usr/bin/env node
// PintsNow – schema snapshot of the live Supabase database (schema "public").
//
// Builds supabase/schema/ from the Postgres catalog, close to `pg_dump --schema-only`:
// extensions, sequences, tables, functions (one file each), constraints, FKs, indexes,
// views, triggers, grants, RLS + policies, publications, pg_cron jobs (secrets redacted)
// and a list of auth/storage objects that we depend on.
//
// Only SELECT queries are used. Nothing is written to the database.
//
// Ways to run:
//   1) With a DB URL (needs psql on PATH). Use the read-only "Session pooler" string:
//        SUPABASE_DB_URL="postgresql://..." node scripts/schema-snapshot.mjs
//   2) Without DB access (for an agent with the Supabase MCP execute_sql tool):
//        node scripts/schema-snapshot.mjs --print-sql catalog   > q1.sql   (run it, save the JSON value)
//        node scripts/schema-snapshot.mjs --print-sql functions > q2.sql   (run it, save the JSON value)
//        node scripts/schema-snapshot.mjs --catalog catalog.json --fndefs fndefs.json
//      (--fndefs may be given more than once; the arrays are joined.)
//   Options: --out <dir> (default supabase/schema), --check (only compare counts, write nothing)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const CATALOG_SQL = `select json_build_object(
'meta', json_build_object('version', version(), 'now', now(), 'db', current_database()),
'extensions', (select json_agg(json_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
'types', (select json_agg(json_build_object('name',t.typname,'typtype',t.typtype,'labels',(select json_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid=t.oid),'basetype',format_type(t.typbasetype,t.typtypmod)) order by t.typname) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d')),
'sequences', (select json_agg(json_build_object('name',s.sequencename,'type',s.data_type::text,'start',s.start_value::text,'inc',s.increment_by::text,'min',s.min_value::text,'max',s.max_value::text,'cache',s.cache_size::text,'cycle',s.cycle,
   'acl',(select c.relacl::text[] from pg_class c where c.relname=s.sequencename and c.relnamespace='public'::regnamespace),
   'owned_by',(select c2.relname||'.'||a.attname from pg_class c join pg_depend d on d.objid=c.oid and d.deptype in ('a','i') join pg_class c2 on c2.oid=d.refobjid join pg_attribute a on a.attrelid=c2.oid and a.attnum=d.refobjsubid where c.relname=s.sequencename and c.relnamespace='public'::regnamespace limit 1),
   'identity',(select d.deptype='i' from pg_class c join pg_depend d on d.objid=c.oid and d.deptype in ('a','i') where c.relname=s.sequencename and c.relnamespace='public'::regnamespace limit 1)) order by s.sequencename) from pg_sequences s where s.schemaname='public'),
'tables', (select json_agg(json_build_object('name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'comment',obj_description(c.oid,'pg_class'),'acl',c.relacl::text[],
   'columns',(select json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(ad.adbin,ad.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'comment',col_description(c.oid,a.attnum),'acl',a.attacl::text[]) order by a.attnum) from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select json_agg(json_build_object('name',co.conname,'type',co.contype,'def',pg_get_constraintdef(co.oid)) order by co.contype, co.conname) from pg_constraint co where co.conrelid=c.oid)) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')),
'indexes', (select json_agg(json_build_object('table',i.tablename,'name',i.indexname,'def',i.indexdef,'constraint',exists(select 1 from pg_constraint co where co.conindid=(quote_ident(i.schemaname)||'.'||quote_ident(i.indexname))::regclass)) order by i.tablename,i.indexname) from pg_indexes i where i.schemaname='public'),
'views', (select json_agg(json_build_object('name',c.relname,'kind',c.relkind,'def',pg_get_viewdef(c.oid,true),'acl',c.relacl::text[],'options',c.reloptions) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('v','m')),
'triggers', (select json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'def',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by n.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal and (n.nspname='public' or p.pronamespace='public'::regnamespace)),
'policies', (select json_agg(json_build_object('schema',schemaname,'table',tablename,'name',policyname,'permissive',permissive,'roles',roles,'cmd',cmd,'qual',qual,'with_check',with_check) order by schemaname,tablename,policyname) from pg_policies where schemaname in ('public','storage')),
'functions', (select json_agg(json_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'argtypes',oidvectortypes(p.proargtypes),'kind',p.prokind,'secdef',p.prosecdef,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text[],'comment',obj_description(p.oid,'pg_proc'),'rettype',format_type(p.prorettype,null),'lang',l.lanname,'config',p.proconfig) order by p.proname, pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace),
'default_acl', (select json_agg(json_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'objtype',d.defaclobjtype,'acl',d.defaclacl::text[]) order by 1) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' or n.nspname is null),
'schema_acl', (select json_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text[]) from pg_namespace where nspname='public'),
'publications', (select json_agg(json_build_object('pub',pubname,'schema',schemaname,'table',tablename) order by pubname,tablename) from pg_publication_tables where schemaname='public'),
'cron', (select json_agg(json_build_object('jobid',jobid,'name',jobname,'schedule',schedule,'command',command,'active',active,'database',database,'username',username) order by jobid) from cron.job),
'fk_out', (select json_agg(json_build_object('table',c.relname,'name',co.conname,'def',pg_get_constraintdef(co.oid)) order by c.relname, co.conname) from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_class r on r.oid=co.confrelid where c.relnamespace='public'::regnamespace and r.relnamespace<>'public'::regnamespace),
'buckets', (select json_agg(json_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) order by id) from storage.buckets),
'counts', json_build_object(
   'tables',(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p')),
   'functions',(select count(*) from pg_proc where pronamespace='public'::regnamespace),
   'sequences',(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='S'),
   'views',(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind in ('v','m')),
   'indexes',(select count(*) from pg_indexes where schemaname='public'),
   'triggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal),
   'constraints',(select count(*) from pg_constraint co join pg_class c on c.oid=co.conrelid where c.relnamespace='public'::regnamespace),
   'policies',(select count(*) from pg_policies where schemaname='public'),
   'rls_tables',(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p') and relrowsecurity),
   'secdef_functions',(select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef))
)`;

export const FUNCTIONS_SQL = `select json_agg(json_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'argtypes',oidvectortypes(p.proargtypes),'def',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid))) order by p.proname, pg_get_function_identity_arguments(p.oid))
from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p','w')`;

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const opts = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []));

if (argv.includes('--print-sql')) {
  const which = opt('--print-sql');
  process.stdout.write((which === 'functions' ? FUNCTIONS_SQL : CATALOG_SQL) + '\n');
  process.exit(0);
}

const OUT = opt('--out') || path.join(process.cwd(), 'supabase', 'schema');
const CHECK = argv.includes('--check');

function psqlJson(sql) {
  const url = process.env.SUPABASE_DB_URL;
  const out = execFileSync('psql', [url, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'set transaction read only', '-c', sql], { maxBuffer: 1 << 28, encoding: 'utf8' });
  const line = out.split('\n').filter((l) => l.trim().startsWith('{') || l.trim().startsWith('[')).join('\n');
  return JSON.parse(line);
}

let catalog, fndefs;
if (opt('--catalog')) {
  catalog = JSON.parse(fs.readFileSync(opt('--catalog'), 'utf8'));
  fndefs = opts('--fndefs').flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
} else if (process.env.SUPABASE_DB_URL) {
  catalog = psqlJson(CATALOG_SQL);
  fndefs = psqlJson(FUNCTIONS_SQL);
} else {
  console.error('Need SUPABASE_DB_URL, or --catalog <file> --fndefs <file>. See the header of this file.');
  process.exit(2);
}

// ---------- helpers ----------
const qi = (s) => (/^[a-z_][a-z0-9_]*$/.test(s) && !RESERVED.has(s) ? s : '"' + s.replace(/"/g, '""') + '"');
const RESERVED = new Set(['user', 'order', 'group', 'select', 'table', 'from', 'where', 'to', 'end', 'limit', 'offset', 'default', 'check', 'primary', 'references', 'all', 'and', 'or', 'not', 'null', 'when', 'then', 'case', 'else', 'desc', 'asc', 'column', 'constraint', 'create', 'grant', 'on', 'only', 'union', 'with', 'window', 'as', 'in', 'is', 'like', 'between', 'current_user', 'session_user', 'current_date', 'current_time', 'current_timestamp', 'distinct', 'unique', 'for', 'into', 'having', 'analyse', 'analyze', 'array', 'both', 'cast', 'collate', 'deferrable', 'do', 'except', 'false', 'true', 'fetch', 'foreign', 'initially', 'intersect', 'lateral', 'leading', 'localtime', 'localtimestamp', 'placing', 'returning', 'some', 'any', 'symmetric', 'trailing', 'using', 'variadic']);
const T = (n) => 'public.' + qi(n);
const arr = (x) => x || [];
const PRIV = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN', X: 'EXECUTE', U: 'USAGE', C: 'CREATE' };
const ALL_TABLE = 'arwdDxtm';
const STD_ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];

function parseAcl(acl) {
  // "grantee=privs/grantor" ; empty grantee = PUBLIC ; "*" after a letter = with grant option
  return arr(acl).map((e) => {
    const m = e.match(/^(.*)=([a-zA-Z*]*)\/(.*)$/);
    const grantee = m[1] === '' ? 'PUBLIC' : m[1].replace(/^"|"$/g, '');
    const privs = m[2].replace(/\*/g, '');
    return { grantee, privs, grantor: m[3] };
  });
}
function grantLines(objSql, acl, owner, kind) {
  // kind: 'table' | 'function' | 'sequence' | 'view'
  const lines = [`REVOKE ALL ON ${objSql} FROM ${STD_ROLES.join(', ')};`];
  for (const g of parseAcl(acl)) {
    if (g.grantee === owner) continue;
    let what;
    if ((kind === 'table' || kind === 'view') && [...ALL_TABLE].every((c) => g.privs.includes(c))) what = 'ALL';
    else what = [...g.privs].map((c) => PRIV[c]).join(', ');
    lines.push(`GRANT ${what} ON ${objSql} TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : qi(g.grantee)};`);
  }
  return lines;
}
function redact(s) {
  return String(s)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<REDACTED_JWT>')
    .replace(/(bearer\s+)[A-Za-z0-9._-]{16,}/gi, '$1<REDACTED>')
    .replace(/((?:api[_-]?key|apikey|secret|password|token|service_role)['"]?\s*[:=,]\s*['"])[^'"]{8,}/gi, '$1<REDACTED>')
    .replace(/\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, '<REDACTED_KEY>')
    .replace(/\b[A-Za-z0-9+/_-]{48,}={0,2}/g, '<REDACTED_LONG_STRING>');
}
const fnFile = (f) => {
  const base = `${f.name}(${(f.argtypes || '').replace(/, /g, ',')})`.replace(/[<>:"/\\|?*]/g, '_');
  return (base.length > 180 ? base.slice(0, 160) + '~' + crypto.createHash('md5').update(base).digest('hex').slice(0, 8) : base) + '.sql';
};
const head = (title) => `-- PintsNow schema snapshot: ${title}\n-- Generated by scripts/schema-snapshot.mjs from the live catalog (${catalog.meta.now}).\n-- Do not edit by hand. Re-run the script.\n\n`;

// ---------- build files ----------
const files = {};
const C = catalog;

// 00 extensions
files['00_extensions.sql'] = head('extensions') + 'SET check_function_bodies = false;\n\n' + arr(C.extensions).filter((e) => e.name !== 'plpgsql')
  .map((e) => `CREATE EXTENSION IF NOT EXISTS ${qi(e.name)} WITH SCHEMA ${qi(e.schema)}; -- live version ${e.version}`).join('\n') + '\n';

// 01 types + sequences
{
  let s = head('types and sequences');
  for (const t of arr(C.types)) {
    if (t.typtype === 'e') s += `CREATE TYPE ${T(t.name)} AS ENUM (${arr(t.labels).map((l) => `'${l.replace(/'/g, "''")}'`).join(', ')});\n`;
    else s += `CREATE DOMAIN ${T(t.name)} AS ${t.basetype};\n`;
  }
  // JSON numbers lose precision above 2^53; the query sends text, this guard fixes old JSON files.
  const big = (v) => (String(v) === '9223372036854776000' ? '9223372036854775807' : String(v) === '-9223372036854776000' ? '-9223372036854775808' : String(v));
  for (const q0 of arr(C.sequences)) {
    const q = { ...q0, start: big(q0.start), inc: big(q0.inc), min: big(q0.min), max: big(q0.max), cache: big(q0.cache) };
    if (q.identity) continue;
    s += `CREATE SEQUENCE ${T(q.name)} AS ${q.type} START WITH ${q.start} INCREMENT BY ${q.inc} MINVALUE ${q.min} MAXVALUE ${q.max} CACHE ${q.cache}${q.cycle ? ' CYCLE' : ''};\n`;
  }
  files['01_sequences.sql'] = s;
}

// 02 tables (columns, defaults, not null) – defaults that call public functions are set in 05
const fnNames = new Set(arr(C.functions).map((f) => f.name));
const callsPublicFn = (expr) => [...String(expr).matchAll(/([a-z_][a-z0-9_]*)\(/g)].some((m) => fnNames.has(m[1]));
const lateDefaults = [];
{
  let s = head('tables (columns, defaults, NOT NULL)');
  for (const t of arr(C.tables)) {
    const cols = arr(t.columns).map((c) => {
      let l = `    ${qi(c.name)} ${c.type}`;
      if (c.generated === 's') l += ` GENERATED ALWAYS AS (${c.default}) STORED`;
      else if (c.default != null) {
        if (callsPublicFn(c.default)) lateDefaults.push(`ALTER TABLE ONLY ${T(t.name)} ALTER COLUMN ${qi(c.name)} SET DEFAULT ${c.default};`);
        else l += ` DEFAULT ${c.default}`;
      }
      if (c.identity === 'a') l += ' GENERATED ALWAYS AS IDENTITY';
      if (c.identity === 'd') l += ' GENERATED BY DEFAULT AS IDENTITY';
      if (c.notnull) l += ' NOT NULL';
      return l;
    });
    s += `CREATE ${t.persistence === 'u' ? 'UNLOGGED ' : ''}TABLE ${T(t.name)} (\n${cols.join(',\n')}\n);\n`;
    if (t.comment) s += `COMMENT ON TABLE ${T(t.name)} IS '${t.comment.replace(/'/g, "''")}';\n`;
    for (const c of arr(t.columns)) if (c.comment) s += `COMMENT ON COLUMN ${T(t.name)}.${qi(c.name)} IS '${c.comment.replace(/'/g, "''")}';\n`;
    s += '\n';
  }
  for (const q of arr(C.sequences)) if (q.owned_by && !q.identity) {
    const [tb, col] = q.owned_by.split('.');
    s += `ALTER SEQUENCE ${T(q.name)} OWNED BY ${T(tb)}.${qi(col)};\n`;
  }
  files['02_tables.sql'] = s;
}

// 03 functions: one file each + loader list
const fnFiles = {};
const fnMeta = new Map(arr(C.functions).map((f) => [f.name + '(' + f.args + ')', f]));
for (const f of fndefs) {
  const meta = fnMeta.get(f.name + '(' + f.args + ')') || {};
  let body = `-- public.${f.name}(${f.args})\n-- live md5(pg_get_functiondef) = ${f.md5}\n` + f.def.replace(/\s*$/, '') + ';\n';
  if (meta.comment) body += `COMMENT ON FUNCTION public.${qi(f.name)}(${f.args}) IS '${meta.comment.replace(/'/g, "''")}';\n`;
  const name = fnFile({ ...f, argtypes: f.argtypes ?? meta.argtypes });
  if (fnFiles[name]) throw new Error('duplicate function file name ' + name);
  fnFiles[name] = body;
}
files['03_functions.txt'] = '# Load order for functions (alphabetical). Each file is one CREATE OR REPLACE FUNCTION.\n# Set check_function_bodies = off before loading (like pg_dump).\n' + Object.keys(fnFiles).sort().map((n) => 'functions/' + n).join('\n') + '\n';

// 04 constraints (PK, UNIQUE, CHECK, EXCLUDE, constraint triggers are in 07) + late defaults
{
  let s = head('primary keys, unique, check, exclusion constraints, late defaults');
  const order = { p: 0, u: 1, c: 2, x: 3 };
  for (const t of arr(C.tables)) for (const k of arr(t.constraints).filter((k) => k.type in order).sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name)))
    s += `ALTER TABLE ONLY ${T(t.name)} ADD CONSTRAINT ${qi(k.name)} ${k.def};\n`;
  s += '\n-- Column defaults that call public functions (need the functions first)\n' + lateDefaults.join('\n') + '\n';
  files['04_constraints.sql'] = s;
}

// 05 foreign keys
{
  let s = head('foreign keys');
  for (const t of arr(C.tables)) for (const k of arr(t.constraints).filter((k) => k.type === 'f'))
    s += `ALTER TABLE ONLY ${T(t.name)} ADD CONSTRAINT ${qi(k.name)} ${k.def};\n`;
  files['05_foreign_keys.sql'] = s;
}

// 06 indexes (not the ones that back a constraint)
files['06_indexes.sql'] = head('indexes (constraint indexes are in 04)') + arr(C.indexes).filter((i) => !i.constraint).map((i) => i.def + ';').join('\n') + '\n';

// 07 views
files['07_views.sql'] = head('views') + arr(C.views).map((v) => `CREATE ${v.kind === 'm' ? 'MATERIALIZED ' : ''}VIEW ${T(v.name)}${v.options ? ` WITH (${v.options.join(', ')})` : ''} AS\n${v.def.replace(/;\s*$/, '')};\n`).join('\n');

// 08 triggers
files['08_triggers.sql'] = head('triggers') + arr(C.triggers).map((t) => {
  let l = t.def + ';';
  if (t.enabled === 'D') l += `\nALTER TABLE ${qi(t.schema)}.${qi(t.table)} DISABLE TRIGGER ${qi(t.name)};`;
  if (t.enabled === 'A') l += `\nALTER TABLE ${qi(t.schema)}.${qi(t.table)} ENABLE ALWAYS TRIGGER ${qi(t.name)};`;
  if (t.enabled === 'R') l += `\nALTER TABLE ${qi(t.schema)}.${qi(t.table)} ENABLE REPLICA TRIGGER ${qi(t.name)};`;
  return l;
}).join('\n') + '\n';

// 09 grants
{
  let s = head('grants (tables, views, sequences, functions, default privileges)');
  s += '-- Each object: first REVOKE from the standard API roles, then GRANT exactly what live has.\n\n-- Tables\n';
  for (const t of arr(C.tables)) s += grantLines(`TABLE ${T(t.name)}`, t.acl, t.owner, 'table').join('\n') + '\n';
  for (const t of arr(C.tables)) for (const c of arr(t.columns)) for (const g of parseAcl(c.acl))
    s += `GRANT ${[...g.privs].map((x) => PRIV[x]).join(', ')} (${qi(c.name)}) ON TABLE ${T(t.name)} TO ${g.grantee};\n`;
  s += '\n-- Views\n';
  for (const v of arr(C.views)) s += grantLines(`TABLE ${T(v.name)}`, v.acl, 'postgres', 'view').join('\n') + '\n';
  s += '\n-- Sequences\n';
  for (const q of arr(C.sequences)) if (q.acl !== undefined) s += grantLines(`SEQUENCE ${T(q.name)}`, q.acl, 'postgres', 'sequence').join('\n') + '\n';
  s += '\n-- Functions\n';
  for (const f of arr(C.functions)) s += grantLines(`FUNCTION public.${qi(f.name)}(${f.args})`, f.acl, f.owner, 'function').join('\n') + '\n';
  s += '\n-- Default privileges (only the ones the role "postgres" owns; supabase_admin defaults come with every new project)\n';
  const OT = { r: 'TABLES', S: 'SEQUENCES', f: 'FUNCTIONS', T: 'TYPES' };
  for (const d of arr(C.default_acl)) {
    const pre = `ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(d.role)}${d.schema ? ' IN SCHEMA ' + qi(d.schema) : ''}`;
    const lines = [`${pre} REVOKE ALL ON ${OT[d.objtype]} FROM ${STD_ROLES.join(', ')};`];
    for (const g of parseAcl(d.acl)) if (g.grantee !== d.role) lines.push(`${pre} GRANT ${d.objtype === 'r' && g.privs === ALL_TABLE ? 'ALL' : [...g.privs].map((x) => PRIV[x]).join(', ')} ON ${OT[d.objtype]} TO ${g.grantee};`);
    s += (d.role === 'postgres' ? '' : '-- (live only, set by platform) ') + lines.join(d.role === 'postgres' ? '\n' : '\n-- (live only, set by platform) ') + '\n';
  }
  files['09_grants.sql'] = s;
}

// 10 RLS + policies
{
  let s = head('row level security and policies');
  for (const t of arr(C.tables)) {
    if (t.rls) s += `ALTER TABLE ${T(t.name)} ENABLE ROW LEVEL SECURITY;\n`;
    if (t.force_rls) s += `ALTER TABLE ${T(t.name)} FORCE ROW LEVEL SECURITY;\n`;
  }
  s += `\n-- Policies: ${arr(C.policies).length} (public + storage)\n`;
  for (const p of arr(C.policies)) {
    s += `CREATE POLICY ${qi(p.name)} ON ${qi(p.schema)}.${qi(p.table)} AS ${p.permissive} FOR ${p.cmd} TO ${arr(p.roles).join(', ')}` +
      (p.qual ? ` USING (${p.qual})` : '') + (p.with_check ? ` WITH CHECK (${p.with_check})` : '') + ';\n';
  }
  files['10_rls_policies.sql'] = s;
}

// 11 publications (realtime)
files['11_publications.sql'] = head('publications (realtime)') + (arr(C.publications).length
  ? arr(C.publications).map((p) => `ALTER PUBLICATION ${qi(p.pub)} ADD TABLE ${T(p.table)};`).join('\n') + '\n'
  : '-- None. No public table is in a publication.\n');

// 12 cron (never applied by the staging script)
files['12_cron.sql'] = head('pg_cron jobs (secrets redacted). NOT applied to staging.') +
  '-- To schedule on a new production project, run the lines below by hand.\n' +
  arr(C.cron).map((j) => `-- job ${j.jobid} active=${j.active} user=${j.username}\nSELECT cron.schedule('${j.name}', '${j.schedule}', $cron$${redact(j.command)}$cron$);`).join('\n') + '\n';

// DEPENDENCIES.md – auth/storage/extension objects we depend on
{
  const ext = {};
  for (const f of fndefs) for (const m of f.def.matchAll(/\b(auth|storage|extensions|vault|net|cron|realtime|pgsodium|graphql)\.([a-z_0-9]+)/gi)) {
    const k = m[1].toLowerCase() + '.' + m[2];
    (ext[k] = ext[k] || new Set()).add(f.name);
  }
  let s = '# Objects outside `public` that the schema depends on\n\nGenerated by `scripts/schema-snapshot.mjs`. These objects are made by Supabase in every new project. They are not in this snapshot.\n\n';
  s += '## Referenced in function bodies\n\n| Object | Functions that use it |\n|---|---|\n';
  for (const k of Object.keys(ext).sort()) s += `| \`${k}\` | ${[...ext[k]].sort().map((n) => '`' + n + '`').join(', ')} |\n`;
  s += '\n## Foreign keys from public to other schemas\n\n| Table | Constraint |\n|---|---|\n';
  for (const f of arr(C.fk_out)) s += `| \`${f.table}\` | \`${f.def}\` |\n`;
  s += '\n## Triggers on non-public tables that call public functions\n\n';
  const ext_tr = arr(C.triggers).filter((t) => t.schema !== 'public');
  s += ext_tr.length ? ext_tr.map((t) => `- \`${t.schema}.${t.table}\`: \`${t.name}\``).join('\n') + '\n' : 'None.\n';
  s += '\n## Storage buckets\n\n' + (arr(C.buckets).length ? arr(C.buckets).map((b) => `- \`${b.id}\` public=${b.public}`).join('\n') + '\n' : 'None.\n');
  s += '\n## Storage policies\n\n' + (arr(C.policies).filter((p) => p.schema === 'storage').length + ' (see 10_rls_policies.sql).\n');
  s += '\n## Extensions\n\n' + arr(C.extensions).map((e) => `- \`${e.name}\` ${e.version} in schema \`${e.schema}\``).join('\n') + '\n';
  files['DEPENDENCIES.md'] = s;
}

// counts.json – for verification
const counts = {
  generated_at: catalog.meta.now,
  postgres: catalog.meta.version,
  catalog_counts: catalog.counts || null,
  snapshot_counts: {
    tables: arr(C.tables).length,
    columns: arr(C.tables).reduce((n, t) => n + arr(t.columns).length, 0),
    functions: Object.keys(fnFiles).length,
    security_definer_functions: arr(C.functions).filter((f) => f.secdef).length,
    trigger_functions: arr(C.functions).filter((f) => f.rettype === 'trigger').length,
    sequences: arr(C.sequences).length,
    views: arr(C.views).length,
    indexes_total: arr(C.indexes).length,
    indexes_standalone: arr(C.indexes).filter((i) => !i.constraint).length,
    constraints: arr(C.tables).reduce((n, t) => n + arr(t.constraints).length, 0),
    constraints_by_type: arr(C.tables).flatMap((t) => arr(t.constraints)).reduce((o, k) => ((o[k.type] = (o[k.type] || 0) + 1), o), {}),
    triggers: arr(C.triggers).length,
    rls_tables: arr(C.tables).filter((t) => t.rls).length,
    policies: arr(C.policies).length,
    extensions: arr(C.extensions).length,
    cron_jobs: arr(C.cron).length,
    function_execute: {
      public_grant: arr(C.functions).filter((f) => parseAcl(f.acl).some((g) => g.grantee === 'PUBLIC')).length,
      anon_grant: arr(C.functions).filter((f) => parseAcl(f.acl).some((g) => g.grantee === 'anon')).length,
      authenticated_grant: arr(C.functions).filter((f) => parseAcl(f.acl).some((g) => g.grantee === 'authenticated')).length,
      service_role_only: arr(C.functions).filter((f) => parseAcl(f.acl).every((g) => ['postgres', 'service_role'].includes(g.grantee))).length,
    },
  },
};
files['counts.json'] = JSON.stringify(counts, null, 2) + '\n';

// verify
const problems = [];
const cc = catalog.counts;
if (cc) {
  const sc = counts.snapshot_counts;
  const pairs = [['tables', sc.tables], ['functions', sc.functions], ['sequences', sc.sequences], ['views', sc.views], ['indexes', sc.indexes_total], ['triggers', sc.triggers], ['constraints', sc.constraints], ['policies', arr(C.policies).filter((p) => p.schema === 'public').length], ['rls_tables', sc.rls_tables], ['secdef_functions', sc.security_definer_functions]];
  for (const [k, v] of pairs) if (Number(cc[k]) !== v) problems.push(`${k}: catalog ${cc[k]} vs snapshot ${v}`);
}
for (const f of fndefs) if (crypto.createHash('md5').update(f.def).digest('hex') !== f.md5) problems.push('md5 mismatch ' + f.name);
if (fndefs.length !== arr(C.functions).length) problems.push(`function defs ${fndefs.length} vs catalog functions ${arr(C.functions).length}`);

console.log(JSON.stringify(counts.snapshot_counts));
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exitCode = 1; }
else console.log('Counts match the catalog.');

if (!CHECK) {
  fs.mkdirSync(path.join(OUT, 'functions'), { recursive: true });
  for (const old of fs.readdirSync(path.join(OUT, 'functions'))) if (old.endsWith('.sql')) fs.unlinkSync(path.join(OUT, 'functions', old));
  for (const [n, b] of Object.entries(fnFiles)) fs.writeFileSync(path.join(OUT, 'functions', n), b);
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(OUT, n), b);
  console.log(`Wrote ${Object.keys(files).length} files + ${Object.keys(fnFiles).length} function files to ${OUT}`);
}
