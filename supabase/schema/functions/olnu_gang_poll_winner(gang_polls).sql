-- public.olnu_gang_poll_winner(p gang_polls)
-- live md5(pg_get_functiondef) = f3e365665d01095954bcd17a1cdf3df2
CREATE OR REPLACE FUNCTION public.olnu_gang_poll_winner(p gang_polls)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.opt from public.gang_poll_votes v
    join public.group_members m on m.group_id = p.group_id and m.user_id = v.user_id
   where v.poll_id = p.id
   group by v.opt
   order by count(*) desc, max(v.updated_at), v.opt
   limit 1;
$function$;
