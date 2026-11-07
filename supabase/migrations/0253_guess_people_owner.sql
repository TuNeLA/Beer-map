-- 0253 🎯 Gissa kvällen → people, not beers (agent feat, 2026-11-07). OWNER RUNS THIS (it replaces 1 existing function).
-- Store-safe: the old facit counted beers logged in town (a drink count as a contest). Now the facit is the number of
-- different people who were out in town (2 mil runt) that night: a pin, a drink or a check-in in drink_log, test users
-- not counted. Same signature, so game_poll / olnu_g_oracle / guess_night keep working unchanged.
-- guess_night_kind() is new: the app shows Gissa kvällen ONLY when it returns 'folk' (before this runs the app hides
-- the game, so nobody sees a beer count). Rerun = no change.
create or replace function public.olnu_g_real(p_night timestamptz, p_lat float8, p_lng float8)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct d.user_id)::int from public.drink_log d
   where d.night = p_night and not d.undone
     and d.lat between p_lat - 0.19 and p_lat + 0.19
     and d.lng between p_lng - 0.56 and p_lng + 0.56
     and public.olnu_dist_m(p_lat, p_lng, d.lat, d.lng) <= 20000
     and not public.olnu_is_test_user(d.user_id);
$$;
revoke all on function public.olnu_g_real(timestamptz, float8, float8) from public, anon, authenticated;

create or replace function public.guess_night_kind()
returns text language sql immutable set search_path = public as $$ select 'folk'::text; $$;
do $$ begin
  execute 'revoke all on function public.guess_night_kind() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.guess_night_kind() from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.guess_night_kind() to authenticated'; end if;
end $$;
