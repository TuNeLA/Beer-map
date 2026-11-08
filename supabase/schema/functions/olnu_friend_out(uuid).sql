-- public.olnu_friend_out(p_uid uuid)
-- live md5(pg_get_functiondef) = 4ad4bda8c251e82fbca5f1a68528429a
CREATE OR REPLACE FUNCTION public.olnu_friend_out(p_uid uuid)
 RETURNS TABLE(is_out boolean, town text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(now());
  p record; v_bye timestamptz; v_home timestamptz;
begin
  select * into p from public.olnu_crew_pres(p_uid);
  if p.at is null then is_out := false; town := null; return next; return; end if;
  begin
    select y.at into v_bye from public.crew_byes y where y.user_id = p_uid and y.night = v_night and y.cleared_at is null;
  exception when others then v_bye := null; end;
  begin
    select an.home_at into v_home from public.after_nights an where an.user_id = p_uid and an.night = v_night;
  exception when others then v_home := null; end;
  is_out := (v_bye is null or p.at > v_bye) and (v_home is null or p.at > v_home);
  town := case when is_out then public.olnu_town_of(coalesce(p.bar_lat, p.lat), coalesce(p.bar_lng, p.lng)) end;
  return next;
end; $function$;
