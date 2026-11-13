-- 0513 · MY PLACE SUGGESTIONS (lane polish3, I-69). OWNER-RUN, any time after 0082 (place_suggestions). Additive: one new function.
-- The sender of "➕ Lägg till ställe här" sees what happened to their own suggestions in the app ("📋 Mina förslag").
-- my_place_suggestions(): ONLY the signed-in user's own rows (newest first, max 50): id, name, type, status
-- (pending | ok | rejected), created_at, status_at, bar_id, lat, lng. No other user's rows, no user ids, no owner data.
-- Old clients do not call it. Safe to run again (create or replace; the grants repeat without error).
-- Check after the run (expect t, t, f):
--   select exists (select 1 from pg_proc where proname = 'my_place_suggestions'),
--          has_function_privilege('authenticated', 'public.my_place_suggestions()', 'execute'),
--          has_function_privilege('anon', 'public.my_place_suggestions()', 'execute');
create or replace function public.my_place_suggestions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'type', s.type, 'status', s.status,
             'created_at', s.created_at, 'status_at', s.status_at, 'bar_id', s.bar_id, 'lat', s.lat, 'lng', s.lng)
           order by s.created_at desc, s.id desc)
    from (select x.* from public.place_suggestions x where x.user_id = v_uid order by x.created_at desc, x.id desc limit 50) s
  ), '[]'::jsonb);
end; $$;

do $$
begin
  execute 'revoke all on function public.my_place_suggestions() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.my_place_suggestions() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.my_place_suggestions() to authenticated';
  end if;
end $$;

select public.olnu_strip_cr();
