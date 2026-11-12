-- 0501 · CR-SAFE ANCHOR HELPERS (w1-server, 12 Nov 2026). OWNER-RUN. Run it at the START of the release-day SQL session.
-- Why: on Windows, a copy + paste into the Supabase SQL editor turns every line end into CR LF. 0436 made olnu_sec_patch
-- CR-safe. The other anchor helpers were not: a multi-line anchor with a CR (or a function text with a CR from an earlier
-- paste in the same session) gave "anchor found 0 times". This file makes all of them CR-safe in the same way as 0436:
-- the helper strips CR from the stored function text, from each anchor, from each new text and from the marker.
-- The answer is the same as before for text without CR. Signatures, owners and grants stay the same.
-- Helpers: olnu_tz_patch (0149), olnu_ub_patch (0403), olnu_load_patch (0465), olnu_fixp_patch (0466),
--          olnu_fixm_patch (0480), olnu_fixmo_patch (0481). The release-day files 0465, 0466, 0480 and 0481 make their
--          own helper with the same CR-safe text, so the order of 0501 and those files does not matter.
-- Rule (supabase/README.md): no NEW anchor patches. These helpers stay only for the files that already use them.
-- Additive: only CREATE OR REPLACE FUNCTION and REVOKE. No statement removes rows or objects. Safe to run many times.
-- Check after the run (expect t, t, t, t, t, t):
--   select position('chr(13)' in pg_get_functiondef('public.olnu_tz_patch(regprocedure,text[],text[])'::regprocedure)) > 0,
--          position('chr(13)' in pg_get_functiondef('public.olnu_ub_patch(regprocedure,text[],text[])'::regprocedure)) > 0,
--          position('chr(13)' in pg_get_functiondef('public.olnu_load_patch(regprocedure,text[],text[])'::regprocedure)) > 0,
--          position('chr(13)' in pg_get_functiondef('public.olnu_fixp_patch(regprocedure,text,text[],text[])'::regprocedure)) > 0,
--          position('chr(13)' in pg_get_functiondef('public.olnu_fixm_patch(regprocedure,text,text[],text[])'::regprocedure)) > 0,
--          position('chr(13)' in pg_get_functiondef('public.olnu_fixmo_patch(regprocedure,text,text[],text[])'::regprocedure)) > 0;

-- olnu_tz_patch: first made in 0149. Same text, only the CR-safe lines are new.
create or replace function public.olnu_tz_patch(p_fn regprocedure, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');   -- CR-safe (0501, like 0436 olnu_sec_patch)
  i int; n int;
begin
  p_old := array(select replace(x, chr(13), '') from unnest(p_old) with ordinality u(x, o) order by o);
  p_new := array(select replace(x, chr(13), '') from unnest(p_new) with ordinality u(x, o) order by o);
  if position('olnu_is_test_' in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_tz_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_tz_patch(regprocedure, text[], text[]) from public;

-- olnu_ub_patch: first made in 0403. Same text, only the CR-safe lines are new.
create or replace function public.olnu_ub_patch(p_fn regprocedure, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');   -- CR-safe (0501, like 0436 olnu_sec_patch)
  i int; n int;
begin
  p_old := array(select replace(x, chr(13), '') from unnest(p_old) with ordinality u(x, o) order by o);
  p_new := array(select replace(x, chr(13), '') from unnest(p_new) with ordinality u(x, o) order by o);
  if position('olnu_ub_hidden' in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_ub_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_ub_patch(regprocedure, text[], text[]) from public;

-- olnu_load_patch: first made in 0465. Same text, only the CR-safe lines are new.
create or replace function public.olnu_load_patch(p_fn regprocedure, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');   -- CR-safe (0501, like 0436 olnu_sec_patch)
  i int; n int;
begin
  p_old := array(select replace(x, chr(13), '') from unnest(p_old) with ordinality u(x, o) order by o);
  p_new := array(select replace(x, chr(13), '') from unnest(p_new) with ordinality u(x, o) order by o);
  if position('load0465' in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_load_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_load_patch(regprocedure, text[], text[]) from public;

-- olnu_fixp_patch: first made in 0466. Same text, only the CR-safe lines are new.
create or replace function public.olnu_fixp_patch(p_fn regprocedure, p_marker text, p_old text[], p_new text[])
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
      raise exception 'olnu_fixp_patch %: anchor % found % times (run 0465 first)', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  if position(p_marker in v_def) = 0 then
    raise exception 'olnu_fixp_patch %: marker % missing after the patch', p_fn::text, p_marker;
  end if;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_fixp_patch(regprocedure, text, text[], text[]) from public;

-- olnu_fixm_patch: first made in 0480. Same text, only the CR-safe lines are new.
create or replace function public.olnu_fixm_patch(p_fn regprocedure, p_marker text, p_old text[], p_new text[])
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
      raise exception 'olnu_fixm_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  if position(p_marker in v_def) = 0 then
    raise exception 'olnu_fixm_patch %: marker % missing after the patch', p_fn::text, p_marker;
  end if;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_fixm_patch(regprocedure, text, text[], text[]) from public;

-- olnu_fixmo_patch: first made in 0481. Same text, only the CR-safe lines are new.
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
    execute 'revoke all on function public.olnu_tz_patch(regprocedure, text[], text[]) from anon, authenticated';
    execute 'revoke all on function public.olnu_ub_patch(regprocedure, text[], text[]) from anon, authenticated';
    execute 'revoke all on function public.olnu_load_patch(regprocedure, text[], text[]) from anon, authenticated';
    execute 'revoke all on function public.olnu_fixp_patch(regprocedure, text, text[], text[]) from anon, authenticated';
    execute 'revoke all on function public.olnu_fixm_patch(regprocedure, text, text[], text[]) from anon, authenticated';
    execute 'revoke all on function public.olnu_fixmo_patch(regprocedure, text, text[], text[]) from anon, authenticated';
  end if;
end $g$;

select public.olnu_strip_cr() as functions_fixed;
