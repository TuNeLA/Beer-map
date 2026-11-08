-- public.owner_set_feedback(p_key text, p_id bigint, p_status text)
-- live md5(pg_get_functiondef) = 12d5e3d1e1afb21d0659a1f161292f16
CREATE OR REPLACE FUNCTION public.owner_set_feedback(p_key text, p_id bigint, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if p_status not in ('ny', 'läst', 'fixad', 'dold') then raise exception 'invalid_status'; end if;
  update public.app_feedback f set status = p_status where f.id = p_id;
  return jsonb_build_object('ok', found);
end; $function$;
