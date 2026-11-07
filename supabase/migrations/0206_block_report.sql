-- 0206 TRUST & SAFETY · 🚫 Blockera + 🚩 Anmäl for all user content (store-compliance A4).
-- Additive. user_blocks starts empty, so every patched read below returns exactly what it returned before
-- until a user blocks someone with the new client. Old clients never call the new RPCs.
-- Targets are never user ids: a message/photo/voice/invite/offer/event id, or a person key the client already has
-- (group page/chat: olnu_chief_k(group, uid); friends: olnu_inv_key(viewer, uid); a DM thread: its group id).
-- No row-removing or object-removing statement in this file.

create table if not exists public.user_blocks (
  blocker    uuid not null,
  blocked    uuid not null,
  active     boolean not null default true,
  name       text,                         -- the name the blocker saw (for "Blockerade" in ⚙️); never shown to others
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
create index if not exists user_blocks_blocked on public.user_blocks (blocked) where active;

create table if not exists public.ugc_reports (
  id          bigserial primary key,
  reporter    uuid not null,
  target      uuid,                        -- the author (null when unknown, e.g. an imported event)
  kind        text not null check (kind in ('msg','photo','voice','person','name','avatar','invite','event','offer','dm')),
  ref         text,
  group_id    uuid,
  reason      text check (reason in ('hat','sex','hot','spam','minor','drog','annat')),
  note        text,
  excerpt     text,                        -- a copy of the reported text at report time (for the owner)
  status      text not null default 'new' check (status in ('new','dismissed','hidden','warned')),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  notice      text,                        -- DSA art. 17: the reason shown to the author when content was removed
  notice_seen boolean not null default false
);
alter table public.ugc_reports enable row level security;
revoke all on public.ugc_reports from anon, authenticated;
create index if not exists ugc_reports_status on public.ugc_reports (status, created_at desc);
create index if not exists ugc_reports_reporter on public.ugc_reports (reporter, created_at desc);
create index if not exists ugc_reports_target on public.ugc_reports (target) where notice is not null and not notice_seen;

-- Is b hidden for viewer a? Either side blocked the other (a blocked user cannot see the blocker either).
create or replace function public.olnu_ub_hidden(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from public.user_blocks k
     where k.active and ((k.blocker = p_a and k.blocked = p_b) or (k.blocker = p_b and k.blocked = p_a)));
$$;
revoke all on function public.olnu_ub_hidden(uuid, uuid) from public, anon, authenticated;

-- Resolve a report/block target. Raises invalid_target when the caller cannot see that thing.
create or replace function public.olnu_safety_target(p_uid uuid, p_kind text, p_ref text, p_group uuid, p_k text)
returns table(target uuid, gid uuid, excerpt text)
language plpgsql stable security definer set search_path = public as $$
declare v_id bigint; v_k text := btrim(coalesce(p_k, ''));
begin
  if p_kind in ('msg', 'dm') then
    v_id := nullif(regexp_replace(coalesce(p_ref, ''), '[^0-9]', '', 'g'), '')::bigint;
    select m.user_id, m.group_id, left(m.body, 300) into target, gid, excerpt from public.group_msgs m where m.id = v_id;
    if target is null or not public.olnu_chat_can(gid, p_uid, false) then raise exception 'invalid_target'; end if;
    -- a photo row is a message too: keep a note so the owner can open the photo
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
      -- a DM thread: the other person
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
end; $$;
revoke all on function public.olnu_safety_target(uuid, text, text, uuid, text) from public, anon, authenticated;

-- 🚩 Anmäl. Limits: 10 per hour, 30 per day per user. Same reporter + same thing = no new row ("dup").
-- 3 different reporters on a chat text/photo/voice clip → it is hidden at once (owner reviews later).
create or replace function public.report_content(p_kind text, p_ref text default null, p_group uuid default null,
                                                 p_k text default null, p_reason text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  t record;
  v_reason text := case when p_reason in ('hat','sex','hot','spam','minor','drog','annat') then p_reason else 'annat' end;
  v_note text := nullif(left(btrim(regexp_replace(coalesce(p_note, ''), '[\x00-\x1F\x7F]', ' ', 'g')), 300), '');
  v_ref text := left(coalesce(p_ref, coalesce(p_group::text, '') || ':' || coalesce(p_k, '')), 80);
  v_id bigint; v_n int; v_hidden boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_report:' || v_uid::text, 0));
  if (select count(*) from public.ugc_reports r where r.reporter = v_uid and r.created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.ugc_reports r where r.reporter = v_uid and r.created_at > now() - interval '1 day') >= 30 then
    raise exception 'slow_down';
  end if;
  select * into t from public.olnu_safety_target(v_uid, p_kind, p_ref, p_group, p_k);
  select r.id into v_id from public.ugc_reports r where r.reporter = v_uid and r.kind = p_kind and r.ref = v_ref and r.status = 'new' limit 1;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'dup', true); end if;
  insert into public.ugc_reports (reporter, target, kind, ref, group_id, reason, note, excerpt)
  values (v_uid, t.target, p_kind, v_ref, t.gid, v_reason, v_note, t.excerpt)
  returning id into v_id;
  if p_kind in ('msg', 'dm', 'photo', 'voice') then
    select count(distinct r.reporter) into v_n from public.ugc_reports r where r.kind = p_kind and r.ref = v_ref and r.status = 'new';
    if v_n >= 3 then
      perform public.olnu_safety_hide(p_kind, v_ref);
      v_hidden := true;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'dup', false, 'hidden', v_hidden);
