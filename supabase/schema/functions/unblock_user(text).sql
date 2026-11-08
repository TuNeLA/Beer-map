-- public.unblock_user(p_id text)
-- live md5(pg_get_functiondef) = b3ce20b86ea41b60c6892f5f0a1ae999
CREATE OR REPLACE FUNCTION public.unblock_user(p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); n int;
begin
  update public.user_blocks k set active = false, updated_at = now()
   where k.blocker = v_uid and k.active and substr(md5(k.blocker::text || ':' || k.blocked::text || ':olnu-ub'), 1, 16) = p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found'; end if;
  return jsonb_build_object('ok', true);
end; $function$;
