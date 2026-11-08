-- public.olnu_skal_auto(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = d1f028aa2d7423103a7c032854bd2ab0
CREATE OR REPLACE FUNCTION public.olnu_skal_auto(p_group uuid, p_uid uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(now());
  v_from  timestamptz := public.olnu_skal_win_from(public.olnu_night_of(now()));
  v_to    timestamptz := public.olnu_skal_win_to(public.olnu_night_of(now()));
  v_at    timestamptz;
  p       public.skal_plans;
  h       public.skal_hours;
  v_last  timestamptz;
begin
  if now() >= v_to then return null; end if;
  select * into p from public.skal_plans x where x.group_id = p_group and x.night = v_night;
  if not found then
    if now() < v_from then
      v_at := v_from + random() * (v_to - v_from);
    else
      v_at := now() + interval '2 minutes' + random() * greatest(v_to - now() - interval '2 minutes', interval '0 seconds');
    end if;
    insert into public.skal_plans (group_id, night, plan_at) values (p_group, v_night, v_at)
    on conflict (group_id, night) do nothing;
    select * into p from public.skal_plans x where x.group_id = p_group and x.night = v_night;
  end if;
  if p.hour_id is not null or now() < p.plan_at then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_skal:' || p_group::text, 0));
  select * into p from public.skal_plans x where x.group_id = p_group and x.night = v_night;
  if p.hour_id is not null then return null; end if;
  h := public.olnu_skal_insert(p_group, null, p_uid, true);
  if h.id is not null then
    update public.skal_plans x set hour_id = h.id where x.group_id = p_group and x.night = v_night;
    return h.id;
  end if;
  -- Blocked by a limit: after a skåltimme in the last 30 min, try again 31 min after it (while in the window);
  -- 4 tonight already (or past 01:00), skip.
  select max(x.created_at) into v_last from public.skal_hours x where x.group_id = p_group and x.created_at > now() - interval '30 minutes';
  if v_last is not null and v_last + interval '31 minutes' < v_to
     and (select count(*) from public.skal_hours x where x.group_id = p_group and x.created_at >= public.olnu_skal_from()) < 4 then
    update public.skal_plans x set plan_at = v_last + interval '31 minutes' where x.group_id = p_group and x.night = v_night;
  else
    update public.skal_plans x set hour_id = 0 where x.group_id = p_group and x.night = v_night;
  end if;
  return null;
end; $function$;
