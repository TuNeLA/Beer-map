-- public.post_photo(p_group_id uuid, p_b64 text, p_w integer, p_h integer, p_caption text)
-- live md5(pg_get_functiondef) = 63b084044d955cb7d14a74a552a5d4a3
CREATE OR REPLACE FUNCTION public.post_photo(p_group_id uuid, p_b64 text, p_w integer DEFAULT 0, p_h integer DEFAULT 0, p_caption text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
