-- Fingerprint of schema public. Run on live and on staging: every value must be equal.
WITH
fn AS (SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS k, p.oid, p.proacl FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
fn_def AS (SELECT k, md5(pg_get_functiondef(oid)) AS v FROM fn),
fn_acl AS (SELECT k, coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (SELECT a.grantee::regrole::text || ':' || a.privilege_type AS x FROM aclexplode(fn.proacl) a) s), 'default') AS v FROM fn),
cols AS (SELECT c.relname || '.' || a.attname AS k, format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS v
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped),
cons AS (SELECT c.relname || '.' || co.conname AS k, pg_get_constraintdef(co.oid) AS v FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid WHERE c.relnamespace = 'public'::regnamespace),
idx AS (SELECT indexname AS k, indexdef AS v FROM pg_indexes WHERE schemaname = 'public'),
trg AS (SELECT c.relname || '.' || t.tgname AS k, pg_get_triggerdef(t.oid) || ':' || t.tgenabled::text AS v FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal),
tacl AS (SELECT c.relname AS k, coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (SELECT a.grantee::regrole::text || ':' || a.privilege_type AS x FROM aclexplode(c.relacl) a) s), 'default') AS v FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'S')),
vw AS (SELECT c.relname AS k, pg_get_viewdef(c.oid, true) AS v FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v')
SELECT json_build_object(
  'functions_md5',    (SELECT md5(string_agg(k || '=' || v, ',' ORDER BY k)) FROM fn_def),
  'function_acl_md5', (SELECT md5(string_agg(k || '=' || v, ';' ORDER BY k)) FROM fn_acl),
  'columns_md5',      (SELECT md5(string_agg(k || '=' || v, ',' ORDER BY k)) FROM cols),
  'constraints_md5',  (SELECT md5(string_agg(k || '=' || v, ',' ORDER BY k)) FROM cons),
  'indexes_md5',      (SELECT md5(string_agg(k || '=' || v, ',' ORDER BY k)) FROM idx),
  'triggers_md5',     (SELECT md5(string_agg(k || '=' || v, ',' ORDER BY k)) FROM trg),
  'table_acl_md5',    (SELECT md5(string_agg(k || '=' || v, ';' ORDER BY k)) FROM tacl),
  'views_md5',        (SELECT md5(string_agg(k || '=' || v, ',' ORDER BY k)) FROM vw)
);
