-- public.olnu_rally_rows(p_uid uuid, p_group_id uuid)
-- live md5(pg_get_functiondef) = 3d084ef368520bfd6ee553570a83b87c
CREATE OR REPLACE FUNCTION public.olnu_rally_rows(p_uid uuid, p_group_id uuid)
 RETURNS TABLE(id bigint, name text, body text, place text, lat double precision, lng double precision, created_at timestamp with time zone, yes integer, no integer, maybe integer, my_answer text, yes_names text[], is_mine boolean, group_id uuid, group_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select r.id, cm.display_name, r.body, r.place, r.lat, r.lng, r.created_at,
         coalesce(c.y, 0), coalesce(c.n, 0), coalesce(c.m, 0),
         (select a.answer from public.rally_answers a where a.rally_id = r.id and a.user_id = p_uid),
         coalesce(c.names, array[]::text[]),
         (r.user_id = p_uid), r.group_id, g.name
    from public.rallies r
    join public.group_members me on me.group_id = r.group_id and me.user_id = p_uid
    left join public.groups g on g.id = r.group_id
    left join public.group_members cm on cm.group_id = r.group_id and cm.user_id = r.user_id
    left join lateral (
      select count(*) filter (where a.answer = 'yes')::int as y,
             count(*) filter (where a.answer = 'no')::int as n,
             count(*) filter (where a.answer = 'maybe')::int as m,
             array_agg(gm.display_name order by (a.user_id = r.user_id) desc, a.updated_at, gm.display_name)
               filter (where a.answer = 'yes') as names
        from public.rally_answers a
        join public.group_members gm on gm.group_id = r.group_id and gm.user_id = a.user_id
       where a.rally_id = r.id
    ) c on true
   where r.expires_at > now() and not r.closed
     and (p_group_id is null or r.group_id = p_group_id)
   order by r.created_at desc, r.id desc
   limit 10;
$function$;
