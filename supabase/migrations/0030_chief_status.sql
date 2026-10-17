-- 0030 v22 GRUPPCHEF + LÄGESRAPPORT. Client: docs/js/chief.js + docs/chief.css. Push: notify-group {event:"status_req"}.
-- A group has one "gruppchef" (default: the group creator; else the member who joined first). The creator or the
-- chief can hand the role to another member. The chief can ask for a "lägesrapport": every member gets a push and
-- has 10 minutes to send a photo. The photo is a normal chat photo (chat_photos + group_msgs, same as 0028) and is
-- linked to the request in status_answers. Late answers (up to 60 min after the start) are kept and marked late.
-- Limits per group: 1 request per 20 min, 6 per night. No penalty for a missed report.
-- Additive only. Needs 0001-0029 (groups, group_members, group_msgs, chat_photos, olnu_uid, olnu_night_of,
-- olnu_next_expiry). Rows are never removed; every read filters on time.
-- RLS on, no policies. All RPCs: SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only.
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.group_chiefs (
  group_id   uuid primary key,
  user_id    uuid not null,
  set_by     uuid null,
  updated_at timestamptz not null default now()
);

create table if not exists public.status_reqs (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,                       -- the chief who asked
  night      timestamptz not null,                -- olnu_night_of(created_at)
  created_at timestamptz not null default now(),
  ends_at    timestamptz not null,                -- created_at + 10 min
  notified   boolean not null default false       -- push claim (edge function)
);
create index if not exists status_reqs_group_idx on public.status_reqs (group_id, created_at desc);
create index if not exists status_reqs_user_idx  on public.status_reqs (user_id, created_at desc);

create table if not exists public.status_answers (
  req_id     bigint not null,
  user_id    uuid not null,
  photo_id   bigint null,
  msg_id     bigint null,
  created_at timestamptz not null default now(),
  primary key (req_id, user_id)
);
create index if not exists status_answers_user_idx on public.status_answers (user_id, created_at desc);

alter table public.group_chiefs   enable row level security;
alter table public.status_reqs    enable row level security;
alter table public.status_answers enable row level security;

revoke all on table public.group_chiefs, public.status_reqs, public.status_answers from public;
revoke all on sequence public.status_reqs_id_seq from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.group_chiefs, public.status_reqs, public.status_answers from anon';
    execute 'revoke all on sequence public.status_reqs_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.group_chiefs, public.status_reqs, public.status_answers from authenticated';
    execute 'revoke all on sequence public.status_reqs_id_seq from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.group_chiefs, public.status_reqs, public.status_answers to service_role';
    execute 'grant all on sequence public.status_reqs_id_seq to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_chief_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$$;

