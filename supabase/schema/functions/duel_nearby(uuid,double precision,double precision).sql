-- public.duel_nearby(p_group_id uuid, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 222a25da6dfba20859b8a31e29a82440
CREATE OR REPLACE FUNCTION public.duel_nearby(p_group_id uuid, p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  return jsonb_build_object(
    'open', coalesce((select o.open from public.duel_open o where o.group_id = p_group_id), false),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('handle', x.handle, 'name', x.name, 'members', x.members, 'out', x.out_n)
                                         order by x.out_n desc, x.name)
      from (
        select public.olnu_duel_handle(g.id) as handle, g.name,
               (select count(*) from public.group_members m where m.group_id = g.id)::int as members,
               (select count(distinct m.user_id) from public.group_members m
                 where m.group_id = g.id and (
                   exists (select 1 from public.beers b where b.user_id = m.user_id and b.expires_at > now() and not b.stopped
                             and not coalesce(b.ghost, false) and public.olnu_dist_m(b.lat, b.lng, p_lat, p_lng) <= 30000)
                   or exists (select 1 from public.checkins c where c.user_id = m.user_id and c.expires_at > now()
                             and public.olnu_dist_m(c.lat, c.lng, p_lat, p_lng) <= 30000)))::int as out_n
          from public.duel_open o join public.groups g on g.id = o.group_id
         where o.open
           and not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_uid)
           and public.olnu_duel_pair(g.id, p_group_id) is null
      ) x where x.out_n > 0 limit 20), '[]'::jsonb));
end; $function$;
