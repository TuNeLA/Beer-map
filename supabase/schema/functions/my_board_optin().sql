-- public.my_board_optin()
-- live md5(pg_get_functiondef) = bb1cff8df343c58bf231f2398a0d7b2a
CREATE OR REPLACE FUNCTION public.my_board_optin()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.board_optin%rowtype;
begin
  select * into v_row from public.board_optin o where o.user_id = v_uid;
  return jsonb_build_object('on', coalesce(v_row.show, false), 'name', v_row.name);
end; $function$;
