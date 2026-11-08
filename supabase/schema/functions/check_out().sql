-- public.check_out()
-- live md5(pg_get_functiondef) = fe8ebb8cd3186784f9f3237c634121bd
CREATE OR REPLACE FUNCTION public.check_out()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.checkins%rowtype;
begin
  update public.checkins c
     set expires_at = now()
   where c.user_id = v_uid and c.expires_at > now()
  returning * into v_row;
  if not found then
    return jsonb_build_object('ok', false, 'bar_id', null, 'bar_name', null);
  end if;
  return jsonb_build_object('ok', true, 'bar_id', v_row.bar_id, 'bar_name', v_row.bar_name);
end $function$;
