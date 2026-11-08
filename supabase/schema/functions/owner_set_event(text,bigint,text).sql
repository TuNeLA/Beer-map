-- public.owner_set_event(p_key text, p_id bigint, p_status text)
-- live md5(pg_get_functiondef) = aea866d4a9723c765ab109f5ea78a296
CREATE OR REPLACE FUNCTION public.owner_set_event(p_key text, p_id bigint, p_status text)
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
  if v_s not in ('pending', 'ok', 'hidden') then raise exception 'invalid_status'; end if;
  update public.bar_events e set status = v_s, status_at = now(), updated_at = now() where e.id = p_id;
  if not found then raise exception 'event_not_found'; end if;
  return jsonb_build_object('ok', true, 'status', v_s);
end; $function$;
