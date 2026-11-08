-- public.undo_beer()
-- live md5(pg_get_functiondef) = 6dafa41145125132206215d4b527ec4e
CREATE OR REPLACE FUNCTION public.undo_beer()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_row  public.beers%rowtype;
  v_move boolean;
  v_n    int;
begin
  select * into v_row from public.beers b
   where b.user_id = v_uid and b.expires_at > now()
   for update;
  if not found or v_row.beer_count < 1 then
    return jsonb_build_object('ok', false, 'reason', 'no_beer', 'beer_count', coalesce(v_row.beer_count, 0),
                              'undos_left', greatest(0, 3 - coalesce(v_row.undo_count, 0)));
  end if;
  if v_row.undo_count >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'beer_count', v_row.beer_count, 'undos_left', 0);
  end if;
  if v_row.beer_at is null or v_row.beer_at <= now() - interval '2 minutes'
     or (v_row.prev_for is distinct from v_row.beer_count and v_row.beer_count <> 1) then
    return jsonb_build_object('ok', false, 'reason', 'too_late', 'beer_count', v_row.beer_count,
                              'undos_left', greatest(0, 3 - v_row.undo_count));
  end if;

  -- Heat point of this beer (same transaction time, number and night). Ghost beers have none.
  update public.beer_events e set undone = true
   where e.id = (select e2.id from public.beer_events e2
                  where e2.kind = 'beer' and e2.created_at = v_row.beer_at and e2.n = v_row.beer_count
                    and e2.expires_at = v_row.expires_at and not e2.undone
                  order by e2.id desc limit 1);
  update public.owner_hours h set beers = h.beers - 1
   where h.hour = date_trunc('hour', v_row.beer_at) and h.beers > 0;
  update public.week_beers w set n = w.n - 1
   where w.user_id = v_uid and w.week = public.olnu_week_start(v_row.beer_at) and w.n > 0;
  update public.medal_nights m set beers = least(m.beers, v_row.beer_count - 1)
   where m.user_id = v_uid and m.night = v_row.expires_at;
  update public.bar_taps t set n = t.n - 1
   where t.user_id = v_uid and t.week = public.olnu_week_start(v_row.beer_at)
     and t.last_at >= v_row.beer_at and t.n > 0;

  -- Did the pin stay where this beer put it? (another drink after the beer moves it)
  v_move := v_row.prev_for = v_row.beer_count and v_row.prev_lat is not null
            and (v_row.other_at is null or v_row.other_at <= v_row.beer_at);
  v_n := v_row.beer_count - 1;

  update public.beers b
     set beer_count = v_n,
         beer_at    = case when v_row.prev_for = v_row.beer_count then v_row.prev_beer_at else null end,
         lat        = case when v_move then v_row.prev_lat else b.lat end,
         lng        = case when v_move then v_row.prev_lng else b.lng end,
         precise    = case when v_move then coalesce(v_row.prev_precise, b.precise) else b.precise end,
         stopped    = case when v_n = 0 and coalesce(b.other_count, 0) = 0 then true
                           when v_row.prev_for = v_row.beer_count then coalesce(v_row.prev_stopped, b.stopped)
                           else b.stopped end,
         ghost      = case when v_row.prev_for = v_row.beer_count then coalesce(v_row.prev_ghost, false) else b.ghost end,
         updated_at = now(),
         undo_count = b.undo_count + 1,
         prev_lat = null, prev_lng = null, prev_precise = null, prev_stopped = null,
         prev_ghost = null, prev_beer_at = null, prev_for = null
   where b.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'reason', null, 'beer_count', v_row.beer_count,
                            'undos_left', greatest(0, 3 - v_row.undo_count),
                            'lat', v_row.lat, 'lng', v_row.lng, 'hidden', v_row.stopped);
end;
$function$;
