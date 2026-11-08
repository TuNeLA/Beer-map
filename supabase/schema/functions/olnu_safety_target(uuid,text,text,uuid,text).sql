-- public.olnu_safety_target(p_uid uuid, p_kind text, p_ref text, p_group uuid, p_k text)
-- live md5(pg_get_functiondef) = 226c59021090d4f0193f3ef72b8f748f
CREATE OR REPLACE FUNCTION public.olnu_safety_target(p_uid uuid, p_kind text, p_ref text, p_group uuid, p_k text)
 RETURNS TABLE(target uuid, gid uuid, excerpt text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint; v_k text := btrim(coalesce(p_k, ''));
begin
  if p_kind in ('msg', 'dm') then
    v_id := nullif(regexp_replace(coalesce(p_ref, ''), '[^0-9]', '', 'g'), '')::bigint;
    select m.user_id, m.group_id, left(m.body, 300) into target, gid, excerpt from public.group_msgs m where m.id = v_id;
    if target is null or not public.olnu_chat_can(gid, p_uid, false) then raise exception 'invalid_target'; end if;
    if exists (select 1 from public.chat_photos cp where cp.msg_id = v_id) then
      excerpt := coalesce(excerpt, '') || ' [📷 ' || (select min(cp.id) from public.chat_photos cp where cp.msg_id = v_id)::text || ']';
    end if;
  elsif p_kind = 'photo' then
    v_id := nullif(regexp_replace(coalesce(p_ref, ''), '[^0-9]', '', 'g'), '')::bigint;
    select cp.user_id, cp.group_id, '[📷 ' || cp.id::text || ']' into target, gid, excerpt from public.chat_photos cp where cp.id = v_id;
    if target is null or not public.olnu_chat_can(gid, p_uid, false) then raise exception 'invalid_target'; end if;
  elsif p_kind = 'voice' then
    v_id := nullif(regexp_replace(coalesce(p_ref, ''), '[^0-9]', '', 'g'), '')::bigint;
    select v.user_id, v.group_id, '[🎙️ ' || v.id::text || ', ' || round(coalesce(v.dur_ms, 0) / 1000.0) || ' s]' into target, gid, excerpt
      from public.voice_msgs v where v.id = v_id;
    if target is null or not public.olnu_chat_can(gid, p_uid, false) then raise exception 'invalid_target'; end if;
  elsif p_kind = 'invite' then
    v_id := nullif(regexp_replace(coalesce(p_ref, ''), '[^0-9]', '', 'g'), '')::bigint;
    select i.creator, i.group_id, left(coalesce(i.title, '') || ' · ' || coalesce(i.note, ''), 300) into target, gid, excerpt
      from public.invites i where i.id = v_id;
    if target is null then raise exception 'invalid_target'; end if;
  elsif p_kind = 'event' then
    v_id := nullif(regexp_replace(coalesce(p_ref, ''), '[^0-9]', '', 'g'), '')::bigint;
    select e.created_by, null::uuid, left(coalesce(e.title, '') || ' · ' || coalesce(e.place, ''), 300) into target, gid, excerpt
      from public.bar_events e where e.id = v_id;
    if excerpt is null then raise exception 'invalid_target'; end if;
  elsif p_kind = 'offer' then
    v_id := nullif(regexp_replace(coalesce(p_ref, ''), '[^0-9]', '', 'g'), '')::bigint;
    select o.user_id, null::uuid, left(coalesce(o.bar_name, '') || ': ' || coalesce(o.body, ''), 300) into target, gid, excerpt
      from public.bar_offers o where o.id = v_id;
    if target is null then raise exception 'invalid_target'; end if;
  elsif p_kind in ('person', 'name', 'avatar') then
    if p_group is not null and v_k = '' then
      target := public.olnu_dm_other(p_group, p_uid); gid := p_group;
    elsif p_group is not null then
      if not public.olnu_chat_can(p_group, p_uid, false) then raise exception 'invalid_target'; end if;
      select u.uid into target from (
        select m.user_id as uid from public.group_members m where m.group_id = p_group
        union select gm.user_id from public.group_msgs gm where gm.group_id = p_group and gm.expires_at > now()
        union select t.a from public.dm_threads t where t.group_id = p_group
        union select t.b from public.dm_threads t where t.group_id = p_group) u
       where public.olnu_chief_k(p_group, u.uid) = v_k limit 1;
      gid := p_group;
    elsif v_k ~ '^[0-9a-f]{16}$' then
      select c.uid into target from (
        select case when f.a = p_uid then f.b else f.a end as uid from public.friendships f where (f.a = p_uid or f.b = p_uid)
        union select am.user_id from public.group_members cm join public.group_members am on am.group_id = cm.group_id where cm.user_id = p_uid) c
       where public.olnu_inv_key(p_uid, c.uid) = v_k limit 1;
    end if;
    if target is null or target = p_uid then raise exception 'invalid_target'; end if;
    excerpt := left(coalesce(public.olnu_friend_name(target), '?'), 40)
               || case when p_kind = 'avatar' then ' [👤 avatar]' else '' end;
  else
    raise exception 'invalid_kind';
  end if;
  if target = p_uid then raise exception 'own_content'; end if;
  return next;
end; $function$;
