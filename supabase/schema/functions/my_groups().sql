-- public.my_groups()
-- live md5(pg_get_functiondef) = 4994dfa296023fe88bbe767a361eb1a2
CREATE OR REPLACE FUNCTION public.my_groups()
 RETURNS TABLE(id uuid, name text, code text, member_count integer, active_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select g.id, g.name, g.code,
         (select count(*)::int from public.group_members m where m.group_id = g.id),
         (select count(*)::int
            from public.group_members m
            join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not b.stopped
           where m.group_id = g.id)
    from public.groups g
    join public.group_members me on me.group_id = g.id and me.user_id = v_uid
   order by me.joined_at;
end;
$function$;
