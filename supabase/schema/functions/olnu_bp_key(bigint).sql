-- public.olnu_bp_key(p_id bigint)
-- live md5(pg_get_functiondef) = ed3ab8e8342b1f9bbedd8611e91fd7c4
CREATE OR REPLACE FUNCTION public.olnu_bp_key(p_id bigint)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select 'bp' || p_id::text; $function$;
