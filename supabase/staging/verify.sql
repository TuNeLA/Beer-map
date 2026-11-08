-- Counts to compare with supabase/schema/counts.json (live).
SELECT json_build_object(
  'tables', (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p')),
  'functions', (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace),
  'secdef_functions', (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef),
  'sequences', (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S'),
  'views', (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('v','m')),
  'indexes', (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'),
  'triggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal),
  'constraints', (SELECT count(*) FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid WHERE c.relnamespace = 'public'::regnamespace),
  'rls_tables', (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p') AND relrowsecurity),
  'policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
  'fn_anon', (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND has_function_privilege('anon', oid, 'EXECUTE')),
  'fn_authenticated', (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND has_function_privilege('authenticated', oid, 'EXECUTE')),
  'tables_anon_select', (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND has_table_privilege('anon', oid, 'SELECT')),
  'cron_jobs', (SELECT count(*) FROM cron.job)
);
