-- public.my_night_code(p_last boolean)
-- live md5(pg_get_functiondef) = 0cb352f7315e8826796bf472b1b40eeb
CREATE OR REPLACE FUNCTION public.my_night_code(p_last boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_r     jsonb := public.my_night_report(coalesce(p_last, true));
  v_night timestamptz := (v_r->>'night')::timestamptz;
  v_sent  int := 0;
  v_yes   int := 0;
  v_water int := 0;
  v_med   int := 0;
begin
  begin
    select count(*) into v_sent from public.rallies r
     where r.user_id = v_uid and r.created_at > v_night - interval '24 hours' and r.created_at <= v_night;
    select count(*) into v_yes from public.rally_answers a join public.rallies r on r.id = a.rally_id
     where a.user_id = v_uid and a.answer = 'yes' and r.user_id <> v_uid
       and r.created_at > v_night - interval '24 hours' and r.created_at <= v_night;
  exception when others then v_sent := 0; v_yes := 0; end;
  begin
    select coalesce(gf.water, 0) into v_water from public.game_facts gf where gf.user_id = v_uid and gf.night = v_night;
  exception when others then v_water := 0; end;
  begin
    select count(*) into v_med from public.user_medals um
     where um.user_id = v_uid and um.updated_at > v_night - interval '19 hours' and um.updated_at <= v_night + interval '13 hours';
  exception when others then v_med := 0; end;
  return jsonb_build_object('v', 1, 'night', v_night, 'evening', v_r->'evening', 'out', v_r->'out',
    'drinks', coalesce((v_r->>'beers')::int, 0) + coalesce((v_r->>'others')::int, 0),
    'bars', coalesce((v_r->>'bars')::int, 0), 'checkins', coalesce((v_r->>'checkins')::int, 0),
    'skal', coalesce((v_r->>'skal_given')::int, 0) + coalesce((v_r->>'skal_got')::int, 0),
    'skal_given', coalesce((v_r->>'skal_given')::int, 0), 'skal_got', coalesce((v_r->>'skal_got')::int, 0),
    'rallies_sent', coalesce(v_sent, 0), 'rallies_yes', coalesce(v_yes, 0), 'water', coalesce(v_water, 0),
    'home', coalesce((v_r->>'home')::boolean, false), 'medals', coalesce(v_med, 0));
end;
$function$;
