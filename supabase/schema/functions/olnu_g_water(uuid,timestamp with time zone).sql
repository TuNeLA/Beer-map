-- public.olnu_g_water(p_uid uuid, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 2cedce631338b90d3ce904973a1d27b0
CREATE OR REPLACE FUNCTION public.olnu_g_water(p_uid uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_f record;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  insert into public.game_facts (user_id, night) values (p_uid, v_night) on conflict do nothing;
  select * into v_f from public.game_facts f where f.user_id = p_uid and f.night = v_night;
  if v_f.water_at is not null and v_f.water_at > p_now - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'water', v_f.water,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_f.water_at + interval '5 minutes' - p_now)))::int));
  end if;
  if v_f.water >= 10 then
    return jsonb_build_object('ok', false, 'water', v_f.water, 'wait_seconds', 0, 'reason', 'limit');
  end if;
  update public.game_facts f set water = f.water + 1, water_at = p_now where f.user_id = p_uid and f.night = v_night;
  return jsonb_build_object('ok', true, 'water', v_f.water + 1, 'wait_seconds', 0);
end;
$function$;
