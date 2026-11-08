-- public.olnu_g_assign(p_uid uuid, p_night timestamp with time zone, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = b45194efd7865c81effb8d4080edb9ef
CREATE OR REPLACE FUNCTION public.olnu_g_assign(p_uid uuid, p_night timestamp with time zone, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group boolean := exists (select 1 from public.group_members m where m.user_id = p_uid);
  v_h     int := extract(hour from (p_now at time zone 'Europe/Stockholm'))::int;
  v_seed  text := p_uid::text || ':' || (extract(epoch from p_night)::bigint)::text;
begin
  if exists (select 1 from public.game_missions gm where gm.user_id = p_uid and gm.night = p_night) then
    return;
  end if;
  insert into public.game_missions (user_id, night, slot, mission, kind, goal)
  select p_uid, p_night, x.rn, x.id, x.kind, x.goal from (
    select y.id, y.kind, y.goal, row_number() over (order by y.h) as rn from (
      select distinct on (c.kind) c.id, c.kind, c.goal, md5(v_seed || ':' || c.id) as h
        from public.game_mission_cat c
       where c.active and (v_group or not c.needs_group)
         and not (c.kind = 'early' and (v_h >= 19 or v_h < 5))
         and not (c.kind = 'home' and v_h >= 1 and v_h < 5)
       order by c.kind, md5(v_seed || ':' || c.id)) y) x
   where x.rn <= 3
  on conflict do nothing;
end;
$function$;