-- Opaque member key (never a user id).
create or replace function public.olnu_chief_k(p_group uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-chief'), 1, 12);
$$;

create or replace function public.olnu_chief_name(p_group uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid;
$$;

-- The chief: the appointed one while still a member, else the creator while a member, else the first to join.
create or replace function public.olnu_chief_of(p_group uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.user_id from public.group_chiefs c
       join public.group_members m on m.group_id = c.group_id and m.user_id = c.user_id
      where c.group_id = p_group),
    (select g.created_by from public.groups g
       join public.group_members m on m.group_id = g.id and m.user_id = g.created_by
      where g.id = p_group),
    (select m.user_id from public.group_members m where m.group_id = p_group order by m.joined_at, m.user_id limit 1));
$$;

-- Start of tonight (05:00 the day before the next 05:00), DST-correct.
create or replace function public.olnu_chief_from()
returns timestamptz language sql stable set search_path = public as $$
  select ((public.olnu_next_expiry() at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$$;

-- Full report of one request for p_uid.
-- needed = members who joined before the request, without the chief who asked (the chief may answer, never "missing").
create or replace function public.olnu_status_json(r public.status_reqs, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with mem as (
    select m.user_id, m.display_name, m.joined_at from public.group_members m where m.group_id = r.group_id
  ), ans as (
    select a.user_id, a.photo_id, a.msg_id, a.created_at,
           (a.created_at <= r.ends_at) as in_time,
           row_number() over (order by a.created_at, a.user_id) as rk
      from public.status_answers a
      join mem on mem.user_id = a.user_id
     where a.req_id = r.id
  ), need as (
    select mem.* from mem where mem.joined_at <= r.created_at and mem.user_id <> r.user_id
  )
  select jsonb_build_object(
    'id', r.id, 'group_id', r.group_id,
    'group_name', (select g.name from public.groups g where g.id = r.group_id),
    'by', public.olnu_chief_name(r.group_id, r.user_id), 'by_me', r.user_id = p_uid,
    'created_at', r.created_at, 'ends_at', r.ends_at, 'now', now(),
    'late_until', r.created_at + interval '60 minutes',
    'needed', (select count(*) from need)::int,
    'answered', (select count(*) from ans a where a.in_time and a.user_id in (select user_id from need))::int,
    'done', now() >= r.ends_at
            or ((select count(*) from need) > 0
                and (select count(*) from ans a where a.in_time and a.user_id in (select user_id from need))
                    >= (select count(*) from need)),
    'mine', exists (select 1 from ans a where a.user_id = p_uid),
    'answers', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_chief_k(r.group_id, a.user_id), 'name', public.olnu_chief_name(r.group_id, a.user_id),
        'is_me', a.user_id = p_uid, 'is_chief', a.user_id = r.user_id,
        'photo_id', a.photo_id, 'msg_id', a.msg_id, 'at', a.created_at,
        'sec', greatest(0, floor(extract(epoch from (a.created_at - r.created_at))))::int,
        'in_time', a.in_time, 'rank', a.rk) order by a.created_at, a.user_id) from ans a), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_chief_k(r.group_id, n.user_id), 'name', n.display_name, 'is_me', n.user_id = p_uid)
        order by n.display_name)
        from need n where not exists (select 1 from ans a where a.user_id = n.user_id)), '[]'::jsonb));
$$;

