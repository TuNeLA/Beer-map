-- 0034 v25 ROLLER: 👑 ÄGARE + 🎖️ GRUPPCHEF + 🎗️ VICE GRUPPCHEFER + "🚪 Ta bort ur gruppen".
-- Client: docs/js/chief.js (roles, appoint, group page) + docs/js/social.js (Medlemmar list actions).
-- Needs 0001-0033 (leave_group, group_members, groups, 0030 chief tables/helpers, 0033 olnu_home_town).
--
-- Roles (owner decision 2026-10-20, enforced here):
--   * OWNER ("ägare") = groups.created_by while a member. Never moved, never removable.
--     If the owner is not a member (left, or erased), the gruppchef holds the owner powers ("owner powers").
--   * GRUPPCHEF = 0030 olnu_chief_of(). Only owner powers can change it (set_chief).
--   * VICE GRUPPCHEFER: any number. Only owner powers add/clear a vice (set_vice). A vice is valid only while
--     the same membership lasts (group_vices.member_since = group_members.joined_at), so leaving and joining
--     again never brings the role back.
--   * Lägesrapport: chief OR any vice (request_status); limits stay per group (1 per 20 min, 6 per night).
--   * Acting chief: when the chief has shown no sign of life for 12 h (olnu_seen_at), the vice who was
--     appointed first and was seen in the last 12 h is "acting" (chief_state.acting_k). Vices already have
--     every chief power except removing vices/the chief, so "acting" is shown in the app only.
--   * remove_member: owner powers remove anyone but themselves and the owner; chief and vices remove plain
--     members only (a vice never removes the chief or another vice; the chief never removes a vice).
--     Nobody removes themselves (use Lämna). 20 removals per hour per remover.
--
-- How a member row is freed: rows in group_members mean "is a member" everywhere (about 60 queries), so the
-- row must really go. The only existing code that frees a row is leave_group(), which acts on olnu_uid().
-- remove_member() writes an archive row (group_members_removed), then runs leave_group() for the target
-- by switching the transaction-local JWT claim to the target for that ONE call and switching it back at
-- once (verified). The group itself never goes away there: the remover is still a member.
-- This file has no row-removing statements. Additive: old RPCs keep their names, params and json fields.
-- RLS on, no policies. All RPCs: SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only.
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.group_vices (
  group_id     uuid not null,
  user_id      uuid not null,
  member_since timestamptz not null,           -- group_members.joined_at when appointed
  active       boolean not null default true,
  set_by       uuid null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_members_removed (
  id           bigserial primary key,
  group_id     uuid not null,
  user_id      uuid not null,
  display_name text null,
  joined_at    timestamptz null,
  group_name   text null,
  removed_by   uuid null,
  removed_at   timestamptz not null default now(),
  seen         boolean not null default false
);
create index if not exists gmr_by_idx   on public.group_members_removed (removed_by, removed_at desc);
create index if not exists gmr_user_idx on public.group_members_removed (user_id, removed_at desc);

create table if not exists public.user_seen (
  user_id uuid primary key,
  seen_at timestamptz not null default now()
);

alter table public.group_vices           enable row level security;
alter table public.group_members_removed enable row level security;
alter table public.user_seen             enable row level security;
revoke all on table public.group_vices, public.group_members_removed, public.user_seen from public;
revoke all on sequence public.group_members_removed_id_seq from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.group_vices, public.group_members_removed, public.user_seen from anon';
    execute 'revoke all on sequence public.group_members_removed_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.group_vices, public.group_members_removed, public.user_seen from authenticated';
    execute 'revoke all on sequence public.group_members_removed_id_seq from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.group_vices, public.group_members_removed, public.user_seen to service_role';
    execute 'grant all on sequence public.group_members_removed_id_seq to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
-- The owner while a member, else null.
create or replace function public.olnu_owner_of(p_group uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select g.created_by from public.groups g
    join public.group_members m on m.group_id = g.id and m.user_id = g.created_by
   where g.id = p_group;
$$;

-- Owner powers: the owner, or the chief when the owner is not a member.
create or replace function public.olnu_owner_powers(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and public.olnu_chief_member(p_group, p_uid)
     and coalesce(public.olnu_owner_of(p_group), public.olnu_chief_of(p_group)) = p_uid;
$$;

create or replace function public.olnu_is_vice(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_vices v
      join public.group_members m on m.group_id = v.group_id and m.user_id = v.user_id and m.joined_at = v.member_since
     where v.group_id = p_group and v.user_id = p_uid and v.active);
$$;

-- Last sign of life: app open (mark_seen), a drink, a chat message, joining, being made chief.
create or replace function public.olnu_seen_at(p_group uuid, p_uid uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select greatest(
    (select s.seen_at from public.user_seen s where s.user_id = p_uid),
    (select b.updated_at from public.beers b where b.user_id = p_uid),
    (select max(gm.created_at) from public.group_msgs gm where gm.user_id = p_uid and gm.created_at > now() - interval '13 hours'),
    (select m.joined_at from public.group_members m where m.group_id = p_group and m.user_id = p_uid),
    (select c.updated_at from public.group_chiefs c where c.group_id = p_group and c.user_id = p_uid));
$$;

create or replace function public.olnu_chief_idle(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.olnu_seen_at(p_group, public.olnu_chief_of(p_group)) < now() - interval '12 hours', true);
$$;

-- The acting vice (or null): chief idle 12 h → the vice appointed first who was seen in the last 12 h.
create or replace function public.olnu_acting_vice(p_group uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select v.user_id from public.group_vices v
    join public.group_members m on m.group_id = v.group_id and m.user_id = v.user_id and m.joined_at = v.member_since
   where v.group_id = p_group and v.active and public.olnu_chief_idle(p_group)
     and v.user_id is distinct from public.olnu_chief_of(p_group)
     and coalesce(public.olnu_seen_at(p_group, v.user_id) >= now() - interval '12 hours', false)
   order by v.updated_at, v.user_id
   limit 1;
$$;

-- Why p_actor may NOT remove p_target from p_group (null = allowed).
create or replace function public.olnu_remove_block(p_group uuid, p_actor uuid, p_target uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := (select g.created_by from public.groups g where g.id = p_group);
  v_chief uuid := public.olnu_chief_of(p_group);
begin
  if p_actor is null or not public.olnu_chief_member(p_group, p_actor) then return 'not_member'; end if;
  if p_target is null or not public.olnu_chief_member(p_group, p_target) then return 'not_member'; end if;
  if p_target = p_actor then return 'cannot_remove_self'; end if;
  if v_owner is not null and p_target = v_owner then return 'cannot_remove_creator'; end if;
  if public.olnu_owner_powers(p_group, p_actor) then return null; end if;
  if p_actor = v_chief or public.olnu_is_vice(p_group, p_actor) then
    if p_target = v_chief or public.olnu_is_vice(p_group, p_target) then return 'not_allowed'; end if;
    return null;
  end if;
  return 'not_allowed';
end; $$;

-- Chief block of a group for p_uid (0030 fields unchanged + new fields at the end).
create or replace function public.olnu_chief_json(p_group uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (select public.olnu_chief_of(p_group) as uid),
  o as (select public.olnu_owner_of(p_group) as uid),
  act as (select public.olnu_acting_vice(p_group) as uid),
  pw as (select public.olnu_owner_powers(p_group, p_uid) as yes),
  last as (
    select r.* from public.status_reqs r where r.group_id = p_group order by r.created_at desc, r.id desc limit 1
  ), tonight as (
    select count(*)::int as n from public.status_reqs r where r.group_id = p_group and r.created_at >= public.olnu_chief_from()
  ), mem as (
    select m.user_id, m.display_name, m.joined_at, public.olnu_is_vice(p_group, m.user_id) as vice
      from public.group_members m where m.group_id = p_group
  )
  select jsonb_build_object(
    'group_id', p_group,
    'chief_k', (select public.olnu_chief_k(p_group, c.uid) from c),
    'chief_name', (select public.olnu_chief_name(p_group, c.uid) from c),
    'is_chief', (select c.uid = p_uid from c),
    'is_creator', exists (select 1 from public.groups g where g.id = p_group and g.created_by = p_uid),
    'can_hand', (select yes from pw),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_chief_k(p_group, m.user_id), 'name', m.display_name,
        'is_me', m.user_id = p_uid, 'is_chief', m.user_id = (select uid from c),
        'is_owner', m.user_id = (select uid from o), 'is_vice', m.vice,
        'is_acting', m.user_id = (select uid from act),
        'home_town', public.olnu_home_town(m.user_id),
        'can_remove', public.olnu_remove_block(p_group, p_uid, m.user_id) is null)
        order by m.joined_at, m.display_name)
        from mem m), '[]'::jsonb),
    'used', (select n from tonight),
    'max', 6,
    'next_at', greatest(now(), coalesce((select l.created_at + interval '20 minutes' from last l), now())),
    'req', (select public.olnu_status_json(l, p_uid) from last l where l.created_at > now() - interval '2 hours'),
    -- v25 (0034)
    'my_k', public.olnu_chief_k(p_group, p_uid),
    'owner_k', (select public.olnu_chief_k(p_group, o.uid) from o where o.uid is not null),
    'owner_name', (select public.olnu_chief_name(p_group, o.uid) from o),
    'is_owner', (select o.uid = p_uid from o),
    'is_vice', public.olnu_is_vice(p_group, p_uid),
    'owner_powers', (select yes from pw),
    'can_vice', (select yes from pw),
    'can_req', (select c.uid = p_uid from c) or public.olnu_is_vice(p_group, p_uid),
    'can_remove', exists (select 1 from mem m where public.olnu_remove_block(p_group, p_uid, m.user_id) is null),
    'vices', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_chief_k(p_group, m.user_id), 'name', m.display_name,
        'is_me', m.user_id = p_uid) order by m.joined_at) from mem m where m.vice), '[]'::jsonb),
    'chief_idle', public.olnu_chief_idle(p_group),
    'acting_k', (select public.olnu_chief_k(p_group, a.uid) from act a where a.uid is not null),
    'acting_name', (select public.olnu_chief_name(p_group, a.uid) from act a),
    'is_acting', (select a.uid = p_uid from act a),
    'chief_home', (select public.olnu_home_town(c.uid) from c),
    'owner_home', (select public.olnu_home_town(o.uid) from o));
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- set_chief(p_group_id, p_k) -> chief_state. v25: owner powers only. Errors: not_member, not_allowed, invalid_member.
create or replace function public.set_chief(p_group_id uuid, p_k text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_new uuid;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_chief:' || p_group_id::text, 0));
  if not public.olnu_owner_powers(p_group_id, v_uid) then raise exception 'not_allowed'; end if;
  select m.user_id into v_new from public.group_members m
   where m.group_id = p_group_id and public.olnu_chief_k(p_group_id, m.user_id) = p_k limit 1;
  if v_new is null then raise exception 'invalid_member'; end if;
  insert into public.group_chiefs (group_id, user_id, set_by, updated_at)
  values (p_group_id, v_new, v_uid, now())
  on conflict (group_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, updated_at = now();
  -- The new chief is no longer a vice.
  update public.group_vices v set active = false, updated_at = now(), set_by = v_uid
   where v.group_id = p_group_id and v.user_id = v_new and v.active;
  return public.olnu_chief_json(p_group_id, v_uid);
end; $$;

-- set_vice(p_group_id, p_k, p_on default true) -> chief_state. Owner powers only.
-- The owner and the chief cannot be vice. Errors: not_member, not_allowed, invalid_member.
create or replace function public.set_vice(p_group_id uuid, p_k text, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  m     public.group_members;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_chief:' || p_group_id::text, 0));
  if not public.olnu_owner_powers(p_group_id, v_uid) then raise exception 'not_allowed'; end if;
  select * into m from public.group_members x
   where x.group_id = p_group_id and public.olnu_chief_k(p_group_id, x.user_id) = p_k limit 1;
  if not found then raise exception 'invalid_member'; end if;
  if coalesce(p_on, true) then
    if m.user_id = public.olnu_chief_of(p_group_id)
       or m.user_id is not distinct from (select g.created_by from public.groups g where g.id = p_group_id) then
      raise exception 'invalid_member';
    end if;
    insert into public.group_vices (group_id, user_id, member_since, active, set_by, created_at, updated_at)
    values (p_group_id, m.user_id, m.joined_at, true, v_uid, now(), now())
    on conflict (group_id, user_id) do update
      set member_since = excluded.member_since, set_by = excluded.set_by,
          updated_at = case when public.group_vices.active and public.group_vices.member_since = excluded.member_since
                            then public.group_vices.updated_at else now() end,
          active = true;
  else
    update public.group_vices v set active = false, updated_at = now(), set_by = v_uid
     where v.group_id = p_group_id and v.user_id = m.user_id and v.active;
  end if;
  return public.olnu_chief_json(p_group_id, v_uid);
end; $$;

-- request_status(p_group_id): v25 the chief OR any vice. Same limits per group as 0030.
create or replace function public.request_status(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r public.status_reqs;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_status:' || p_group_id::text, 0));
  if public.olnu_chief_of(p_group_id) is distinct from v_uid and not public.olnu_is_vice(p_group_id, v_uid) then
    raise exception 'not_chief';
  end if;
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

-- remove_member(p_group_id, p_user_id) -> jsonb {ok, name, group_name, state (chief_state)}.
-- p_user_id = the member key k (chief_state / group_status_v2), or the user's uuid as text.
-- Errors: not_member (caller or target), not_allowed, cannot_remove_creator, cannot_remove_self, slow_down (20/h).
create or replace function public.remove_member(p_group_id uuid, p_user_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := public.olnu_uid();
  v_target uuid;
  v_block  text;
  v_chief  uuid;
  v_owner  uuid;
  v_sub    text;
  v_claims text;
  v_cl     jsonb;
  m        public.group_members;
  v_gname  text;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_chief:' || p_group_id::text, 0));
  select * into m from public.group_members x
   where x.group_id = p_group_id
     and (public.olnu_chief_k(p_group_id, x.user_id) = btrim(coalesce(p_user_id, ''))
          or x.user_id::text = lower(btrim(coalesce(p_user_id, ''))))
   limit 1;
  if not found then raise exception 'not_member'; end if;
  v_target := m.user_id;
  v_block := public.olnu_remove_block(p_group_id, v_uid, v_target);
  if v_block is not null then raise exception '%', v_block; end if;
  if (select count(*) from public.group_members_removed r where r.removed_by = v_uid and r.removed_at > now() - interval '1 hour') >= 20 then
    raise exception 'slow_down';
  end if;

  v_chief := public.olnu_chief_of(p_group_id);
  v_owner := (select g.created_by from public.groups g where g.id = p_group_id);
  select g.name into v_gname from public.groups g where g.id = p_group_id;

  -- Archive first.
  insert into public.group_members_removed (group_id, user_id, display_name, joined_at, group_name, removed_by)
  values (p_group_id, v_target, m.display_name, m.joined_at, v_gname, v_uid);
  -- Roles go with the membership.
  update public.group_vices v set active = false, updated_at = now(), set_by = v_uid
   where v.group_id = p_group_id and v.user_id = v_target and v.active;
  if v_target = v_chief then
    insert into public.group_chiefs (group_id, user_id, set_by, updated_at)
    values (p_group_id, coalesce(public.olnu_owner_of(p_group_id), v_uid), v_uid, now())
    on conflict (group_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, updated_at = now();
  end if;

  -- Free the membership row with the existing leave_group(), run as the target for this one call.
  v_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  begin
    v_cl := coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb);
  exception when others then
    v_cl := '{}'::jsonb;
  end;
  perform set_config('request.jwt.claim.sub', v_target::text, true);
  perform set_config('request.jwt.claims', jsonb_set(v_cl, '{sub}', to_jsonb(v_target::text), true)::text, true);
  perform public.leave_group(p_group_id);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  if public.olnu_uid() is distinct from v_uid then raise exception 'internal_error'; end if;
  if public.olnu_chief_member(p_group_id, v_target) then raise exception 'internal_error'; end if;

  return jsonb_build_object('ok', true, 'name', m.display_name, 'group_name', v_gname,
    'state', public.olnu_chief_json(p_group_id, v_uid));
end; $$;

-- my_removals() -> jsonb [{group_name, at}] removals of the caller not shown yet (last 14 days); marks them shown.
create or replace function public.my_removals()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('group_name', r.group_name, 'at', r.removed_at) order by r.removed_at), '[]'::jsonb)
    into v_out
    from public.group_members_removed r
   where r.user_id = v_uid and not r.seen and r.removed_at > now() - interval '14 days'
     and not public.olnu_chief_member(r.group_id, v_uid);
  update public.group_members_removed r set seen = true where r.user_id = v_uid and not r.seen;
  return v_out;
end; $$;

-- mark_seen() -> void. The app calls it when it is open (chief.js, max every 5 min). Used for the 12 h rule.
create or replace function public.mark_seen()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  insert into public.user_seen (user_id, seen_at) values (v_uid, now())
  on conflict (user_id) do update set seen_at = now() where public.user_seen.seen_at < now() - interval '60 seconds';
end; $$;

-- group_status_v2(p_group_id): group_status (v8/v14) + member key, roles, home town and "may I remove".
create or replace function public.group_status_v2(p_group_id uuid)
returns table(name text, beers integer, others integer, other_kind text, live boolean, total integer, is_me boolean,
              k text, is_owner boolean, is_chief boolean, is_vice boolean, is_acting boolean, home_town text,
              can_remove boolean, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_chief uuid;
  v_owner uuid;
  v_act   uuid;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  v_chief := public.olnu_chief_of(p_group_id);
  v_owner := public.olnu_owner_of(p_group_id);
  v_act := public.olnu_acting_vice(p_group_id);
  return query
  select gm.display_name,
         coalesce(case when b.expires_at > now() then b.beer_count end, 0)::int,
         coalesce(case when b.expires_at > now() then b.other_count end, 0)::int,
         case when b.expires_at > now() then b.other_kind end,
         coalesce(b.expires_at > now() and not b.stopped, false),
         public.olnu_lifetime(gm.user_id),
         (gm.user_id = v_uid),
         public.olnu_chief_k(p_group_id, gm.user_id),
         coalesce(gm.user_id = v_owner, false),
         coalesce(gm.user_id = v_chief, false),
         public.olnu_is_vice(p_group_id, gm.user_id),
         coalesce(gm.user_id = v_act, false),
         public.olnu_home_town(gm.user_id),
         public.olnu_remove_block(p_group_id, v_uid, gm.user_id) is null,
         gm.joined_at
    from public.group_members gm
    left join public.beers b on b.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by 2 desc, 3 desc, 1;
end; $function$;

-- ---------------------------------------------------------------------------
-- Grants: helpers nobody, RPCs authenticated only
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_owner_of(uuid), public.olnu_owner_powers(uuid, uuid), public.olnu_is_vice(uuid, uuid), '
    || 'public.olnu_seen_at(uuid, uuid), public.olnu_chief_idle(uuid), public.olnu_acting_vice(uuid), '
    || 'public.olnu_remove_block(uuid, uuid, uuid), public.olnu_chief_json(uuid, uuid)';
  v_rpcs text := 'public.set_chief(uuid, text), public.set_vice(uuid, text, boolean), public.request_status(uuid), '
    || 'public.remove_member(uuid, text), public.my_removals(), public.mark_seen(), public.group_status_v2(uuid)';
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
