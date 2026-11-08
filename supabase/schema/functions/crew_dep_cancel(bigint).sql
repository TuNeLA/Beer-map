-- public.crew_dep_cancel(p_dep_id bigint)
-- live md5(pg_get_functiondef) = a92414ad04b6217b43f58b25a3371fc5
CREATE OR REPLACE FUNCTION public.crew_dep_cancel(p_dep_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  update public.crew_deps d set cancelled_at = coalesce(d.cancelled_at, now()) where d.id = p_dep_id and d.user_id = v_uid;
  if not found then raise exception 'dep_not_found'; end if;
  return jsonb_build_object('ok', true);
end; $function$;
