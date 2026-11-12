-- 0481 FIXMO · moments + morning report use ONE clock (test teams round 2, 11 Nov: N-06, N-21, N-19; lane fixMo).
-- OWNER-RUN, AFTER 0450 + 0453 (after_report2) and 0451 (moments), and after 0430/0431. Additive: no statement removes rows
-- or objects. Safe to run twice (a definition that already has its marker is skipped).
-- For every normal user nothing changes: olnu_crew_now() is now() (0027: only a local SQL test can set olnu.crew_now, a
-- client cannot). Only staging test users (the test kit's clock offset, scripts/bots/staging-testkit.sql) see a difference.
--   1. after_report2(uuid, timestamptz): "now" = olnu_crew_now() (was now()). Without a night the report is "last night" in
--      the same clock as the moments (moments_report already uses olnu_crew_now). Test kit: Tid → 05:01 morgonrapport now
--      finds tonight's report.
--   2. olnu_mom_open: Uppdrag vid bordet keeps 60 min between its 2 rounds IN THE SAME CLOCK. It compared created_at (real
--      time) with olnu_crew_now(): with a test-kit offset the 2nd round opened 2 s after the 1st. Now the round's start is
--      greatest(created_at, closes_at - 45 min) (closes_at = start + 45 min, written in the crew clock). Live: closes_at - 45
--      min = created_at exactly (both now() of the same transaction), so the rule is the same.
--   3. olnu_mom_open: the Halvtid push said "Svara på en minut." The bet closes after 60 minutes: "Svara inom en timme."
-- Method: the anchor patch of 0149 / 0403 / 0431 / 0465 / 0480: it reads the DEPLOYED definition and makes exact text
-- replacements; each anchor must occur exactly once, or the patch stops with an error and nothing changes.
-- Check after the run (expect t, t):
--   select position('fixmo0481' in pg_get_functiondef('public.after_report2(uuid,timestamptz)'::regprocedure)) > 0,
--          position('fixmo0481' in pg_get_functiondef('public.olnu_mom_open(uuid,uuid)'::regprocedure)) > 0;

create or replace function public.olnu_fixmo_patch(p_fn regprocedure, p_marker text, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');   -- CR-safe (0501, like 0436 olnu_sec_patch)
  i int; n int;
begin
  p_old := array(select replace(x, chr(13), '') from unnest(p_old) with ordinality u(x, o) order by o);
  p_new := array(select replace(x, chr(13), '') from unnest(p_new) with ordinality u(x, o) order by o);
  p_marker := replace(p_marker, chr(13), '');
  if position(p_marker in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_fixmo_patch %: anchor % found % times (expected 1), nothing changed', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  if position(p_marker in v_def) = 0 then
    raise exception 'olnu_fixmo_patch %: marker % missing after the patch', p_fn::text, p_marker;
  end if;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_fixmo_patch(regprocedure, text, text[], text[]) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_fixmo_patch(regprocedure, text, text[], text[]) from anon, authenticated';
  end if;
end $g$;

-- 1. after_report2: the crew clock
select public.olnu_fixmo_patch('public.after_report2(uuid, timestamptz)', '/*fixmo0481*/',
  array[$a$v_now timestamptz := now();$a$],
  array[$a$v_now timestamptz := public.olnu_crew_now();   /*fixmo0481*/   -- = now() for every non-test user$a$]);

-- 2 + 3. olnu_mom_open: the bord gap in the crew clock; the true Halvtid push text
select public.olnu_fixmo_patch('public.olnu_mom_open(uuid, uuid)', '/*fixmo0481*/',
  array[$a$x.kind = 'bord' and x.created_at > v_now - interval '60 minutes')$a$,
        $a$' Svara på en minut.'$a$],
  array[$a$x.kind = 'bord' and greatest(x.created_at, x.closes_at - interval '45 minutes') > v_now - interval '60 minutes' /*fixmo0481*/)$a$,
        $a$' Svara inom en timme.'$a$]);