end; $$;

-- Hide one piece of content (used by auto-hide and by the owner panel). It ends now: the same as the 05:00 expiry.
create or replace function public.olnu_safety_hide(p_kind text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(regexp_replace(coalesce(p_ref, ''), '[^0-9]', '', 'g'), '')::bigint;
begin
  if v_id is null then return; end if;
  if p_kind in ('msg', 'dm') then
    update public.group_msgs m set expires_at = least(m.expires_at, now()) where m.id = v_id;
    update public.chat_photos cp set expires_at = least(cp.expires_at, now()) where cp.msg_id = v_id;
  elsif p_kind = 'photo' then
    update public.chat_photos cp set expires_at = least(cp.expires_at, now()) where cp.id = v_id;
  elsif p_kind = 'voice' then
    update public.voice_msgs v set expires_at = least(v.expires_at, now()) where v.id = v_id;
  elsif p_kind = 'offer' then
    update public.bar_offers o set expires_at = least(o.expires_at, now()) where o.id = v_id;
  elsif p_kind = 'invite' then
    update public.invites i set status = 'cancelled', updated_at = now() where i.id = v_id;
  elsif p_kind = 'event' then
    update public.bar_events e set status = 'hidden', status_at = now() where e.id = v_id;
  end if;
end; $$;
revoke all on function public.olnu_safety_hide(text, text) from public, anon, authenticated;

-- 🚫 Blockera (same target refs as report). Also ends a friendship (so the blocked person loses the friend map view).
create or replace function public.block_user(p_kind text default 'person', p_ref text default null, p_group uuid default null,
                                             p_k text default null, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); t record; v_name text;
begin
  if (select count(*) from public.user_blocks k where k.blocker = v_uid and k.updated_at > now() - interval '1 minute') >= 10 then
    raise exception 'slow_down';
  end if;
  select * into t from public.olnu_safety_target(v_uid, coalesce(p_kind, 'person'), p_ref, p_group, p_k);
  v_name := left(coalesce(public.olnu_friend_name(t.target), '?'), 30);
  insert into public.user_blocks as k (blocker, blocked, active, name)
  values (v_uid, t.target, coalesce(p_on, true), v_name)
  on conflict (blocker, blocked) do update set active = coalesce(p_on, true), name = coalesce(k.name, excluded.name), updated_at = now();
  if coalesce(p_on, true) then
    update public.friendships f set status = 'removed', ended_by = v_uid, updated_at = now()
     where ((f.a = v_uid and f.b = t.target) or (f.b = v_uid and f.a = t.target)) and f.status in ('accepted', 'pending');
  end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, true), 'name', v_name,
                            'id', substr(md5(v_uid::text || ':' || t.target::text || ':olnu-ub'), 1, 16));
end; $$;

create or replace function public.my_blocks()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('v', 1, 'blocks', coalesce((select jsonb_agg(jsonb_build_object(
           'id', substr(md5(k.blocker::text || ':' || k.blocked::text || ':olnu-ub'), 1, 16), 'name', coalesce(k.name, '?'), 'at', k.created_at)
           order by k.created_at desc) from public.user_blocks k where k.blocker = public.olnu_uid() and k.active), '[]'::jsonb));
$$;

