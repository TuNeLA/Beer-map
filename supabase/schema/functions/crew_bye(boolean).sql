-- public.crew_bye(p_on boolean)
-- live md5(pg_get_functiondef) = 7375927a7dfbbcaef4d0fe11760dac12
CREATE OR REPLACE FUNCTION public.crew_bye(p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_at timestamptz;
begin
  if coalesce(p_on, true) then
    insert into public.crew_byes (user_id, night, at) values (v_uid, v_night, now())
    on conflict (user_id, night) do update set at = now(), cleared_at = null;
    v_at := now();
  else
    update public.crew_byes y set cleared_at = now() where y.user_id = v_uid and y.night = v_night;
  end if;
  return jsonb_build_object('ok', true, 'bye_at', v_at);
end; $function$;
