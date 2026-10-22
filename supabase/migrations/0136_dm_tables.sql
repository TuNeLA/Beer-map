-- Öl Nu — 💬 PRIVATA MEDDELANDEN (CONTRACT "💬 MEDDELANDEN"). Additive only. Safe to run again.
-- A 1:1 private chat is a HIDDEN 2-person group, the same trick as the event chats (0084): a normal `groups` row
-- (name "💬 Direkt", created_by NULL so create_group's limit never counts it, a random valid code) plus a
-- `dm_threads` row. Nobody is ever a group_members row of it (BEFORE INSERT guard olnu_dm_guard), so it is invisible to
-- everything built on membership: my_groups / Grupper, friend_list, pins, duels, leagues, boards, meriter, squad,
-- crew, gang, friend auto-add, group pickers. The chat RPCs (0085) get access through olnu_chat_can, which now also
-- asks olnu_dm_access:  participant + still friends (accepted friendship or a shared real group) + no block either way
--   = write; participant otherwise = read; anyone else = none.
-- Messages, photos and voice in a DM last 7 days (BEFORE INSERT trigger sets expires_at), not until 05:00.
-- Rows are never removed: blocks and mutes are flags, threads end by time.
-- Needs 0001 (groups, group_members, group_msgs), 0020/0090 (chat_photos, voice_msgs), 0045 (friendships,
-- olnu_friend_name), 0084 (olnu_tg_access, olnu_chat_can, olnu_is_temp_group).

create table if not exists public.dm_threads (
  group_id   uuid primary key references public.groups (id),
  a          uuid not null,                  -- the smaller uuid of the pair
  b          uuid not null,                  -- the bigger one
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (a < b)
);
create unique index if not exists dm_threads_pair on public.dm_threads (a, b);
create index if not exists dm_threads_b on public.dm_threads (b);
create index if not exists dm_threads_creator on public.dm_threads (created_by, created_at desc);

-- Per person and thread: last seen message ("Sett"), mute.
create table if not exists public.dm_state (
  group_id   uuid not null references public.dm_threads (group_id),
  user_id    uuid not null,
  seen_id    bigint not null default 0,
  seen_at    timestamptz,
  muted      boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- 🚫 Blockera: stops messages both ways. active = false is an unblock (row kept).
create table if not exists public.dm_blocks (
  blocker    uuid not null,
  blocked    uuid not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
create index if not exists dm_blocks_blocked on public.dm_blocks (blocked) where active;

alter table public.dm_threads enable row level security;
alter table public.dm_state enable row level security;
alter table public.dm_blocks enable row level security;
revoke all on public.dm_threads, public.dm_state, public.dm_blocks from anon, authenticated;
grant all on public.dm_threads, public.dm_state, public.dm_blocks to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.olnu_dm_is(p_gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dm_threads t where t.group_id = p_gid);
$$;

-- The other person of a thread (null when p_uid is not in it).
create or replace function public.olnu_dm_other(p_gid uuid, p_uid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case when t.a = p_uid then t.b when t.b = p_uid then t.a end
    from public.dm_threads t where t.group_id = p_gid;
$$;

-- "Friends" for messages: an accepted friendship or a shared real group (temp / DM groups have no members).
create or replace function public.olnu_dm_friends(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_a is not null and p_b is not null and p_a <> p_b and (
    exists (select 1 from public.friendships f
             where least(f.a, f.b) = least(p_a, p_b) and greatest(f.a, f.b) = greatest(p_a, p_b) and f.status = 'accepted')
    or exists (select 1 from public.group_members m1 join public.group_members m2 on m2.group_id = m1.group_id
                where m1.user_id = p_a and m2.user_id = p_b));
$$;

-- A block in either direction.
create or replace function public.olnu_dm_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dm_blocks k
                  where k.active and ((k.blocker = p_a and k.blocked = p_b) or (k.blocker = p_b and k.blocked = p_a)));
$$;

-- null = not a DM; 'none' | 'read' | 'write' for p_uid.
create or replace function public.olnu_dm_access(p_gid uuid, p_uid uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  t public.dm_threads;
  v_o uuid;
begin
  select * into t from public.dm_threads x where x.group_id = p_gid;
  if not found then return null; end if;
  if p_uid is null or (p_uid <> t.a and p_uid <> t.b) then return 'none'; end if;
  v_o := case when t.a = p_uid then t.b else t.a end;
  if public.olnu_dm_blocked(p_uid, v_o) or not public.olnu_dm_friends(p_uid, v_o) then return 'read'; end if;
  return 'write';
end; $$;

-- The ONE membership test of the chat RPCs (0084/0085), now with DMs. Same signature and result type.
create or replace function public.olnu_chat_can(p_gid uuid, p_uid uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    exists (select 1 from public.group_members m where m.group_id = p_gid and m.user_id = p_uid)
    or coalesce(public.olnu_tg_access(p_gid, p_uid), 'none') = any (case when p_write then array['write'] else array['read', 'write'] end)
    or coalesce(public.olnu_dm_access(p_gid, p_uid), 'none') = any (case when p_write then array['write'] else array['read', 'write'] end));
$$;

-- The chat RPCs use this only to take names from olnu_friend_name (no group_members row): true for DMs too.
create or replace function public.olnu_is_temp_group(p_gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.temp_groups t where t.group_id = p_gid)
      or exists (select 1 from public.dm_threads d where d.group_id = p_gid);
$$;

-- Nobody may join a DM group (join_group by code, or any other path).
create or replace function public.olnu_dm_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.dm_threads t where t.group_id = new.group_id) then
    raise exception 'group_not_found';
  end if;
  return new;
end; $$;
create or replace trigger olnu_dm_guard before insert on public.group_members
  for each row execute function public.olnu_dm_guard();

-- DM rows live 7 days (group chat: until 05:00).
create or replace function public.olnu_dm_expiry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.dm_threads t where t.group_id = new.group_id) then
    new.expires_at := now() + interval '7 days';
  end if;
  return new;
end; $$;
create or replace trigger olnu_zz_dm_exp before insert on public.group_msgs
  for each row execute function public.olnu_dm_expiry();
create or replace trigger olnu_zz_dm_exp before insert on public.chat_photos
  for each row execute function public.olnu_dm_expiry();
create or replace trigger olnu_zz_dm_exp before insert on public.voice_msgs
  for each row execute function public.olnu_dm_expiry();

-- ---------------------------------------------------------------------------
-- Grants: helpers nobody (the chat RPCs run as definer)
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_dm_is(uuid), public.olnu_dm_other(uuid, uuid), public.olnu_dm_friends(uuid, uuid), '
    || 'public.olnu_dm_blocked(uuid, uuid), public.olnu_dm_access(uuid, uuid), public.olnu_chat_can(uuid, uuid, boolean), '
    || 'public.olnu_is_temp_group(uuid), public.olnu_dm_guard(), public.olnu_dm_expiry()';
begin
  execute 'revoke all on function ' || v_helpers || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || v_helpers || ' from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || v_helpers || ' from authenticated'; end if;
end $$;