create or replace function public.unblock_user(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); n int;
begin
  update public.user_blocks k set active = false, updated_at = now()
   where k.blocker = v_uid and k.active and substr(md5(k.blocker::text || ':' || k.blocked::text || ':olnu-ub'), 1, 16) = p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found'; end if;
  return jsonb_build_object('ok', true);
end; $$;

-- safety_state: age, terms, blocks count, removal notices (DSA art. 17) for this user. Notices are marked seen.
create or replace function public.safety_state(p_seen boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); s public.user_safety; v_not jsonb;
begin
  select * into s from public.user_safety x where x.user_id = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'text', r.notice, 'at', r.handled_at) order by r.handled_at), '[]'::jsonb)
    into v_not from public.ugc_reports r where r.target = v_uid and r.notice is not null and not r.notice_seen;
  if coalesce(p_seen, false) then
    update public.ugc_reports r set notice_seen = true where r.target = v_uid and r.notice is not null and not r.notice_seen;
  end if;
  return jsonb_build_object('v', 1, 'age_ok', s.age_ok, 'age_checked_at', s.age_checked_at,
    'terms_ver', s.terms_ver, 'terms_at', s.terms_at, 'store', public.olnu_store_on(),
    'blocks', (select count(*) from public.user_blocks k where k.blocker = v_uid and k.active),
    'notices', v_not);
end; $$;

revoke all on function public.report_content(text, text, uuid, text, text, text) from public, anon;
revoke all on function public.block_user(text, text, uuid, text, boolean) from public, anon;
revoke all on function public.my_blocks() from public, anon;
revoke all on function public.unblock_user(text) from public, anon;
revoke all on function public.safety_state(boolean) from public, anon;
grant execute on function public.report_content(text, text, uuid, text, text, text) to authenticated;
grant execute on function public.block_user(text, text, uuid, text, boolean) to authenticated;
grant execute on function public.my_blocks() to authenticated;
grant execute on function public.unblock_user(text) to authenticated;
grant execute on function public.safety_state(boolean) to authenticated;

-- ---------- Server-side hiding (unchanged result while user_blocks is empty) ----------

-- DMs: a user block blocks the DM both ways, same as the old DM-only block.
create or replace function public.olnu_dm_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dm_blocks k
                  where k.active and ((k.blocker = p_a and k.blocked = p_b) or (k.blocker = p_b and k.blocked = p_a)))
      or public.olnu_ub_hidden(p_a, p_b);
$$;

create or replace function public.group_msgs(p_group_id uuid, p_after_id bigint default 0)
returns table(id bigint, name text, body text, created_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
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
         and not public.olnu_ub_hidden(v_uid, gm.user_id)   -- 0206 🚫
       order by case when v_after = 0 then -gm.id else gm.id end
       limit 100
    ) s order by s.mid;
end; $$;

create or replace function public.group_photos(p_group_id uuid, p_after_id bigint default 0, p_before_id bigint default null)
returns table(id bigint, msg_id bigint, w integer, h integer, size integer, created_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
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
       and not public.olnu_ub_hidden(v_uid, cp.user_id)   -- 0206 🚫
     order by cp.id desc limit 100) x
   order by x.id;
end;
$$;

create or replace function public.group_voices(p_group_id uuid, p_after_id bigint default 0)
returns table(id bigint, name text, mime text, dur_ms integer, bytes integer, created_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
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
       and not public.olnu_ub_hidden(v_uid, v.user_id)   -- 0206 🚫
     order by v.id desc limit 30) x
   order by x.id;
end;
$$;

-- Avatars (member list faces, chat faces, friend list): a blocked person is left out.
create or replace function public.avatars_for(p_group_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v jsonb; v_temp boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_group_id is null then
    with u as (
      select v_uid as uid
      union
      select case when f.a = v_uid then f.b else f.a end from public.friendships f
       where (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
      limit 300
    )
    select coalesce(jsonb_agg(jsonb_build_object('k', case when u.uid = v_uid then 'me' else public.olnu_inv_key(v_uid, u.uid) end,
             'name', public.olnu_friend_name(u.uid), 'is_me', u.uid = v_uid) || public.olnu_avatar_pub(u.uid)), '[]'::jsonb)
      into v from u where u.uid is not null and not public.olnu_ub_hidden(v_uid, u.uid);
    return jsonb_build_object('v', 1, 'people', v);
  end if;
  if not public.olnu_chat_can(p_group_id, v_uid, false) then raise exception 'not_member'; end if;
  v_temp := public.olnu_is_temp_group(p_group_id);
  with u as (
    select m.user_id as uid from public.group_members m where m.group_id = p_group_id
    union select t.a from public.dm_threads t where t.group_id = p_group_id
    union select t.b from public.dm_threads t where t.group_id = p_group_id
    union select gm.user_id from public.group_msgs gm where gm.group_id = p_group_id and gm.expires_at > now()
    union select v_uid
    limit 200
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_chief_k(p_group_id, u.uid),
           'name', coalesce((select mm.display_name from public.group_members mm where mm.group_id = p_group_id and mm.user_id = u.uid),
                            case when v_temp then public.olnu_friend_name(u.uid) end),
           'is_me', u.uid = v_uid) || public.olnu_avatar_pub(u.uid)), '[]'::jsonb)
    into v from u where u.uid is not null and not public.olnu_ub_hidden(v_uid, u.uid);
  return jsonb_build_object('v', 1, 'people', v);
