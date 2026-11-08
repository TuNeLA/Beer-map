-- public.helg_state()
-- live md5(pg_get_functiondef) = 74a07d4de9942467d87f3c950ad00c53
CREATE OR REPLACE FUNCTION public.helg_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_helg_now();
  v_loc timestamp := v_now at time zone 'Europe/Stockholm';
  v_ev  date := public.olnu_evening(public.olnu_night_of(v_now));
  v_gs  jsonb := '[]'::jsonb;
  r record;
begin
  for r in select g.id, g.name from public.group_members gm join public.groups g on g.id = gm.group_id
            where gm.user_id = v_uid order by gm.joined_at limit 20 loop
    v_gs := v_gs || jsonb_build_array(jsonb_build_object('id', r.id, 'name', r.name) || public.olnu_helg_group(r.id, v_now));
  end loop;
  return jsonb_build_object('v', 1, 'now', v_now, 'week', public.olnu_helg_week(v_now),
    'weekend', extract(isodow from v_ev) in (5, 6, 7),
    'friday_evening', extract(isodow from v_loc) = 5 and extract(hour from v_loc) >= 17,
    'me', public.olnu_helg_calc(v_uid, v_now), 'groups', v_gs);
end;
$function$;
