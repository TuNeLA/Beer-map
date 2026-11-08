-- public.owner_set_wish(p_key text, p_wish_id bigint, p_status text)
-- live md5(pg_get_functiondef) = 0fced1ff12c34100efbab8e0018d3ac2
CREATE OR REPLACE FUNCTION public.owner_set_wish(p_key text, p_wish_id bigint, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s text := lower(btrim(coalesce(p_status, '')));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('ny', 'planerad', 'byggs', 'klar', 'nej', 'dold') then raise exception 'invalid_status'; end if;
  update public.feature_wishes w set status = v_s, status_at = now() where w.id = p_wish_id;
  if not found then raise exception 'wish_not_found'; end if;
  return jsonb_build_object('ok', true, 'status', v_s);
end; $function$;
