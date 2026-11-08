-- public.set_beer_type(p_type text)
-- live md5(pg_get_functiondef) = b29d43d65c1400f37bff901da4710f19
CREATE OR REPLACE FUNCTION public.set_beer_type(p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_t   text := lower(btrim(coalesce(p_type, '')));
  v_b   public.beers%rowtype;
begin
  if v_t not in ('lager', 'pilsner', 'ipa', 'apa', 'stout', 'vete', 'ale', 'sour', 'alkfri', 'annan') then
    raise exception 'invalid_type';
  end if;
  select * into v_b from public.beers b where b.user_id = v_uid and b.expires_at > now() and b.beer_count >= 1;
  if not found then raise exception 'no_beer'; end if;
  insert into public.beer_types as bt (user_id, night, n, type, lat, lng, created_at, updated_at)
  values (v_uid, v_b.expires_at, v_b.beer_count, v_t,
          round(v_b.lat::numeric, 2)::float8, round(v_b.lng::numeric, 2)::float8, now(), now())
  on conflict (user_id, night, n) do update set type = excluded.type, updated_at = now();
  return jsonb_build_object('ok', true, 'type', v_t, 'n', v_b.beer_count);
end;
$function$;
