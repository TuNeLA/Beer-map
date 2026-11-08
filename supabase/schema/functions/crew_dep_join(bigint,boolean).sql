-- public.crew_dep_join(p_dep_id bigint, p_on boolean)
-- live md5(pg_get_functiondef) = 2872087a1fd3f5e744ccbec9095009ba
CREATE OR REPLACE FUNCTION public.crew_dep_join(p_dep_id bigint, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  d public.crew_deps;
begin
  select * into d from public.crew_deps x where x.id = p_dep_id and x.cancelled_at is null
     and x.night = public.olnu_night_of(now()) and x.leave_at > now() - interval '15 minutes';
  if not found then raise exception 'dep_not_found'; end if;
  if not public.olnu_crew_member(d.group_id, v_uid) then raise exception 'not_member'; end if;
  insert into public.crew_dep_going (dep_id, user_id, going) values (d.id, v_uid, coalesce(p_on, true))
  on conflict (dep_id, user_id) do update set going = excluded.going, updated_at = now();
  return jsonb_build_object('i_going', coalesce(p_on, true),
    'going_n', (select count(*) from public.crew_dep_going g join public.group_members m
                 on m.group_id = d.group_id and m.user_id = g.user_id where g.dep_id = d.id and g.going));
end; $function$;
