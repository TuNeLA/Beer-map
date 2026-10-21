-- Öl Nu — 💬 EVENTCHATT part 2 (CONTRACT "v29 EVENTCHATT"). Same signatures, same return shapes. Safe to run again.
-- The group chat RPCs (text, reactions, likes, photos, voice) are re-created from the deployed versions
-- (0020/0029/0090/0093 state on 2026-10-21) with ONE change each: the membership test
--   exists (select 1 from group_members ...)  ->  public.olnu_chat_can(group, uid, write)
-- (0084), so a temp group's participants can use the normal chat. Reading = member or temp read access;
-- writing = member or temp write access (✅/🤔, not archived, not cancelled). Names of temp participants come
-- from olnu_friend_name (they have no group_members row). post_group_msg also strips U+2063 (the system line
-- marker). For real groups nothing changes. Needs 0084.

create or replace function public.group_msgs(p_group_id uuid, p_after_id bigint default 0)
returns table(id bigint, name text, body text, created_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_after bigint := coalesce(p_after_id, 0);
  v_temp boolean := public.olnu_is_temp_group(p_group_id);
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select s.mid, s.mname, s.mbody, s.mat, s.mme
    from (
      select gm.id as mid,
             coalesce((select mm.display_name from public.group_members mm where mm.group_id = gm.group_id and mm.user_id = gm.user_id),
                      case when v_temp then public.olnu_friend_name(gm.user_id) end) as mname,
             gm.body as mbody, gm.created_at as mat, (gm.user_id = v_uid) as mme
        from public.group_msgs gm
       where gm.group_id = p_group_id and gm.expires_at > now() and gm.id > v_after
       order by case when v_after = 0 then -gm.id else gm.id end
       limit 100
    ) s order by s.mid;
end; $function$;

create or replace function public.post_group_msg(p_group_id uuid, p_body text)
returns json language plpgsql security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_body text := btrim(replace(regexp_replace(coalesce(p_body, ''), '[\x00-\x08\x0B-\x1F\x7F]', '', 'g'), chr(8291), ''));
  v_id bigint; v_at timestamptz;
begin
  if not public.olnu_chat_can(p_group_id, v_uid, true) then
    raise exception 'not_member';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 140 then raise exception 'invalid_msg'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_msg:' || v_uid::text, 0));
  -- Chat like other apps: no wait between messages. Only a flood guard (max 10 messages per 20 s).
  if (select count(*) from public.group_msgs m where m.user_id = v_uid and m.created_at > now() - interval '20 seconds') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_body, public.olnu_next_expiry())
  returning group_msgs.id, group_msgs.created_at into v_id, v_at;
  return json_build_object('id', v_id, 'created_at', v_at);
end; $function$;

create or replace function public.react_msg(p_msg_id bigint, p_emoji text)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_gid uuid;
  v_old text;
  v_act boolean;
begin
  if p_emoji not in ('🍻','😂','🔥','❤️') then raise exception 'invalid_emoji'; end if;
  select gm.group_id into v_gid from public.group_msgs gm where gm.id = p_msg_id and gm.expires_at > now();
  if v_gid is null then raise exception 'msg_not_found'; end if;
  if not public.olnu_chat_can(v_gid, v_uid, true) then
    raise exception 'not_member';
  end if;
  select r.emoji, r.active into v_old, v_act from public.group_msg_reacts r where r.msg_id = p_msg_id and r.user_id = v_uid;
  if v_old is null then
    insert into public.group_msg_reacts (msg_id, user_id, emoji) values (p_msg_id, v_uid, p_emoji);
    return jsonb_build_object('emoji', p_emoji);
  elsif v_old = p_emoji and v_act then
    update public.group_msg_reacts set active = false, created_at = now() where msg_id = p_msg_id and user_id = v_uid;
    return jsonb_build_object('emoji', null);
  else
    update public.group_msg_reacts set emoji = p_emoji, active = true, created_at = now() where msg_id = p_msg_id and user_id = v_uid;
    return jsonb_build_object('emoji', p_emoji);
  end if;
end;
$function$;

create or replace function public.msg_reacts(p_group_id uuid)
returns table(msg_id bigint, emoji text, n integer, mine boolean, names text[])
language plpgsql stable security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_temp boolean := public.olnu_is_temp_group(p_group_id);
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select r.msg_id, r.emoji, count(*)::int, bool_or(r.user_id = v_uid),
         array_agg(coalesce(mm.display_name, case when v_temp then public.olnu_friend_name(r.user_id) end, '?') order by r.created_at)
    from public.group_msg_reacts r
    join public.group_msgs gm on gm.id = r.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = r.user_id
   where r.active
   group by r.msg_id, r.emoji;
