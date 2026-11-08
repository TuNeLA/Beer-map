-- public.owner_set_bar_gone(p_key text, p_bar_id text, p_status text)
-- live md5(pg_get_functiondef) = b2c5bd58eacca25d69244e9f52da04fe
CREATE OR REPLACE FUNCTION public.owner_set_bar_gone(p_key text, p_bar_id text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s text := lower(btrim(coalesce(p_status, ''))); v_pos double precision[];
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('hidden', 'confirmed', 'undone') then raise exception 'invalid_status'; end if;
  if exists (select 1 from public.bar_gone g where g.bar_id = p_bar_id) then
    update public.bar_gone g set status = v_s, status_at = now(),
           reason = case when v_s = 'undone' then g.reason when g.status = 'undone' then 'owner' else g.reason end,
           hidden_at = case when v_s <> 'undone' and g.status = 'undone' then now() else g.hidden_at end
     where g.bar_id = p_bar_id;
  else
    if v_s = 'undone' then raise exception 'not_found'; end if;
    v_pos := public.olnu_area_bar_pos(p_bar_id);
    if v_pos is null then raise exception 'invalid_bar'; end if;
    insert into public.bar_gone (bar_id, name, bar_lat, bar_lng, status, reason, reports)
    values (p_bar_id, coalesce((select max(r.name) from public.bar_gone_reports r where r.bar_id = p_bar_id), (select b.name from public.bars_lite b where b.id = p_bar_id)),
            v_pos[1], v_pos[2], v_s, 'owner', public.olnu_gone_count(p_bar_id));
  end if;
  return jsonb_build_object('ok', true, 'bar_id', p_bar_id, 'status', v_s);
end; $function$;
