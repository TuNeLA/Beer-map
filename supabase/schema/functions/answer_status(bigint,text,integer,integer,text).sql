-- public.answer_status(p_req_id bigint, p_b64 text, p_w integer, p_h integer, p_caption text)
-- live md5(pg_get_functiondef) = 693c6c83233fcb54cfab5637bc48f8df
CREATE OR REPLACE FUNCTION public.answer_status(p_req_id bigint, p_b64 text, p_w integer DEFAULT 0, p_h integer DEFAULT 0, p_caption text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_cap  text := btrim(regexp_replace(coalesce(p_caption, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_exp  timestamptz := public.olnu_next_expiry();
  r      public.status_reqs;
  v_data bytea;
  v_mime text;
  v_body text;
  v_mid  bigint;
  v_pid  bigint;
  v_rank int;
begin
  select * into r from public.status_reqs x where x.id = p_req_id and x.created_at > now() - interval '12 hours';
  if not found then raise exception 'status_not_found'; end if;
  if not public.olnu_chief_member(r.group_id, v_uid) then raise exception 'not_member'; end if;
  if now() > r.created_at + interval '60 minutes' then raise exception 'status_closed'; end if;
  if char_length(v_cap) > 100 then raise exception 'invalid_msg'; end if;
  if p_b64 is null or length(p_b64) > 220000 then raise exception 'invalid_photo'; end if;
  begin
    v_data := decode(regexp_replace(p_b64, '\s', '', 'g'), 'base64');
  exception when others then
    raise exception 'invalid_photo';
  end;
  if v_data is null or octet_length(v_data) < 200 or octet_length(v_data) > 163840 then raise exception 'invalid_photo'; end if;
  if substring(v_data from 1 for 3) = '\xffd8ff'::bytea then
    v_mime := 'image/jpeg';
  elsif substring(v_data from 1 for 4) = '\x52494646'::bytea and substring(v_data from 9 for 4) = '\x57454250'::bytea then
    v_mime := 'image/webp';
  else
    raise exception 'invalid_photo';
  end if;
  if coalesce(p_w, 0) < 1 or coalesce(p_h, 0) < 1 or p_w > 2048 or p_h > 2048 then raise exception 'invalid_photo'; end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_status_a:' || p_req_id::text || ':' || v_uid::text, 0));
  if exists (select 1 from public.status_answers a where a.req_id = p_req_id and a.user_id = v_uid) then
    raise exception 'status_answered';
  end if;

  update public.chat_photos cp set bytes = null where cp.expires_at < now() and cp.bytes is not null;

  v_body := '📷 🎖️ Lägesrapport' || case when v_cap = '' then '' else ': ' || v_cap end;
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (r.group_id, v_uid, v_body, v_exp)
  returning id into v_mid;
  insert into public.chat_photos (group_id, user_id, msg_id, mime, bytes, size, w, h, expires_at)
  values (r.group_id, v_uid, v_mid, v_mime, v_data, octet_length(v_data), p_w, p_h, v_exp)
  returning id into v_pid;
  insert into public.status_answers (req_id, user_id, photo_id, msg_id, created_at)
  values (p_req_id, v_uid, v_pid, v_mid, now());
  select count(*)::int into v_rank from public.status_answers a where a.req_id = p_req_id;
  return jsonb_build_object('photo_id', v_pid, 'msg_id', v_mid, 'rank', v_rank, 'in_time', now() <= r.ends_at,
    'sec', greatest(0, floor(extract(epoch from (now() - r.created_at))))::int);
end; $function$;
