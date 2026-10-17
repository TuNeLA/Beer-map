-- Öl Nu: 10 min between beers. Beer only (shots were removed before they went live).
-- Additive. Safe to run again. Old app versions keep working (same name, params, return fields).
-- shot_count / shot_at stay as unused columns so 0005's trigger compiles on every database.
alter table public.beers add column if not exists shot_count int not null default 0;
alter table public.beers add column if not exists shot_at timestamptz;
alter table public.beers add column if not exists beer_at timestamptz;
update public.beers set beer_at = updated_at where beer_at is null and beer_count > 0;

create or replace function public.post_beer(p_lat float8, p_lng float8, p_precise bool)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_precise boolean := coalesce(p_precise, false);
  v_lat float8; v_lng float8;
  v_row public.beers%rowtype;
  v_is_new boolean := false;
  v_accepted boolean := true;
  v_wait int := 0;
  v_milestone int := null;
  v_cooldown constant interval := interval '10 minutes';
  v_last timestamptz;
begin
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < 55.0 or p_lat > 69.1 or p_lng < 10.9 or p_lng > 24.2 then
    raise exception 'outside_sweden';
  end if;
  if v_precise then
    v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
  else
    v_lat := (round(p_lat::numeric / 0.005) * 0.005)::float8; v_lng := (round(p_lng::numeric / 0.01) * 0.01)::float8;
  end if;
  delete from public.beers where user_id = v_uid and expires_at <= now();
  select * into v_row from public.beers where user_id = v_uid for update;
  if found then
    v_last := case when v_row.beer_count > 0 then coalesce(v_row.beer_at, v_row.updated_at) else null end;
    if v_last is not null and v_last > now() - v_cooldown then
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (v_last + v_cooldown - now())))::int);
    else
      update public.beers set lat = v_lat, lng = v_lng, precise = v_precise,
             beer_count = beer_count + 1, updated_at = now(), beer_at = now(), stopped = false
       where id = v_row.id returning * into v_row;
    end if;
  else
    insert into public.beers (user_id, lat, lng, precise, expires_at, beer_at)
    values (v_uid, v_lat, v_lng, v_precise, public.olnu_next_expiry(), now())
    on conflict (user_id) do nothing returning * into v_row;
    if v_row.id is not null then
      v_is_new := true;
    else
      select * into v_row from public.beers where user_id = v_uid;
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (coalesce(v_row.beer_at, v_row.updated_at) + v_cooldown - now())))::int);
    end if;
  end if;
  if v_accepted and v_row.beer_count in (1, 5, 10) then v_milestone := v_row.beer_count; end if;
  return json_build_object('accepted', v_accepted, 'wait_seconds', v_wait, 'id', v_row.id,
    'lat', v_row.lat, 'lng', v_row.lng, 'beer_count', v_row.beer_count, 'is_new', v_is_new,
    'expires_at', v_row.expires_at, 'milestone', v_milestone);
end; $$;

revoke all on function public.post_beer(float8, float8, bool) from public, anon;
grant execute on function public.post_beer(float8, float8, bool) to authenticated;
