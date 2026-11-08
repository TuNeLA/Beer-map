-- public.close_rally(p_rally_id bigint)
-- live md5(pg_get_functiondef) = 007eddab6eecac025d4a1b6d0dff1025
CREATE OR REPLACE FUNCTION public.close_rally(p_rally_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  update public.rallies set closed = true where id = p_rally_id and user_id = v_uid;
  if not found then raise exception 'rally_not_found'; end if;
end; $function$;
