-- public.owner_set_club_info(p_key text, p_id bigint, p_status text)
-- live md5(pg_get_functiondef) = 29d7adff981e87cfce963d9866095fd6
CREATE OR REPLACE FUNCTION public.owner_set_club_info(p_key text, p_id bigint, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s text := lower(btrim(coalesce(p_status, ''))); a public.club_info;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('pending', 'ok', 'rejected') then raise exception 'invalid_status'; end if;
  update public.club_info x set status = v_s, status_at = now(),
         superseded_at = case when v_s = 'ok' then null else x.superseded_at end
   where x.id = p_id returning * into a;
  if not found then raise exception 'info_not_found'; end if;
  if v_s = 'ok' then perform public.olnu_aio_club_supersede(a.bar_id, a.id); end if;
  return jsonb_build_object('ok', true, 'id', a.id, 'status', v_s, 'bar_id', a.bar_id);
end; $function$;
