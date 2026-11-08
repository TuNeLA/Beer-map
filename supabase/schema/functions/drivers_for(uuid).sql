-- public.drivers_for(p_group_id uuid)
-- live md5(pg_get_functiondef) = 5cf7ccdb8b79c74268758ac731b464e7
CREATE OR REPLACE FUNCTION public.drivers_for(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_group_id is null or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_chief_k(p_group_id, m.user_id), 'name', m.display_name,
           'is_me', m.user_id = v_uid) order by (m.user_id = v_uid) desc, m.display_name), '[]'::jsonb)
    into v
    from public.group_members m join public.driver_status d on d.user_id = m.user_id and d.night = public.olnu_night_of(now())
   where m.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, m.user_id);
  return jsonb_build_object('v', 1, 'drivers', v);
end; $function$;
