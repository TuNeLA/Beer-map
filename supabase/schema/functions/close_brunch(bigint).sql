-- public.close_brunch(p_brunch_id bigint)
-- live md5(pg_get_functiondef) = 223b28a6ae6d2161864e625a42d3a59b
CREATE OR REPLACE FUNCTION public.close_brunch(p_brunch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_id bigint;
begin
  update public.gang_brunches x set closed = true where x.id = p_brunch_id and x.user_id = v_uid returning x.id into v_id;
  if v_id is null then raise exception 'brunch_not_found'; end if;
  return jsonb_build_object('ok', true);
end; $function$;
