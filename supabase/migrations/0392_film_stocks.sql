-- 0345 ENGÅNGSKAMERAN · FILMRULLAR (film stocks) + SPARA ALLA. ADDITIVE ONLY: one new table, three new functions. Idempotent.
-- Client: docs/js/filmfx.js (the look, applied on the phone at the click; the original never leaves the phone)
--         docs/js/film.js (picker in the camera sheet, film name in the album, "Spara alla").
--
-- One film per group per night. Any member can change it until the first photo of the night is on the roll; then it is
-- locked ("film_locked"). No row = the default film 'kvall' (Kvällsljus 400). The meaning of "no row" never changes.
-- The table keeps no user id (nothing for "Radera mina data" to sweep). RLS on, no policies, no grants: only the
-- SECURITY DEFINER functions below read or write it.
--   film_stock(group)            → {night, film, locked, set_at, nights:[{night, film}]}   (film null = default)
--   film_set_stock(group, film)  → {night, film, locked}   errors: not_authenticated, not_member, invalid_film, film_locked, slow_down
--   film_save_list(group, night) → the developed photos this user may save: alive, author still a member, not blocked
--                                  either way (olnu_ub_hidden), not hidden by reports (bytes gone). Plus group name + film.

create table if not exists public.film_stocks (
  group_id uuid not null,
  night    timestamptz not null,
  film     text not null check (film ~ '^[a-z0-9_]{1,24}$'),
  set_at   timestamptz not null default now(),
  primary key (group_id, night)
);
alter table public.film_stocks enable row level security;
revoke all on table public.film_stocks from public, anon, authenticated;

create or replace function public.olnu_film_stocks_ok()
returns text[] language sql immutable as $$
  select array['kvall', 'midsommar', 'fjall', 'svartvit', 'blixt', 'retro']::text[];
$$;

create or replace function public.film_stock(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_row   public.film_stocks;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select * into v_row from public.film_stocks s where s.group_id = p_group_id and s.night = v_night;
  return jsonb_build_object(
    'night', v_night,
    'film', v_row.film,
    'set_at', v_row.set_at,
    'locked', exists (select 1 from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night),
    'nights', coalesce((select jsonb_agg(jsonb_build_object('night', s.night, 'film', s.film) order by s.night desc)
                          from (select * from public.film_stocks s2 where s2.group_id = p_group_id
                                   and s2.night > now() - interval '40 days' order by s2.night desc limit 20) s), '[]'::jsonb));
end; $function$;

create or replace function public.film_set_stock(p_group_id uuid, p_film text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_prev  public.film_stocks;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_film is null or not (p_film = any (public.olnu_film_stocks_ok())) then raise exception 'invalid_film'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_film_g:' || p_group_id::text, 0));   -- same lock as film_shoot
  if exists (select 1 from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night) then
    raise exception 'film_locked';
  end if;
  select * into v_prev from public.film_stocks s where s.group_id = p_group_id and s.night = v_night;
  if v_prev.set_at is not null and v_prev.set_at > now() - interval '1 second' and v_prev.film <> p_film then
    raise exception 'slow_down';
  end if;
  insert into public.film_stocks (group_id, night, film, set_at) values (p_group_id, v_night, p_film, now())
  on conflict (group_id, night) do update set film = excluded.film, set_at = excluded.set_at;
  return jsonb_build_object('night', v_night, 'film', p_film, 'locked', false);
end; $function$;

create or replace function public.film_save_list(p_group_id uuid, p_night timestamptz)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_rev timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_night is null then raise exception 'photo_not_found'; end if;
  v_rev := (select min(sp.reveal_at) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = p_night);
  if v_rev is null or v_rev > now() then
    return jsonb_build_object('night', p_night, 'developed', false, 'photos', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'night', p_night, 'developed', true, 'evening', public.olnu_evening(p_night),
    'group_name', (select g.name from public.groups g where g.id = p_group_id),
    'film', (select s.film from public.film_stocks s where s.group_id = p_group_id and s.night = p_night),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'w', sp.w, 'h', sp.h, 'at', sp.created_at) order by sp.created_at, sp.id)
                          from public.snap_photos sp
                         where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = p_night
                           and sp.bytes is not null and sp.expires_at > now()
                           and exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = sp.user_id)
                           and not public.olnu_ub_hidden(v_uid, sp.user_id)), '[]'::jsonb));
end; $function$;

revoke all on function public.olnu_film_stocks_ok() from public, anon, authenticated;
revoke all on function public.film_stock(uuid) from public, anon;
revoke all on function public.film_set_stock(uuid, text) from public, anon;
revoke all on function public.film_save_list(uuid, timestamptz) from public, anon;
grant execute on function public.film_stock(uuid) to authenticated;
grant execute on function public.film_set_stock(uuid, text) to authenticated;
grant execute on function public.film_save_list(uuid, timestamptz) to authenticated;
