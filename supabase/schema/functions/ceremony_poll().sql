-- public.ceremony_poll()
-- live md5(pg_get_functiondef) = 452b64903651309b63f868c3059323e6
CREATE OR REPLACE FUNCTION public.ceremony_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_cer_now();
  v_night timestamptz := public.olnu_cer_night(v_now);
  v_day date := (v_night at time zone 'Europe/Stockholm')::date;
  v_out jsonb := '[]'::jsonb;
  r record;
begin
  for r in select gm.group_id from public.group_members gm where gm.user_id = v_uid order by gm.joined_at limit 20 loop
    v_out := v_out || jsonb_build_array(public.olnu_cer_json(r.group_id, v_uid, false));
  end loop;
  return jsonb_build_object('v', 1, 'now', v_now, 'night', v_night, 'evening', public.olnu_evening(v_night),
    'opens_at', (v_day + time '06:00') at time zone 'Europe/Stockholm',
    'closes_at', (v_day + time '18:00') at time zone 'Europe/Stockholm', 'groups', v_out);
end;
$function$;