end;
$function$;

create or replace function public.like_msg(p_msg_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_gid uuid;
  v_liked boolean;
  v_n int;
begin
  select gm.group_id into v_gid from public.group_msgs gm where gm.id = p_msg_id and gm.expires_at > now();
  if v_gid is null then raise exception 'msg_not_found'; end if;
  if not public.olnu_chat_can(v_gid, v_uid, true) then
    raise exception 'not_member';
  end if;
  insert into public.group_msg_likes as l (msg_id, user_id, liked) values (p_msg_id, v_uid, true)
  on conflict (msg_id, user_id) do update set liked = not l.liked, created_at = now()
  returning l.liked into v_liked;
  select count(*) into v_n from public.group_msg_likes where msg_id = p_msg_id and liked;
  return jsonb_build_object('likes', v_n, 'liked', v_liked);
end;
$function$;

create or replace function public.msg_likes(p_group_id uuid)
returns table(msg_id bigint, likes integer, liked boolean, names text[])
language plpgsql stable security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_temp boolean := public.olnu_is_temp_group(p_group_id);
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select l.msg_id, count(*)::int, bool_or(l.user_id = v_uid),
         array_agg(coalesce(mm.display_name, case when v_temp then public.olnu_friend_name(l.user_id) end, '?') order by l.created_at)
    from public.group_msg_likes l
    join public.group_msgs gm on gm.id = l.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = l.user_id
   where l.liked
   group by l.msg_id;
end;
$function$;

create or replace function public.group_photo(p_photo_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.chat_photos;
begin
  select * into v_row from public.chat_photos cp where cp.id = p_photo_id and cp.expires_at > now() and cp.bytes is not null;
  if not found then
    raise exception 'photo_not_found';
  end if;
  if not public.olnu_chat_can(v_row.group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end;
$function$;

create or replace function public.group_photos(p_group_id uuid, p_after_id bigint default 0, p_before_id bigint default null::bigint)
returns table(id bigint, msg_id bigint, w integer, h integer, size integer, created_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select x.id, x.msg_id, x.w, x.h, x.size, x.created_at, x.is_me from (
    select cp.id, cp.msg_id, cp.w, cp.h, cp.size, cp.created_at, cp.user_id = v_uid as is_me
      from public.chat_photos cp
     where cp.group_id = p_group_id and cp.expires_at > now() and cp.bytes is not null
       and cp.id > coalesce(p_after_id, 0) and (p_before_id is null or cp.id < p_before_id)
     order by cp.id desc limit 100) x
   order by x.id;
end;
$function$;

create or replace function public.post_photo(p_group_id uuid, p_b64 text, p_w integer default 0, p_h integer default 0, p_caption text default null::text)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_cap  text := btrim(regexp_replace(coalesce(p_caption, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_exp  timestamptz := public.olnu_next_expiry();
  -- Start of tonight (05:00 yesterday, DST-correct). Limits count by created_at, because a keeping group
  -- (0029 keep_history) stores expires_at = infinity.
  v_from timestamptz := ((v_exp at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
  v_data bytea;
  v_mime text;
  v_n    int;
  v_g    int;
  v_body text;
  v_mid  bigint;
  v_row  public.chat_photos;
begin
  if not public.olnu_chat_can(p_group_id, v_uid, true) then
    raise exception 'not_member';
  end if;
  if char_length(v_cap) > 138 then
    raise exception 'invalid_msg';
  end if;
  if p_b64 is null or length(p_b64) > 220000 then
    raise exception 'invalid_photo';
  end if;
  begin
    v_data := decode(regexp_replace(p_b64, '\s', '', 'g'), 'base64');
  exception when others then
    raise exception 'invalid_photo';
  end;
  if v_data is null or octet_length(v_data) < 200 or octet_length(v_data) > 163840 then
    raise exception 'invalid_photo';
  end if;
  -- Magic bytes: JPEG FF D8 FF, WebP "RIFF" .... "WEBP".
  if substring(v_data from 1 for 3) = '\xffd8ff'::bytea then
    v_mime := 'image/jpeg';
  elsif substring(v_data from 1 for 4) = '\x52494646'::bytea and substring(v_data from 9 for 4) = '\x57454250'::bytea then
    v_mime := 'image/webp';
  else
    raise exception 'invalid_photo';
  end if;
  if coalesce(p_w, 0) < 1 or coalesce(p_h, 0) < 1 or p_w > 2048 or p_h > 2048 then
    raise exception 'invalid_photo';
  end if;

  -- Keep the database small: empty the bytes of expired photos (rows stay, space is reused).
  -- expires_at < now() only: rows of keeping groups (infinity) never match.
  update public.chat_photos cp set bytes = null where cp.expires_at < now() and cp.bytes is not null;

  perform pg_advisory_xact_lock(hashtextextended('olnu_photo:' || v_uid::text, 0));
  if exists (select 1 from public.chat_photos cp where cp.user_id = v_uid and cp.created_at > now() - interval '15 seconds') then
    raise exception 'slow_down';
  end if;
  select count(*) into v_n from public.chat_photos cp where cp.user_id = v_uid and cp.created_at >= v_from;
  if v_n >= 10 then
    raise exception 'photo_limit';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_photo_g:' || p_group_id::text, 0));
  select count(*) into v_g from public.chat_photos cp where cp.group_id = p_group_id and cp.created_at >= v_from;
  if v_g >= 60 then
    raise exception 'group_photo_limit';
  end if;

  v_body := case when v_cap = '' then '📷' else '📷 ' || v_cap end;
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_body, v_exp)
  returning id into v_mid;
  insert into public.chat_photos (group_id, user_id, msg_id, mime, bytes, size, w, h, expires_at)
  values (p_group_id, v_uid, v_mid, v_mime, v_data, octet_length(v_data), p_w, p_h, v_exp)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'msg_id', v_mid, 'created_at', v_row.created_at,
    'expires_at', v_row.expires_at, 'left', 9 - v_n, 'mime', v_mime);
end;
$function$;

create or replace function public.post_voice(p_group_id uuid, p_mime text, p_b64 text, p_dur_ms integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_mime text := lower(btrim(coalesce(p_mime, '')));
  v_exp  timestamptz := public.olnu_next_expiry();
  v_from timestamptz := ((v_exp at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
  v_data bytea;
  v_n    int;
  v_row  public.voice_msgs;
begin
  if not public.olnu_chat_can(p_group_id, v_uid, true) then
    raise exception 'not_member';
  end if;
  if v_mime !~ '^audio/(webm|ogg|mp4|aac|mpeg|x-m4a)(; ?codecs="?[a-z0-9.,]{1,30}"?)?$' then
    raise exception 'invalid_voice';
  end if;
  if p_b64 is null or length(p_b64) > 90000 then
    raise exception 'invalid_voice';
  end if;
  begin
    v_data := decode(regexp_replace(p_b64, '\s', '', 'g'), 'base64');
  exception when others then
    raise exception 'invalid_voice';
  end;
  if octet_length(v_data) < 100 or octet_length(v_data) > 61440 then
    raise exception 'invalid_voice';
  end if;
  update public.voice_msgs v set audio = '\x'::bytea
   where v.expires_at < now() and octet_length(v.audio) > 0;
  perform pg_advisory_xact_lock(hashtextextended('olnu_voice:' || v_uid::text, 0));
  if exists (select 1 from public.voice_msgs v where v.user_id = v_uid and v.created_at > now() - interval '5 seconds') then
    raise exception 'slow_down';
  end if;
  select count(*) into v_n from public.voice_msgs v where v.user_id = v_uid and v.created_at >= v_from;
  if v_n >= 10 then
    raise exception 'voice_limit';
  end if;
  insert into public.voice_msgs (group_id, user_id, mime, dur_ms, audio)
  values (p_group_id, v_uid, v_mime, greatest(0, least(6000, coalesce(p_dur_ms, 0))), v_data)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'left', 9 - v_n);
end;
$function$;

create or replace function public.group_voices(p_group_id uuid, p_after_id bigint default 0)
returns table(id bigint, name text, mime text, dur_ms integer, bytes integer, created_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_temp boolean := public.olnu_is_temp_group(p_group_id);
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select x.id, x.name, x.mime, x.dur_ms, x.bytes, x.created_at, x.is_me from (
    select v.id, coalesce(gm.display_name, case when v_temp then public.olnu_friend_name(v.user_id) end) as name,
           v.mime, v.dur_ms, octet_length(v.audio) as bytes, v.created_at, v.user_id = v_uid as is_me
      from public.voice_msgs v
      left join public.group_members gm on gm.group_id = v.group_id and gm.user_id = v.user_id
     where v.group_id = p_group_id and v.expires_at > now() and v.id > coalesce(p_after_id, 0)
     order by v.id desc limit 30) x
   order by x.id;
end;
$function$;

create or replace function public.voice_audio(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.voice_msgs;
begin
  select * into v_row from public.voice_msgs v where v.id = p_id and v.expires_at > now();
  if not found then
    raise exception 'voice_not_found';
  end if;
  if not public.olnu_chat_can(v_row.group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'dur_ms', v_row.dur_ms,
    'b64', replace(encode(v_row.audio, 'base64'), E'\n', ''));
end;
$function$;
