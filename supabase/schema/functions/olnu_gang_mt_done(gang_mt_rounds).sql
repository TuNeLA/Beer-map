-- public.olnu_gang_mt_done(r gang_mt_rounds)
-- live md5(pg_get_functiondef) = 9b489cd754e3560c6bdc6cbf5b86a309
CREATE OR REPLACE FUNCTION public.olnu_gang_mt_done(r gang_mt_rounds)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.closed_at is not null or r.ends_at <= now()
      or (select count(*) from public.gang_mt_votes v
            join public.group_members m on m.group_id = r.group_id and m.user_id = v.voter
           where v.round_id = r.id)
         >= greatest(2, (select count(*) from public.group_members m where m.group_id = r.group_id));
$function$;
