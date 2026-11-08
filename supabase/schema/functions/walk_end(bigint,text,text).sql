-- public.walk_end(p_id bigint, p_reason text, p_line text)
-- live md5(pg_get_functiondef) = 5cf0c281a0496eac3a42231160fead6e
CREATE OR REPLACE FUNCTION public.walk_end(p_id bigint, p_reason text DEFAULT 'stop'::text, p_line text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid(); w public.walks; v_r text := lower(coalesce(p_reason, 'stop'));
  v_body text; v_msg bigint; v_nm text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_r not in ('home', 'stop') then v_r := 'stop'; end if;
  select * into w from public.walks x where x.id = p_id and x.user_id = v_uid for update;
  if not found then raise exception 'walk_not_found'; end if;
  if w.ended_at is not null then return public.olnu_walk_mine(w); end if;
  if v_r = 'home' and w.group_id is not null
     and exists (select 1 from public.group_members m where m.group_id = w.group_id and m.user_id = v_uid) then
    v_nm := public.olnu_walk_name(v_uid, w.group_id);
    v_body := left(btrim(regexp_replace(coalesce(nullif(btrim(p_line), ''), '✅ {n} ä hemma! 🏠'), '[[:cntrl:]]+', ' ', 'g')), 120);
    if public.olnu_inv_haslink(v_body) or position('{n}' in v_body) = 0 then v_body := '✅ {n} ä hemma! 🏠'; end if;
    v_body := left(replace(v_body, '{n}', v_nm), 140);
    if left(v_body, 1) <> '✅' then v_body := left('✅ ' || v_body, 140); end if;
    insert into public.group_msgs (group_id, user_id, body, expires_at)
    values (w.group_id, v_uid, v_body, public.olnu_next_expiry()) returning id into v_msg;
  end if;
  update public.walks set ended_at = now(), end_reason = v_r, lat = null, lng = null, acc = null, msg_id = v_msg
   where id = w.id returning * into w;
  return public.olnu_walk_mine(w) || jsonb_build_object('group_id', w.group_id);
end; $function$;
