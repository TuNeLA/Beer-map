-- public.post_beer_v2(p_lat double precision, p_lng double precision, p_precise boolean, p_hidden boolean)
-- live md5(pg_get_functiondef) = 5a15e1c07a7ebe2b57d902a03f582cbb
CREATE OR REPLACE FUNCTION public.post_beer_v2(p_lat double precision, p_lng double precision, p_precise boolean, p_hidden boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := public.olnu_uid();
  v_hidden boolean := coalesce(p_hidden, false);
  v_lat    float8 := p_lat;
  v_lng    float8 := p_lng;
  v_r      jsonb;
  v_row    public.beers%rowtype;
  v_drinks int;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if not public.olnu_in_se_box(p_lat, p_lng) then
    perform set_config('olnu.world_pos', p_lat::text || ',' || p_lng::text, true);
    v_lat := 62.0;
    v_lng := 15.0;
  end if;
  if v_hidden then
    perform set_config('olnu.ghost', '1', true);
    v_r := public.post_beer(v_lat, v_lng, false)::jsonb;
    perform set_config('olnu.ghost', '', true);
    perform set_config('olnu.world_pos', '', true);
    if (v_r->>'accepted')::boolean then
      update public.beers set stopped = true, ghost = true
       where id = (v_r->>'id')::bigint and user_id = v_uid;
      begin
        insert into public.owner_hours as h (hour, beers) values (date_trunc('hour', now()), 1)
        on conflict (hour) do update set beers = h.beers + 1;
      exception when others then
        null;
      end;
    end if;
  else
    v_r := public.post_beer(v_lat, v_lng, p_precise)::jsonb;
    perform set_config('olnu.world_pos', '', true);
  end if;

  select * into v_row from public.beers b where b.id = (v_r->>'id')::bigint;
  v_drinks := coalesce(v_row.beer_count, 0) + coalesce(v_row.other_count, 0);
  return v_r || jsonb_build_object(
    'hidden', coalesce(v_row.stopped, false),
    'undo_until', case when (v_r->>'accepted')::boolean then v_row.beer_at + interval '2 minutes' end,
    'undos_left', greatest(0, 3 - coalesce(v_row.undo_count, 0)),
    'lat', v_row.lat,
    'lng', v_row.lng,
    'drinks', v_drinks,
    'milestone', case when (v_r->>'accepted')::boolean and v_drinks in (1, 5, 10) then v_drinks end);
end;
$function$;
