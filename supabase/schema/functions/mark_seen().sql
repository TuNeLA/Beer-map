-- public.mark_seen()
-- live md5(pg_get_functiondef) = b82b3527ed2ae3d2fcf535fda93c3758
CREATE OR REPLACE FUNCTION public.mark_seen()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  insert into public.user_seen (user_id, seen_at) values (v_uid, now())
  on conflict (user_id) do update set seen_at = now() where public.user_seen.seen_at < now() - interval '60 seconds';
end; $function$;
