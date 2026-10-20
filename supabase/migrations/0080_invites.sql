-- Öl Nu — 📨 INBJUDNINGAR + 👥 VÄNLISTA (CONTRACT "v28 INBJUDNINGAR"). Additive only.
-- Needs 0001 (olnu_uid, groups, group_members), 0027 (olnu_crew_pres via olnu_friend_out), 0030 (olnu_chief_k),
-- 0033 (olnu_home_town), 0045 (friendships, user_names, olnu_friend_*), 0065 (bar_events).
-- Rows are never removed: an invite ends with status 'cancelled' or by time (ends_at = start + 6 h).
-- Privacy: an invite (title, place, position, people) is readable ONLY by its participants (creator + invitees).
-- Only friends can be invited: accepted friendships (0045) or members of a shared group. Never user ids out.

create table if not exists public.invites (
  id          bigserial primary key,
  creator     uuid not null,
  title       text not null check (char_length(title) between 1 and 80),
  kind        text not null default 'beer',
  bar_id      text,
  place       text check (place is null or char_length(place) <= 60),
  lat         double precision,
  lng         double precision,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  note        text check (note is null or char_length(note) <= 200),
  event_id    bigint,
  group_id    uuid,
  spot        text not null default 'bar' check (spot in ('bar', 'spot', 'here')),
  status      text not null default 'open' check (status in ('open', 'cancelled')),
  reminded_at timestamptz,
  yes_push_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists invites_creator_idx on public.invites (creator, created_at desc);
create index if not exists invites_due_idx on public.invites (starts_at) where status = 'open' and reminded_at is null;

create table if not exists public.invite_people (
  invite_id   bigint not null references public.invites (id),
  user_id     uuid not null,
  invited_by  uuid,
  answer      text not null default 'none' check (answer in ('none', 'yes', 'maybe', 'no')),
  answered_at timestamptz,
  notified    boolean not null default false,
  yes_pushed  boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (invite_id, user_id)
);
create index if not exists invite_people_user_idx on public.invite_people (user_id, invite_id);

alter table public.invites enable row level security;
alter table public.invite_people enable row level security;
revoke all on public.invites from anon, authenticated;
revoke all on public.invite_people from anon, authenticated;
revoke all on sequence public.invites_id_seq from anon, authenticated;
grant all on public.invites, public.invite_people to service_role;
grant usage, select on sequence public.invites_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Opaque per-viewer key for a person (never a user id).
create or replace function public.olnu_inv_key(p_viewer uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5(p_viewer::text || ':' || p_uid::text || ':olnu-inv'), 1, 16);
$$;

-- Who p_uid may invite: accepted friends + members of every shared group.
create or replace function public.olnu_inv_cands(p_uid uuid)
returns table (uid uuid, k text)
language sql stable security definer set search_path = public as $$
  select x.uid, public.olnu_inv_key(p_uid, x.uid)
    from (
      select public.olnu_friend_other(f, p_uid) as uid
        from public.friendships f
       where (f.a = p_uid or f.b = p_uid) and f.status = 'accepted'
      union
      select gm2.user_id
        from public.group_members gm
        join public.group_members gm2 on gm2.group_id = gm.group_id
       where gm.user_id = p_uid and gm2.user_id <> p_uid
    ) x
   where x.uid is not null and x.uid <> p_uid
   limit 2000;
$$;

create or replace function public.olnu_inv_clean(p text, p_max int)
returns text language sql immutable set search_path = public as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]+', ' ', 'g')), p_max), '');
$$;

create or replace function public.olnu_inv_haslink(p text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p, '') ~* '(https?://|www\.|\.(se|com|nu|net|org)(/|\s|$))';
$$;

