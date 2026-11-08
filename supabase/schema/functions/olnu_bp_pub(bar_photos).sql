-- public.olnu_bp_pub(p bar_photos)
-- live md5(pg_get_functiondef) = a2459b988f5b81f43ce157716cfa827e
CREATE OR REPLACE FUNCTION public.olnu_bp_pub(p bar_photos)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.public_until is not null and p.public_until > now() and p.hidden_at is null and p.pub_bytes is not null;
$function$;