-- Chief block of a group for p_uid.
create or replace function public.olnu_chief_json(p_group uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (select public.olnu_chief_of(p_group) as uid),
  last as (
    select r.* from public.status_reqs r where r.group_id = p_group order by r.created_at desc, r.id desc limit 1
  ), tonight as (
    select count(*)::int as n from public.status_reqs r where r.group_id = p_group and r.created_at >= public.olnu_chief_from()
  )
  select jsonb_build_object(
    'group_id', p_group,
    'chief_k', (select public.olnu_chief_k(p_group, c.uid) from c),
    'chief_name', (select public.olnu_chief_name(p_group, c.uid) from c),
    'is_chief', (select c.uid = p_uid from c),
    'is_creator', exists (select 1 from public.groups g where g.id = p_group and g.created_by = p_uid),
    'can_hand', (select c.uid = p_uid from c)
                or exists (select 1 from public.groups g where g.id = p_group and g.created_by = p_uid),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_chief_k(p_group, m.user_id), 'name', m.display_name,
        'is_me', m.user_id = p_uid, 'is_chief', m.user_id = (select uid from c)) order by m.joined_at, m.display_name)
        from public.group_members m where m.group_id = p_group), '[]'::jsonb),
    'used', (select n from tonight),
    'max', 6,
    'next_at', greatest(now(), coalesce((select l.created_at + interval '20 minutes' from last l), now())),
    'req', (select public.olnu_status_json(l, p_uid) from last l where l.created_at > now() - interval '2 hours'));
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- chief_state(p_group_id) -> jsonb {group_id, chief_k, chief_name, is_chief, is_creator, can_hand, members[], used, max,
--   next_at, req (newest request of the last 2 h, see status_report, or null)}. Error: not_member.
create or replace function public.chief_state(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  return public.olnu_chief_json(p_group_id, v_uid);
end; $$;

-- set_chief(p_group_id, p_k) -> chief_state. Only the chief or the creator. Errors: not_member, not_allowed, invalid_member.
create or replace function public.set_chief(p_group_id uuid, p_k text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_new uuid;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_chief:' || p_group_id::text, 0));
  if not (public.olnu_chief_of(p_group_id) = v_uid
          or exists (select 1 from public.groups g where g.id = p_group_id and g.created_by = v_uid)) then
    raise exception 'not_allowed';
  end if;
  select m.user_id into v_new from public.group_members m
   where m.group_id = p_group_id and public.olnu_chief_k(p_group_id, m.user_id) = p_k limit 1;
  if v_new is null then raise exception 'invalid_member'; end if;
  insert into public.group_chiefs (group_id, user_id, set_by, updated_at)
  values (p_group_id, v_new, v_uid, now())
  on conflict (group_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, updated_at = now();
  return public.olnu_chief_json(p_group_id, v_uid);
end; $$;

-- request_status(p_group_id) -> jsonb (status_report of the new request). Chief only.
-- Errors: not_member, not_chief, status_slow (20 min per group), status_limit (6 per group per night).
create or replace function public.request_status(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r public.status_reqs;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_status:' || p_group_id::text, 0));
  if public.olnu_chief_of(p_group_id) is distinct from v_uid then raise exception 'not_chief'; end if;
  if exists (select 1 from public.status_reqs x where x.group_id = p_group_id and x.created_at > now() - interval '20 minutes') then
    raise exception 'status_slow';
  end if;
  if (select count(*) from public.status_reqs x where x.group_id = p_group_id and x.created_at >= public.olnu_chief_from()) >= 6 then
    raise exception 'status_limit';
  end if;
  insert into public.status_reqs (group_id, user_id, night, created_at, ends_at)
  values (p_group_id, v_uid, public.olnu_night_of(now()), now(), now() + interval '10 minutes')
  returning * into r;
  return public.olnu_status_json(r, v_uid);
end; $$;

-- status_report(p_req_id) -> jsonb {id, group_id, group_name, by, by_me, created_at, ends_at, now, late_until, needed,
--   answered, done, mine, answers[{k,name,is_me,is_chief,photo_id,msg_id,at,sec,in_time,rank}], missing[{k,name,is_me}]}.
-- Requests older than 12 h are gone. Errors: status_not_found, not_member.
create or replace function public.status_report(p_req_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r public.status_reqs;
begin
  select * into r from public.status_reqs x where x.id = p_req_id and x.created_at > now() - interval '12 hours';
  if not found then raise exception 'status_not_found'; end if;
  if not public.olnu_chief_member(r.group_id, v_uid) then raise exception 'not_member'; end if;
  return public.olnu_status_json(r, v_uid);
end; $$;

-- my_status() -> jsonb [status_report ...] for every group of the caller, requests of the last 70 min, newest first.
create or replace function public.my_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return coalesce((
    select jsonb_agg(public.olnu_status_json(r, v_uid) order by r.created_at desc)
      from public.status_reqs r
      join public.group_members m on m.group_id = r.group_id and m.user_id = v_uid
     where r.created_at > now() - interval '70 minutes'), '[]'::jsonb);
end; $$;

-- answer_status(p_req_id, p_b64, p_w, p_h, p_caption default null) -> jsonb {photo_id, msg_id, rank, in_time, sec}.
-- The photo goes into the group chat like post_photo (body "📷 🎖️ Lägesrapport[: caption]") but outside the normal
-- photo limits (one per request and member). Answers are taken until 60 min after the start.
-- Errors: status_not_found, not_member, status_closed (> 60 min), status_answered, invalid_photo, invalid_msg.
create or replace function public.answer_status(p_req_id bigint, p_b64 text, p_w int default 0, p_h int default 0, p_caption text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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

  -- Same space rule as post_photo: empty the bytes of expired photos (rows stay).
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
end; $$;

-- ---------------------------------------------------------------------------
-- Grants: helpers nobody, RPCs authenticated only
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_chief_member(uuid, uuid), public.olnu_chief_k(uuid, uuid), public.olnu_chief_name(uuid, uuid), '
    || 'public.olnu_chief_of(uuid), public.olnu_chief_from(), public.olnu_status_json(public.status_reqs, uuid), '
    || 'public.olnu_chief_json(uuid, uuid)';
  v_rpcs text := 'public.chief_state(uuid), public.set_chief(uuid, text), public.request_status(uuid), '
    || 'public.status_report(bigint), public.my_status(), public.answer_status(bigint, text, integer, integer, text)';
begin
  execute 'revoke all on function ' || v_helpers || ' from public';
  execute 'revoke all on function ' || v_rpcs || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_helpers || ' from anon';
    execute 'revoke all on function ' || v_rpcs || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_helpers || ' from authenticated';
    execute 'grant execute on function ' || v_rpcs || ' to authenticated';
  end if;
end $$;