-- Full or lite json for a viewer (caller must be a participant; checked by the callers).
create or replace function public.olnu_inv_json(p_id bigint, p_viewer uuid, p_full boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  i public.invites;
  v_me public.invite_people;
  v_people jsonb := '[]'::jsonb;
  v_yes int; v_maybe int; v_no int; v_none int; v_n int;
  v_gname text;
begin
  select * into i from public.invites x where x.id = p_id;
  if not found then return null; end if;
  select * into v_me from public.invite_people p where p.invite_id = p_id and p.user_id = p_viewer;
  select count(*) filter (where answer = 'yes'), count(*) filter (where answer = 'maybe'),
         count(*) filter (where answer = 'no'), count(*) filter (where answer = 'none'), count(*)
    into v_yes, v_maybe, v_no, v_none, v_n
    from public.invite_people p where p.invite_id = p_id;
  if i.group_id is not null then select g.name into v_gname from public.groups g where g.id = i.group_id; end if;
  if p_full then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', coalesce(public.olnu_friend_name(p.user_id), '?'),
             'answer', p.answer, 'is_me', p.user_id = p_viewer, 'is_creator', p.user_id = i.creator,
             'by', case when p.invited_by is null or p.invited_by = i.creator or p.user_id = i.creator then null
                        else public.olnu_friend_name(p.invited_by) end,
             'at', coalesce(p.answered_at, p.created_at))
           order by (p.user_id = i.creator) desc,
                    case p.answer when 'yes' then 0 when 'maybe' then 1 when 'none' then 2 else 3 end,
                    p.answered_at nulls last, p.created_at), '[]'::jsonb)
      into v_people
      from public.invite_people p where p.invite_id = p_id;
  end if;
  return jsonb_build_object(
    'id', i.id, 'title', i.title, 'kind', i.kind, 'bar_id', i.bar_id, 'place', i.place,
    'lat', i.lat, 'lng', i.lng, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'note', i.note,
    'event_id', i.event_id, 'spot', i.spot, 'status', i.status,
    'group_name', v_gname, 'creator_name', coalesce(public.olnu_friend_name(i.creator), '?'),
    'mine', i.creator = p_viewer, 'my_answer', coalesce(v_me.answer, 'none'),
    'yes', v_yes, 'maybe', v_maybe, 'no', v_no, 'none', v_none, 'n', v_n,
    'reminded', i.reminded_at is not null,
    'live', i.status = 'open' and i.ends_at > now(),
    'can_add', i.status = 'open' and i.ends_at > now() and v_n - 1 < 60 and coalesce(v_me.answer, 'none') <> 'no',
    'people', case when p_full then v_people else null end);
end; $$;

-- ---------------------------------------------------------------------------
-- 👥 friend_list: friends (0045) + group-mates in ONE list
-- ---------------------------------------------------------------------------
create or replace function public.friend_list(p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  with fr as (
    select public.olnu_friend_other(f, v_uid) as uid, f.id as fid, f.via
      from public.friendships f
     where (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
  ), gm as (
    select gm2.user_id as uid, gm.group_id
      from public.group_members gm
      join public.group_members gm2 on gm2.group_id = gm.group_id
     where gm.user_id = v_uid and gm2.user_id <> v_uid
  ), u as (
    select x.uid from (select uid from fr union select uid from gm) x where x.uid is not null and x.uid <> v_uid limit 400
  ), rows as (
    select u.uid,
           (select fr.fid from fr where fr.uid = u.uid limit 1) as fid,
           (select fr.via from fr where fr.uid = u.uid limit 1) as via,
           (select gm.group_id from gm join public.groups g on g.id = gm.group_id where gm.uid = u.uid order by g.name, g.id limit 1) as g1,
           coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                       from gm join public.groups g on g.id = gm.group_id where gm.uid = u.uid), '[]'::jsonb) as groups,
           public.olnu_friend_name(u.uid) as nm,
           po.is_out, po.town
      from u left join lateral public.olnu_friend_out(u.uid) po on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', public.olnu_inv_key(v_uid, r.uid),
           'name', coalesce(r.nm, '?'), 'home_town', public.olnu_home_town(r.uid),
           'out', coalesce(r.is_out, false), 'town', r.town,
           'friend_id', r.fid, 'friend', r.fid is not null, 'via', r.via,
           'groups', r.groups,
           'find_key', case when r.fid is not null then 'f' || r.fid
                            when r.g1 is not null then 'g' || r.g1 || ':' || public.olnu_chief_k(r.g1, r.uid) end,
           'add', case when r.fid is null and r.g1 is not null
                       then jsonb_build_object('g', r.g1, 'k', public.olnu_chief_k(r.g1, r.uid)) end)
         order by coalesce(r.is_out, false) desc, lower(coalesce(r.nm, '~'))), '[]'::jsonb)
    into v from rows r;
  return jsonb_build_object('v', 1, 'people', v,
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
                 'n', (select count(*) from public.group_members m2 where m2.group_id = g.id)) order by g.name)
              from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = v_uid), '[]'::jsonb));
end; $$;

-- ---------------------------------------------------------------------------
-- 📨 RPCs
-- ---------------------------------------------------------------------------
create or replace function public.olnu_inv_resolve(p_uid uuid, p_keys text[], p_group_ids uuid[])
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare
  v uuid[];
  g uuid;