end; $$;

-- Map pins: a blocked person's pin is gone both ways (stalking guard). In store mode a stranger's pin has no
-- number (owner decision 1: only your own groups see counts). Unchanged for everyone while store_mode = 'off'
-- and user_blocks is empty.
create or replace function public.olnu_pins(p_uid uuid, p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision)
returns table(beer_id bigint, pin_id text, lat double precision, lng double precision, snap text, bar_id text, precise boolean, beer_count integer, other_count integer, other_kind text, created_at timestamp with time zone, is_mine boolean, is_friend boolean, friend_name text)
language plpgsql stable set search_path = public as $$
declare
  v_box    boolean := p_min_lat is not null and p_min_lng is not null and p_max_lat is not null and p_max_lng is not null;
  v_secret text := (select s.secret from public.olnu_secrets s where s.id = 1);
  v_bucket bigint := floor(extract(epoch from now()) / 600)::bigint;
  v_store  boolean := public.olnu_store_on();
  v_a float8 := p_min_lat - 0.0035;  v_c float8 := p_max_lat + 0.0035;
  v_b float8 := p_min_lng - 0.0070;  v_d float8 := p_max_lng + 0.0070;
begin
  return query
  with mates as (
    select am.user_id as uid, min(am.display_name) as fname
      from public.group_members cm
      join public.group_members am on am.group_id = cm.group_id
     where cm.user_id = p_uid and am.user_id <> p_uid
     group by am.user_id
  ),
  me_and_mates as (
    select m.uid, m.fname from mates m
    union all
    select p_uid, null::text
  ),
  cand as (
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, mm.uid is not null as known, mm.fname
      from public.beers b
      left join me_and_mates mm on mm.uid = b.user_id
     where b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and (not v_box or (b.lat between v_a and v_c and b.lng between v_b and v_d))
    union all
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, true, mm.fname
      from me_and_mates mm
      join public.beers b on b.user_id = mm.uid
     where v_box and b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and not (b.lat between v_a and v_c and b.lng between v_b and v_d)
  )
  select c.id,
         case when c.known then c.id::text
              else 'p' || left(md5(v_secret || ':' || c.id::text || ':' || v_bucket::text), 15) end,
         case when c.known then c.lat else coalesce(c.snap_lat, (round(c.lat::numeric / 0.005) * 0.005)::float8) end,
         case when c.known then c.lng else coalesce(c.snap_lng, (round(c.lng::numeric / 0.01) * 0.01)::float8) end,
         case when c.known then (case when c.precise then 'exact' else 'area' end)
              when c.snap_bar is not null then 'bar' else 'area' end,
         c.snap_bar,
         case when c.known then c.precise else c.snap_bar is not null end,
         case when v_store and not c.known then 1 else c.beer_count end,
         case when v_store and not c.known then 0 else coalesce(c.other_count, 0) end,
         case when v_store and not c.known then null else c.other_kind end,
         case when c.known then c.created_at
              else to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900) end,
         c.user_id = p_uid, c.known and c.user_id <> p_uid, c.fname
    from cand c
   where (c.known or not v_box
      or (coalesce(c.snap_lat, c.lat) between p_min_lat and p_max_lat
          and coalesce(c.snap_lng, c.lng) between p_min_lng and p_max_lng))
     and (c.known or not public.olnu_is_test_zone(c.lat, c.lng) or (select public.olnu_is_test_user(p_uid)))
     and not public.olnu_ub_hidden(p_uid, c.user_id);   -- 0206 🚫
end;
$$;
