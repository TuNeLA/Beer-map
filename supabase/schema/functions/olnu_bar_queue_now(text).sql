-- public.olnu_bar_queue_now(p_bar_id text)
-- live md5(pg_get_functiondef) = 559f68486d98f7837bc19379cc8ff6b9
CREATE OR REPLACE FUNCTION public.olnu_bar_queue_now(p_bar_id text)
 RETURNS TABLE(queue text, entry text, reports integer, last_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with live as (
    select q.queue, q.entry, q.created_at from public.bar_queue q
     where q.bar_id = p_bar_id and q.expires_at > now()
  )
  select (select l.queue from live l group by l.queue order by count(*) desc, max(l.created_at) desc limit 1),
         (select l.entry from live l where l.entry is not null group by l.entry order by count(*) desc, max(l.created_at) desc limit 1),
         (select count(*)::int from live),
         (select max(l.created_at) from live l);
$function$;
