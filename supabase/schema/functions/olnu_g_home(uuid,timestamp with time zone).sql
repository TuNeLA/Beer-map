-- public.olnu_g_home(p_uid uuid, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = b6563185262202d7d13b88eea52dabee
CREATE OR REPLACE FUNCTION public.olnu_g_home(p_uid uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_first timestamptz;
  v_home  timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select mn.first_at into v_first from public.medal_nights mn where mn.user_id = p_uid and mn.night = v_night;
  insert into public.game_facts as f (user_id, night, home_at) values (p_uid, v_night, p_now)
  on conflict (user_id, night) do update
     set home_at = case when f.home_at is null or (v_first is not null and f.home_at < v_first) then excluded.home_at
                        else f.home_at end
  returning f.home_at into v_home;
  return jsonb_build_object('ok', true, 'home_at', v_home);
end;
$function$;
