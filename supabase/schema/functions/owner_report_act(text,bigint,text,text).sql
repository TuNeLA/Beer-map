-- public.owner_report_act(p_key text, p_id bigint, p_action text, p_notice text)
-- live md5(pg_get_functiondef) = 0d324f3fd4c8fdcc8450751db56f0468
CREATE OR REPLACE FUNCTION public.owner_report_act(p_key text, p_id bigint, p_action text, p_notice text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.ugc_reports; v_notice text;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select * into r from public.ugc_reports x where x.id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if p_action not in ('dismiss', 'hide', 'warn', 'hide_all') then raise exception 'invalid_action'; end if;
  v_notice := nullif(left(btrim(coalesce(p_notice, '')), 300), '');
  if p_action in ('hide', 'hide_all') then
    v_notice := coalesce(v_notice, 'Något du la upp togs bort efter en anmälan, för att det bröt mot Reglerna. Frågor: support@pintsnow.com');
    perform public.olnu_safety_hide(r.kind, r.ref);
    if r.kind in ('name', 'person') and r.target is not null then
      update public.user_names n set name = 'Soldat', updated_at = now() where n.user_id = r.target;
      update public.group_members m set display_name = 'Soldat' where m.user_id = r.target;
    elsif r.kind = 'avatar' and r.target is not null then
      update public.avatars a set spec = '{}'::jsonb, updated_at = now() where a.user_id = r.target;
    end if;
    if p_action = 'hide_all' and r.target is not null then
      update public.group_msgs m set expires_at = least(m.expires_at, now()) where m.user_id = r.target and m.expires_at > now();
      update public.chat_photos c set expires_at = least(c.expires_at, now()) where c.user_id = r.target and c.expires_at > now();
      update public.voice_msgs v set expires_at = least(v.expires_at, now()) where v.user_id = r.target and v.expires_at > now();
    end if;
  elsif p_action = 'warn' then
    v_notice := coalesce(v_notice, 'Hej! Någon anmälde något du skrev. Håll god ton i gänget, la. Reglerna finns under ⚙️.');
  else
    v_notice := null;
  end if;
  update public.ugc_reports x
     set status = case p_action when 'dismiss' then 'dismissed' when 'warn' then 'warned' else 'hidden' end,
         handled_at = now(),
         notice = case when x.id = r.id then v_notice else x.notice end
   where x.id = r.id or (x.kind = r.kind and x.ref = r.ref and x.status = 'new');
  return jsonb_build_object('ok', true, 'status', p_action);
end; $function$;
