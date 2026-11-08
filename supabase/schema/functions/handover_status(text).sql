-- public.handover_status(p_id text)
-- live md5(pg_get_functiondef) = 105607bf0a70d87a22e5296b2507c565
CREATE OR REPLACE FUNCTION public.handover_status(p_id text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select coalesce((
    select case
             when t.done_at is not null then 'done'
             when t.taken_at is not null then 'taken'
             when t.expires_at < now() then 'expired'
             else 'open' end
      from public.handover_tickets t
     where p_id ~ '^[A-Za-z0-9_-]{20,64}$' and t.id_hash = public.olnu_ho_hash(p_id)), 'unknown');
$function$;
