-- public.owner_bar_action(p_key text, p_bar_id text, p_action text)
-- live md5(pg_get_functiondef) = 1d7825c6f5989206461c99e9119730f3
CREATE OR REPLACE FUNCTION public.owner_bar_action(p_key text, p_bar_id text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_a text := lower(btrim(coalesce(p_action, ''))); v_n int;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_a not in ('close', 'reopen', 'ignore') then raise exception 'invalid_action'; end if;
  if v_a = 'close' then
    update public.bars_lite b set active = false, updated_at = now() where b.id = p_bar_id;
    update public.bar_reports r set status = 'fixed', status_at = now() where r.bar_id = p_bar_id and r.status = 'new';
  elsif v_a = 'reopen' then
    update public.bars_lite b set active = true, updated_at = now() where b.id = p_bar_id;
  else
    update public.bar_reports r set status = 'ignored', status_at = now() where r.bar_id = p_bar_id and r.status = 'new';
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'action', v_a, 'rows', v_n);
end; $function$;
