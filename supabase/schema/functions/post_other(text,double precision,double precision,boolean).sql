-- public.post_other(p_kind text, p_lat double precision, p_lng double precision, p_precise boolean)
-- live md5(pg_get_functiondef) = 5bc620327df6360e3d2c804b83db174c
CREATE OR REPLACE FUNCTION public.post_other(p_kind text, p_lat double precision, p_lng double precision, p_precise boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_precise boolean := coalesce(p_precise, false);
  v_lat float8; v_lng float8;
  v_row public.beers%rowtype;
  v_accepted boolean := true;
  v_wait int := 0;
  v_cooldown constant interval := interval '10 minutes';
begin
  if v_kind not in ('rom', 'vin', 'cider', 'drink', 'shot', 'whisky', 'annat') then
    raise exception 'invalid_kind';
  end if;
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
    if v_row.other_at is not null and v_row.other_at > now() - v_cooldown then
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (v_row.other_at + v_cooldown - now())))::int);
    else
      update public.beers set lat = v_lat, lng = v_lng, precise = v_precise,
             other_count = other_count + 1, other_kind = v_kind, other_at = now(),
             updated_at = now(), stopped = false
       where id = v_row.id returning * into v_row;
    end if;
  else
    insert into public.beers (user_id, lat, lng, precise, expires_at, beer_count, other_count, other_kind, other_at)
    values (v_uid, v_lat, v_lng, v_precise, public.olnu_next_expiry(), 0, 1, v_kind, now())
    on conflict (user_id) do nothing returning * into v_row;
    if v_row.id is null then
      select * into v_row from public.beers where user_id = v_uid;
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (coalesce(v_row.other_at, now()) + v_cooldown - now())))::int);
    end if;
  end if;
  return json_build_object('accepted', v_accepted, 'wait_seconds', v_wait, 'id', v_row.id,
    'beer_count', v_row.beer_count, 'other_count', v_row.other_count, 'other_kind', v_row.other_kind,
    'expires_at', v_row.expires_at);
end; $function$;