begin
  foreach g in array coalesce(p_group_ids, '{}'::uuid[]) loop
    if not exists (select 1 from public.group_members m where m.group_id = g and m.user_id = p_uid) then
      raise exception 'not_member';
    end if;
  end loop;
  select coalesce(array_agg(distinct x.uid), '{}'::uuid[]) into v from (
    select c.uid from public.olnu_inv_cands(p_uid) c where c.k = any (coalesce(p_keys, '{}'::text[]))
    union
    select m.user_id from public.group_members m where m.group_id = any (coalesce(p_group_ids, '{}'::uuid[])) and m.user_id <> p_uid
  ) x;
  return v;
end; $$;

create or replace function public.invite_create(
  p_title text, p_starts_at timestamptz, p_keys text[] default '{}', p_group_ids uuid[] default '{}',
  p_bar_id text default null, p_place text default null, p_lat double precision default null, p_lng double precision default null,
  p_note text default null, p_kind text default null, p_event_id bigint default null, p_spot text default null,
  p_group_id uuid default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_title text := public.olnu_inv_clean(p_title, 80);
  v_place text := public.olnu_inv_clean(p_place, 60);
  v_note text := public.olnu_inv_clean(p_note, 200);
  v_kind text := lower(coalesce(public.olnu_inv_clean(p_kind, 20), 'beer'));
  v_spot text := lower(coalesce(p_spot, case when p_bar_id is null then 'spot' else 'bar' end));
  v_bar text := public.olnu_inv_clean(p_bar_id, 80);
  v_lat double precision := p_lat; v_lng double precision := p_lng;
  v_start timestamptz := p_starts_at;
  v_to uuid[];
  v_id bigint;
  e public.bar_events;
  v_gid uuid := p_group_id;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  if p_event_id is not null then
    select * into e from public.bar_events x where x.id = p_event_id and x.status = 'ok' and x.expires_at > now();
    if found then
      v_title := coalesce(v_title, left(e.title, 80));
      v_start := coalesce(v_start, e.starts_at);
      v_bar := coalesce(v_bar, e.bar_id); v_place := coalesce(v_place, left(e.place, 60));
      v_lat := coalesce(v_lat, e.lat); v_lng := coalesce(v_lng, e.lng);
      if p_kind is null then v_kind := e.kind; end if;
    end if;
  end if;
  if v_title is null or public.olnu_inv_haslink(v_title) or public.olnu_inv_haslink(v_note) or public.olnu_inv_haslink(v_place) then
    raise exception 'invalid_invite';
  end if;
  if v_start is null or v_start < now() - interval '30 minutes' or v_start > now() + interval '30 days' then
    raise exception 'invalid_invite';
  end if;
  if v_lat is null or v_lng is null or v_lat <> v_lat or v_lng <> v_lng or abs(v_lat) > 85 or abs(v_lng) > 180 then
    raise exception 'invalid_invite';
  end if;
  if v_spot not in ('bar', 'spot', 'here') then v_spot := 'spot'; end if;
  if v_kind !~ '^[a-z_]{2,20}$' then v_kind := 'beer'; end if;
  if v_gid is not null and not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid) then
    v_gid := null;
  end if;
  -- Limits: 1 per 10 s, 30 per 24 h.
  perform pg_advisory_xact_lock(hashtextextended('olnu-inv:' || v_uid::text, 0));
  if exists (select 1 from public.invites x where x.creator = v_uid and x.created_at > now() - interval '10 seconds')
     or (select count(*) from public.invites x where x.creator = v_uid and x.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'slow_down';
  end if;
  v_to := public.olnu_inv_resolve(v_uid, p_keys, p_group_ids);
  if coalesce(array_length(v_to, 1), 0) = 0 then raise exception 'no_invitees'; end if;
  if array_length(v_to, 1) > 60 then raise exception 'too_many'; end if;
  insert into public.invites (creator, title, kind, bar_id, place, lat, lng, starts_at, ends_at, note, event_id, group_id, spot)
  values (v_uid, v_title, v_kind, v_bar, v_place, round(v_lat::numeric, 5)::float8, round(v_lng::numeric, 5)::float8,
          v_start, v_start + interval '6 hours', v_note, p_event_id, v_gid, v_spot)
  returning id into v_id;
  insert into public.invite_people (invite_id, user_id, invited_by, answer, answered_at, notified, yes_pushed)
  values (v_id, v_uid, null, 'yes', now(), true, true);
  insert into public.invite_people (invite_id, user_id, invited_by)
  select v_id, u, v_uid from unnest(v_to) u on conflict do nothing;
  return public.olnu_inv_json(v_id, v_uid, true) || jsonb_build_object('added', array_length(v_to, 1));
end; $$;

create or replace function public.invite_add(p_id bigint, p_keys text[] default '{}', p_group_ids uuid[] default '{}', p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  i public.invites;
  v_to uuid[];
  v_n int;
  v_added int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  select * into i from public.invites x where x.id = p_id
     and exists (select 1 from public.invite_people p where p.invite_id = x.id and p.user_id = v_uid)
   for update;
  if not found then raise exception 'invite_not_found'; end if;
  if i.status <> 'open' or i.ends_at <= now() then raise exception 'invite_over'; end if;
  v_to := public.olnu_inv_resolve(v_uid, p_keys, p_group_ids);
  select count(*) into v_n from public.invite_people p where p.invite_id = p_id and p.user_id <> i.creator;
  select count(*) into v_added from unnest(v_to) u
   where not exists (select 1 from public.invite_people p where p.invite_id = p_id and p.user_id = u);
  if v_added = 0 then raise exception 'no_invitees'; end if;
  if v_n + v_added > 60 then raise exception 'too_many'; end if;
  insert into public.invite_people (invite_id, user_id, invited_by)
  select p_id, u, v_uid from unnest(v_to) u on conflict do nothing;
  update public.invites set updated_at = now() where id = p_id;
  return public.olnu_inv_json(p_id, v_uid, true) || jsonb_build_object('added', v_added);
end; $$;

create or replace function public.invite_answer(p_id bigint, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(coalesce(p_answer, ''));
  v_old text;
  i public.invites;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_a not in ('yes', 'maybe', 'no') then raise exception 'invalid_answer'; end if;
  select * into i from public.invites x where x.id = p_id;
  select p.answer into v_old from public.invite_people p where p.invite_id = p_id and p.user_id = v_uid;
  if i.id is null or v_old is null then raise exception 'invite_not_found'; end if;
  if i.status <> 'open' or i.ends_at <= now() then raise exception 'invite_over'; end if;
  update public.invite_people p set answer = v_a, answered_at = now(),
         yes_pushed = case when v_a = 'yes' and v_old <> 'yes' then false else p.yes_pushed end
   where p.invite_id = p_id and p.user_id = v_uid;
  update public.invites set updated_at = now() where id = p_id;
  return public.olnu_inv_json(p_id, v_uid, true)
    || jsonb_build_object('push_yes', v_a = 'yes' and v_old <> 'yes' and v_uid <> i.creator);
end; $$;

create or replace function public.invite_get(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.invite_people p where p.invite_id = p_id and p.user_id = v_uid) then
    raise exception 'invite_not_found';
  end if;
  return public.olnu_inv_json(p_id, v_uid, true);
end; $$;

create or replace function public.invite_cancel(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.invites set status = 'cancelled', updated_at = now()
   where id = p_id and creator = v_uid and status = 'open';
  if not found then raise exception 'invite_not_found'; end if;
  return public.olnu_inv_json(p_id, v_uid, true);
end; $$;

-- Everything I am in that is not over: lite rows, by start time (max 30). Cancelled ones stay 12 h (so the
-- app can say so), then disappear.
create or replace function public.my_invites()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('v', 1, 'now', now(), 'invites', coalesce((
    select jsonb_agg(public.olnu_inv_json(x.id, v_uid, false) order by x.starts_at)
      from (select i.id, i.starts_at from public.invites i
              join public.invite_people p on p.invite_id = i.id and p.user_id = v_uid
             where i.ends_at > now() and (i.status = 'open' or i.updated_at > now() - interval '12 hours')
             order by i.starts_at limit 30) x), '[]'::jsonb));
end; $$;

-- ---------------------------------------------------------------------------
-- Grants: helpers nobody, RPCs authenticated only
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_inv_key(uuid, uuid), public.olnu_inv_cands(uuid), public.olnu_inv_clean(text, int), '
    || 'public.olnu_inv_haslink(text), public.olnu_inv_json(bigint, uuid, boolean), public.olnu_inv_resolve(uuid, text[], uuid[])';
  v_rpcs text := 'public.friend_list(text), '
    || 'public.invite_create(text, timestamptz, text[], uuid[], text, text, double precision, double precision, text, text, bigint, text, uuid, text), '
    || 'public.invite_add(bigint, text[], uuid[], text), public.invite_answer(bigint, text), public.invite_get(bigint), '
    || 'public.invite_cancel(bigint), public.my_invites()';
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
