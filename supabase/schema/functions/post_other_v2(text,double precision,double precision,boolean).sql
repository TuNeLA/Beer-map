-- public.post_other_v2(p_kind text, p_lat double precision, p_lng double precision, p_precise boolean)
-- live md5(pg_get_functiondef) = 377e54dc1732ad5ef02b4917772960b5
CREATE OR REPLACE FUNCTION public.post_other_v2(p_kind text, p_lat double precision, p_lng double precision, p_precise boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := public.olnu_uid();
  v_kind   text := lower(btrim(coalesce(p_kind, '')));
  v_lat    float8 := p_lat;
  v_lng    float8 := p_lng;
  v_r      jsonb;
  v_row    public.beers%rowtype;
  v_drinks int;
begin
  if v_kind not in ('rom', 'vin', 'cider', 'drink', 'shot', 'whisky', 'annat', 'grogg', 'bubbel') then
    raise exception 'invalid_kind';
  end if;
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if not public.olnu_in_se_box(p_lat, p_lng) then
    perform set_config('olnu.world_pos', p_lat::text || ',' || p_lng::text, true);
    v_lat := 62.0;
    v_lng := 15.0;
  end if;
  if v_kind in ('grogg', 'bubbel') then
    v_r := public.post_other('annat', v_lat, v_lng, p_precise)::jsonb;
    perform set_config('olnu.world_pos', '', true);
    if (v_r->>'accepted')::boolean then
      update public.beers set other_kind = v_kind where id = (v_r->>'id')::bigint and user_id = v_uid;
      v_r := jsonb_set(v_r, '{other_kind}', to_jsonb(v_kind));
    end if;
  else
    v_r := public.post_other(v_kind, v_lat, v_lng, p_precise)::jsonb;
    perform set_config('olnu.world_pos', '', true);
  end if;
  select * into v_row from public.beers b where b.id = (v_r->>'id')::bigint;
  v_drinks := coalesce(v_row.beer_count, 0) + coalesce(v_row.other_count, 0);
  return (v_r || jsonb_build_object(
    'lat', v_row.lat,
    'lng', v_row.lng,
    'drinks', v_drinks,
    'milestone', case when (v_r->>'accepted')::boolean and v_drinks in (1, 5, 10) then v_drinks end))::json;
end;
$function$;
