-- 0436 · CR-SAFE PATCHES (11 Nov 2026, found during the owner's SQL session). OWNER-RUN. Run it once now, and again
-- at the END of every SQL session in the Supabase SQL editor.
-- Why: on Windows, a copy + paste into the SQL editor turns every line end into CR LF. Then:
--   (a) every function that a pasted file creates gets CR characters in its stored text, and
--   (b) a multi-line anchor in a pasted anchor patch (0431 olnu_rally_rows) has a CR that the stored text does not have,
--       so olnu_sec_patch says "anchor found 0 times" and changes nothing.
-- Fix:
--   1. olnu_sec_patch ignores CR characters in the stored text, the anchors and the new text (same answer otherwise).
--   2. olnu_strip_cr() takes every function in schema public whose stored text has a CR and runs its CREATE OR REPLACE
--      again without the CR characters (same code, same signature, same grants). It returns how many it fixed.
-- Additive: no statement removes rows or objects. Safe to run many times.

create or replace function public.olnu_sec_patch(p_fn regprocedure, p_marker text, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');
  v_old text; v_new text;
  i int; n int;
begin
  if position(replace(p_marker, chr(13), '') in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    v_old := replace(p_old[i], chr(13), '');
    v_new := replace(p_new[i], chr(13), '');
    n := (length(v_def) - length(replace(v_def, v_old, ''))) / greatest(length(v_old), 1);
    if n <> 1 then
      raise exception 'olnu_sec_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, v_old, v_new);
  end loop;
  if position(replace(p_marker, chr(13), '') in v_def) = 0 then
    raise exception 'olnu_sec_patch %: marker % missing after the patch', p_fn::text, p_marker;
  end if;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_sec_patch(regprocedure, text, text[], text[]) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_sec_patch(regprocedure, text, text[], text[]) from anon, authenticated';
  end if;
end $g$;

create or replace function public.olnu_strip_cr()
returns int language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in
    select p.oid
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and position(chr(13) in pg_get_functiondef(p.oid)) > 0
  loop
    execute replace(pg_get_functiondef(r.oid), chr(13), '');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.olnu_strip_cr() from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_strip_cr() from anon, authenticated';
  end if;
end $g$;

select public.olnu_strip_cr() as functions_fixed;
