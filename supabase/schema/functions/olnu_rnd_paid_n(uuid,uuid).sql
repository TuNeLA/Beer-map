-- public.olnu_rnd_paid_n(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 8f1df1da7366629c9c6e5bc54c693c7c
CREATE OR REPLACE FUNCTION public.olnu_rnd_paid_n(p_group uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.rnd_expenses e
   where e.group_id = p_group and e.payer = p_uid and e.kind = 'round' and e.cancelled_at is null
     and e.created_at > now() - interval '60 days';
$function$;
