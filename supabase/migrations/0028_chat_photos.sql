-- 0028 v21 BILDER (photos in the group chat). Client: docs/js/photo.js + docs/photo.css.
-- The phone makes a small JPEG (max 1024 px, about 120 KB, no EXIF). The server keeps the bytes in
-- chat_photos and adds a normal chat row (body "📷" or "📷 <caption>") so the photo sits in order in the
-- chat. Old apps see only that text. The link msg -> photo is chat_photos.msg_id.
-- Space on the free plan: post_photo first sets bytes = null on expired photos (an UPDATE, rows stay),
-- so autovacuum can reuse the space. Max 60 photos per group per night, 10 per user per night.
-- Keep history (0029, optional): a keeping group's photos get expires_at = infinity (insert trigger) and
-- follow the group setting when it is switched on or off (trigger on group_settings). Works without 0029.
-- Additive only. Needs 0001-0021 (group_members, group_msgs, olnu_uid, olnu_next_expiry).
-- Rows are never removed; every read filters on time. RLS on, no policies.
-- All RPCs: SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only. Safe to run again.

create table if not exists public.chat_photos (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  msg_id     bigint null,
  mime       text not null,
  bytes      bytea null,
  size       int not null default 0,
  w          int not null default 0,
  h          int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists chat_photos_group_idx on public.chat_photos (group_id, id);
create index if not exists chat_photos_user_idx  on public.chat_photos (user_id, created_at);
create index if not exists chat_photos_msg_idx   on public.chat_photos (msg_id);
create index if not exists chat_photos_live_idx  on public.chat_photos (expires_at) where bytes is not null;
alter table public.chat_photos enable row level security;
revoke all on table public.chat_photos from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.chat_photos from anon';
    execute 'revoke all on sequence public.chat_photos_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.chat_photos from authenticated';
    execute 'revoke all on sequence public.chat_photos_id_seq from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.chat_photos to service_role';
  end if;
end $$;

-- "Radera allt om mig" (the erase RPC of 0016) moves every uuid column of the caller to a new random id.
-- When user_id of a photo changes, the picture itself is emptied and the photo ends now.
create or replace function public.olnu_photo_anon_tg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  begin
    if new.user_id is distinct from old.user_id then
      new.bytes := null;
      new.size := 0;
      new.expires_at := least(new.expires_at, now());
    end if;
  exception when others then null;
  end;
  return new;
end;
$$;
revoke all on function public.olnu_photo_anon_tg() from public;
create or replace trigger chat_photos_anon before update of user_id on public.chat_photos
  for each row execute function public.olnu_photo_anon_tg();

-- post_photo(p_group_id, p_b64, p_w, p_h, p_caption default null) -> jsonb {id, msg_id, created_at, expires_at, left, mime}
-- Errors: not_member, invalid_photo (bad base64, not JPEG/WebP, < 200 B or > 160 KB, bad size),
--         invalid_msg (caption > 138 chars), slow_down (15 s), photo_limit (10 per user per night),
--         group_photo_limit (60 per group per night).
create or replace function public.post_photo(p_group_id uuid, p_b64 text, p_w int default 0, p_h int default 0, p_caption text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
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
$$;

-- group_photos(p_group_id, p_after_id default 0, p_before_id default null) -> live photos (no bytes), oldest first,
-- the newest 100 with id > p_after_id; with p_before_id: the newest 100 with id < p_before_id (older chat pages).
-- created_at equals the created_at of the linked chat row (same transaction, same now()).
create or replace function public.group_photos(p_group_id uuid, p_after_id bigint default 0, p_before_id bigint default null)
returns table (id bigint, msg_id bigint, w int, h int, size int, created_at timestamptz, is_me boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
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
$$;

-- group_photo(p_photo_id) -> jsonb {id, mime, w, h, b64}. Errors: photo_not_found (expired/unknown), not_member.
create or replace function public.group_photo(p_photo_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.chat_photos;
begin
  select * into v_row from public.chat_photos cp where cp.id = p_photo_id and cp.expires_at > now() and cp.bytes is not null;
  if not found then
    raise exception 'photo_not_found';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end;
$$;

revoke all on function public.post_photo(uuid, text, integer, integer, text) from public;
revoke all on function public.group_photos(uuid, bigint, bigint) from public;
revoke all on function public.group_photo(bigint) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_photo_anon_tg(), public.post_photo(uuid, text, integer, integer, text), '
         || 'public.group_photos(uuid, bigint, bigint), public.group_photo(bigint) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_photo_anon_tg() from authenticated';
    execute 'grant execute on function public.post_photo(uuid, text, integer, integer, text), '
         || 'public.group_photos(uuid, bigint, bigint), public.group_photo(bigint) to authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Keep history (0029). Only when 0029 is there; safe in any order (run 0028 again after 0029).
-- ---------------------------------------------------------------------------
create or replace function public.olnu_photo_keep_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.keep_history then
      update public.chat_photos cp set expires_at = 'infinity'::timestamptz
       where cp.group_id = new.group_id and cp.expires_at > now() and cp.bytes is not null;
    elsif tg_op = 'UPDATE' then
      update public.chat_photos cp set expires_at = public.olnu_next_expiry()
       where cp.group_id = new.group_id and cp.expires_at = 'infinity'::timestamptz;
    end if;
  exception when others then null;
  end;
  return null;
end;
$$;
revoke all on function public.olnu_photo_keep_tg() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_photo_keep_tg() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_photo_keep_tg() from authenticated';
  end if;
  if to_regprocedure('public.olnu_keep_history_ins()') is not null then
    execute 'create or replace trigger chat_photos_keep before insert on public.chat_photos '
         || 'for each row execute function public.olnu_keep_history_ins()';
  end if;
  if to_regclass('public.group_settings') is not null then
    execute 'create or replace trigger group_settings_photos after insert or update of keep_history on public.group_settings '
         || 'for each row execute function public.olnu_photo_keep_tg()';
  end if;
end $$;
