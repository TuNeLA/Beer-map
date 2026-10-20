-- 0047 HITTA KOMPISEN (compass to a friend / group member in a crowded bar). Client: docs/js/near.js.
-- Needs 0045 (friendships) and 0030 (olnu_chief_k). Both people must opt in:
--   * a request (find_request) that the other person accepts (find_answer) → 30 min, both ways, or
--   * the other person's switch "Låt gruppen/vännerna hitta mig" (set_find_share) → until 05:00 or off, or
--   * the other person has the finder open towards the caller right now.
-- Exact live positions live in find_pos: ONE row per user, overwritten on every ping (no history), sent only
-- while the finder screen is open (client: every 6 s), visible for 2 min (expires_at), cleared by find_stop().
-- Target keys: "f<friendship id>" (accepted friend) or "g<group uuid>:<member k>" (0030 olnu_chief_k).
-- Rows are never removed. RLS on, no policies. RPCs: SECURITY DEFINER, olnu_uid(), authenticated only.
-- "Radera allt om mig" (uuid sweep): triggers end shares, positions and requests of the moved id.
-- Safe to run again.

create table if not exists public.find_share (
  user_id    uuid primary key,
  groups     boolean not null default false,
  friends    boolean not null default false,
  until      timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.find_pos (
  user_id    uuid primary key,
  lat        float8 null,
  lng        float8 null,
  acc        int null,
  target_uid uuid null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now()
);
create table if not exists public.find_reqs (
  id            bigserial primary key,
  from_uid      uuid not null,
  to_uid        uuid not null,
  group_id      uuid null,
  friendship_id bigint null,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'auto')),
  created_at    timestamptz not null default now(),
  answer_by     timestamptz not null default now() + interval '5 minutes',
  answered_at   timestamptz null,
  until         timestamptz null,
  notified      boolean not null default false
);
create index if not exists find_reqs_to on public.find_reqs (to_uid, created_at desc);
create index if not exists find_reqs_from on public.find_reqs (from_uid, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['find_share', 'find_pos', 'find_reqs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on table public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on table public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table public.%I to service_role', t); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage, select on sequence public.find_reqs_id_seq to service_role';
  end if;
end $$;

-- Erase guards
create or replace function public.olnu_find_anon_tg()
returns trigger language plpgsql set search_path = public as $$
begin
  begin
    if tg_table_name = 'find_share' and new.user_id is distinct from old.user_id then
      new.groups := false; new.friends := false; new.until := least(new.until, now());
    elsif tg_table_name = 'find_pos' and new.user_id is distinct from old.user_id then
      new.lat := null; new.lng := null; new.acc := null; new.target_uid := null; new.expires_at := least(new.expires_at, now());
    elsif tg_table_name = 'find_pos' and new.target_uid is distinct from old.target_uid and new.updated_at = old.updated_at then
      new.target_uid := null; new.lat := null; new.lng := null; new.expires_at := least(new.expires_at, now());
    elsif tg_table_name = 'find_reqs' and (new.from_uid is distinct from old.from_uid or new.to_uid is distinct from old.to_uid) then
      if new.status in ('pending', 'accepted', 'auto') then new.status := 'cancelled'; new.until := least(coalesce(new.until, now()), now()); end if;
    end if;
  exception when others then null;
  end;
  return new;
end; $$;
create or replace trigger find_share_anon before update of user_id on public.find_share
  for each row execute function public.olnu_find_anon_tg();
create or replace trigger find_pos_anon before update of user_id, target_uid on public.find_pos
  for each row execute function public.olnu_find_anon_tg();
create or replace trigger find_reqs_anon before update of from_uid, to_uid on public.find_reqs
  for each row execute function public.olnu_find_anon_tg();

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_share_group(p_x uuid, p_y uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
                  where a.user_id = p_x and b.user_id = p_y);
$$;

-- Resolve a target key for the caller. Raises invalid_target.
create or replace function public.olnu_find_resolve(p_key text, p_uid uuid)
returns table (uid uuid, group_id uuid, friendship_id bigint, name text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_gid uuid; v_k text; f public.friendships;
begin
  if v_key ~ '^f[0-9]{1,18}$' then
    select * into f from public.friendships x where x.id = substr(v_key, 2)::bigint and x.status = 'accepted' and (x.a = p_uid or x.b = p_uid);
    if f.id is null then raise exception 'invalid_target'; end if;
    uid := public.olnu_friend_other(f, p_uid); group_id := null; friendship_id := f.id; name := public.olnu_friend_name(uid);
    return next; return;
  elsif v_key ~ '^g[0-9a-fA-F-]{36}:[0-9a-f]{12}$' then
    v_gid := substr(v_key, 2, 36)::uuid; v_k := substr(v_key, 39);
    if not exists (select 1 from public.group_members gm where gm.group_id = v_gid and gm.user_id = p_uid) then raise exception 'invalid_target'; end if;
    select gm.user_id, gm.display_name into uid, name from public.group_members gm
     where gm.group_id = v_gid and public.olnu_chief_k(v_gid, gm.user_id) = v_k;
    if uid is null or uid = p_uid then raise exception 'invalid_target'; end if;
    group_id := v_gid; friendship_id := null;
    return next; return;
  end if;
  raise exception 'invalid_target';
end; $$;

-- The other person of a request, as a target key + name, from the viewer's side.
create or replace function public.olnu_find_key(r public.find_reqs, p_viewer uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when r.group_id is not null
              then 'g' || r.group_id::text || ':' || public.olnu_chief_k(r.group_id, case when r.from_uid = p_viewer then r.to_uid else r.from_uid end)
              else 'f' || r.friendship_id::text end;
$$;
create or replace function public.olnu_find_name(r public.find_reqs, p_viewer uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when r.group_id is not null
              then (select gm.display_name from public.group_members gm where gm.group_id = r.group_id
                       and gm.user_id = case when r.from_uid = p_viewer then r.to_uid else r.from_uid end)
              else public.olnu_friend_name(case when r.from_uid = p_viewer then r.to_uid else r.from_uid end) end;
$$;

-- Does the target share its live position with the viewer right now?
create or replace function public.olnu_find_allowed(p_viewer uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.find_reqs r
                  where ((r.from_uid = p_viewer and r.to_uid = p_target) or (r.from_uid = p_target and r.to_uid = p_viewer))
                    and r.status = 'accepted' and r.until > now())
      or exists (select 1 from public.find_share s
                  where s.user_id = p_target and s.until > now()
                    and ((s.friends and public.olnu_are_friends(p_viewer, p_target))
                      or (s.groups and public.olnu_share_group(p_viewer, p_target))))
      or exists (select 1 from public.find_pos fp
                  where fp.user_id = p_target and fp.target_uid = p_viewer and fp.expires_at > now() and fp.lat is not null);
$$;

-- Is there a live request between the two (either way)?
create or replace function public.olnu_find_live(p_x uuid, p_y uuid)
returns public.find_reqs language sql stable security definer set search_path = public as $$
  select r.* from public.find_reqs r
   where ((r.from_uid = p_x and r.to_uid = p_y) or (r.from_uid = p_y and r.to_uid = p_x))
     and ((r.status = 'pending' and r.answer_by > now()) or (r.status in ('accepted', 'auto') and r.until > now()))
   order by r.created_at desc limit 1;
$$;

create or replace function public.olnu_find_req_json(r public.find_reqs, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'key', public.olnu_find_key(r, p_viewer), 'name', public.olnu_find_name(r, p_viewer),
    'group_name', (select g.name from public.groups g where g.id = r.group_id),
    'status', case when r.status = 'pending' and r.answer_by <= now() then 'expired'
                   when r.status in ('accepted', 'auto') and r.until <= now() then 'ended' else r.status end,
    'at', r.created_at, 'answer_by', r.answer_by, 'until', r.until, 'mine', r.from_uid = p_viewer,
    'finding', exists (select 1 from public.find_pos fp where fp.user_id = case when r.from_uid = p_viewer then r.to_uid else r.from_uid end
                        and fp.target_uid = p_viewer and fp.expires_at > now() and fp.lat is not null));
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- set_find_share(p_groups bool, p_friends bool) -> jsonb {groups, friends, until}. On until the next 05:00.
create or replace function public.set_find_share(p_groups boolean, p_friends boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_on boolean := coalesce(p_groups, false) or coalesce(p_friends, false);
  s public.find_share;
begin
  insert into public.find_share (user_id, groups, friends, until, updated_at)
  values (v_uid, coalesce(p_groups, false), coalesce(p_friends, false), case when v_on then public.olnu_next_expiry() else now() end, now())
  on conflict (user_id) do update set groups = excluded.groups, friends = excluded.friends, until = excluded.until, updated_at = now()
  returning * into s;
  return jsonb_build_object('groups', s.groups and s.until > now(), 'friends', s.friends and s.until > now(),
    'until', case when s.until > now() then s.until end);
end; $$;

-- find_request(p_key, p_name default null) -> jsonb request json (+ auto bool, allowed bool).
-- Target's switch covers the caller → status 'auto' (no answer needed). A pending request from the target
-- is accepted. Errors: invalid_target, slow_down (1 per 15 s, 60 per night).
create or replace function public.find_request(p_key text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  t record; r public.find_reqs; v_auto boolean; v_end timestamptz := public.olnu_next_expiry();
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select * into t from public.olnu_find_resolve(p_key, v_uid);
  perform pg_advisory_xact_lock(hashtextextended('olnu_find:' || least(v_uid, t.uid)::text || greatest(v_uid, t.uid)::text, 0));
  r := public.olnu_find_live(v_uid, t.uid);
  if r.id is not null and r.status = 'pending' and r.to_uid = v_uid then
    update public.find_reqs x set status = 'accepted', answered_at = now(), until = least(now() + interval '30 minutes', v_end)
     where x.id = r.id returning * into r;
    return public.olnu_find_req_json(r, v_uid) || jsonb_build_object('auto', false, 'allowed', true);
  end if;
  if r.id is not null then
    return public.olnu_find_req_json(r, v_uid) || jsonb_build_object('auto', r.status = 'auto', 'allowed', public.olnu_find_allowed(v_uid, t.uid));
  end if;
  if exists (select 1 from public.find_reqs x where x.from_uid = v_uid and x.created_at > now() - interval '15 seconds')
     or (select count(*) from public.find_reqs x where x.from_uid = v_uid and x.created_at > now() - interval '12 hours') >= 60 then
    raise exception 'slow_down';
  end if;
  v_auto := exists (select 1 from public.find_share s where s.user_id = t.uid and s.until > now()
                     and ((s.friends and public.olnu_are_friends(v_uid, t.uid)) or (s.groups and public.olnu_share_group(v_uid, t.uid))));
  insert into public.find_reqs (from_uid, to_uid, group_id, friendship_id, status, until, answered_at)
  values (v_uid, t.uid, t.group_id, t.friendship_id, case when v_auto then 'auto' else 'pending' end,
          case when v_auto then least(now() + interval '30 minutes', v_end) end, case when v_auto then now() end)
  returning * into r;
  return public.olnu_find_req_json(r, v_uid) || jsonb_build_object('auto', v_auto, 'allowed', public.olnu_find_allowed(v_uid, t.uid));
end; $$;

-- find_answer(p_id, p_accept) -> request json. Errors: find_req_not_found (not to me, not pending, too late).
create or replace function public.find_answer(p_id bigint, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r public.find_reqs;
begin
  select * into r from public.find_reqs x where x.id = p_id and x.to_uid = v_uid for update;
  if r.id is null or r.status <> 'pending' or r.answer_by <= now() then raise exception 'find_req_not_found'; end if;
  if coalesce(p_accept, false) then
    update public.find_reqs x set status = 'accepted', answered_at = now(),
           until = least(now() + interval '30 minutes', public.olnu_next_expiry())
     where x.id = r.id returning * into r;
  else
    update public.find_reqs x set status = 'declined', answered_at = now() where x.id = r.id returning * into r;
  end if;
  return public.olnu_find_req_json(r, v_uid);
end; $$;

-- find_cancel(p_id) -> {ok}. Either person ends a request / session. Errors: find_req_not_found.
create or replace function public.find_cancel(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r public.find_reqs;
begin
  select * into r from public.find_reqs x where x.id = p_id and (x.from_uid = v_uid or x.to_uid = v_uid) for update;
  if r.id is null then raise exception 'find_req_not_found'; end if;
  if r.status in ('pending', 'accepted', 'auto') then
    update public.find_reqs x set status = 'cancelled', until = least(coalesce(x.until, now()), now()), answered_at = coalesce(x.answered_at, now())
     where x.id = r.id;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- find_ping(p_key, p_lat, p_lng, p_acc default null) -> jsonb {ok, name, allowed, status, req_id, until,
--   target:{lat, lng, acc, age_s}|null, finding_me}. Writes the caller's exact position (5 decimals, 2 min)
-- only when a request exists or the target shares with the caller. Writes at most every 3 s.
-- Errors: invalid_target, outside_sweden (= invalid coordinates), no_find (no request, no share).
create or replace function public.find_ping(p_key text, p_lat float8, p_lng float8, p_acc float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  t record; r public.find_reqs; fp public.find_pos; me public.find_pos; v_allowed boolean;
begin
  select * into t from public.olnu_find_resolve(p_key, v_uid);
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  r := public.olnu_find_live(v_uid, t.uid);
  v_allowed := public.olnu_find_allowed(v_uid, t.uid);
  if r.id is null and not v_allowed then raise exception 'no_find'; end if;
  select * into me from public.find_pos x where x.user_id = v_uid;
  if me.user_id is null then
    insert into public.find_pos (user_id, lat, lng, acc, target_uid, updated_at, expires_at)
    values (v_uid, round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8,
            case when p_acc is null or p_acc = 'NaN'::float8 then null else least(5000, greatest(0, round(p_acc)))::int end,
            t.uid, now(), now() + interval '2 minutes');
  elsif me.updated_at < now() - interval '3 seconds' or me.target_uid is distinct from t.uid or me.lat is null then
    update public.find_pos x
       set lat = round(p_lat::numeric, 5)::float8, lng = round(p_lng::numeric, 5)::float8,
           acc = case when p_acc is null or p_acc = 'NaN'::float8 then null else least(5000, greatest(0, round(p_acc)))::int end,
           target_uid = t.uid, updated_at = now(), expires_at = now() + interval '2 minutes'
     where x.user_id = v_uid;
  end if;
  if v_allowed then
    select * into fp from public.find_pos x where x.user_id = t.uid and x.expires_at > now() and x.lat is not null;
  end if;
  return jsonb_build_object('ok', true, 'name', t.name, 'allowed', v_allowed,
    'status', case when r.id is null then 'share' else r.status end, 'req_id', r.id, 'until', r.until,
    'answer_by', r.answer_by,
    'target', case when fp.user_id is not null then jsonb_build_object('lat', fp.lat, 'lng', fp.lng, 'acc', fp.acc,
                'age_s', greatest(0, extract(epoch from now() - fp.updated_at))::int) end,
    'finding_me', fp.user_id is not null and fp.target_uid = v_uid);
end; $$;

-- find_stop() -> {ok}. Closes the finder: the caller's position is cleared at once.
create or replace function public.find_stop()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  update public.find_pos x set lat = null, lng = null, acc = null, target_uid = null, updated_at = now(), expires_at = now()
   where x.user_id = v_uid;
  return jsonb_build_object('ok', true);
end; $$;

-- near_poll(p_name default null) -> jsonb {v, server_time, share:{groups, friends, until},
--   find_in:[request json] (to me, live or answered in the last 10 min), find_out:[request json],
--   friends_in:[{id, name, home_town, at}] (pending friend requests to me, max 10),
--   squads:[gathering json + nights] (0046 squad_poll, runs the gathering check)}.
create or replace function public.near_poll(p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  s public.find_share; v_in jsonb; v_out jsonb; v_fr jsonb; v_sq jsonb;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select * into s from public.find_share x where x.user_id = v_uid;
  select coalesce(jsonb_agg(public.olnu_find_req_json(r, v_uid) order by r.created_at desc), '[]'::jsonb) into v_in
    from (select * from public.find_reqs x where x.to_uid = v_uid
             and (x.answer_by > now() - interval '10 minutes' or x.until > now()) order by x.created_at desc limit 10) r;
  select coalesce(jsonb_agg(public.olnu_find_req_json(r, v_uid) order by r.created_at desc), '[]'::jsonb) into v_out
    from (select * from public.find_reqs x where x.from_uid = v_uid
             and (x.answer_by > now() - interval '10 minutes' or x.until > now()) order by x.created_at desc limit 10) r;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', public.olnu_friend_name(f.requester),
           'home_town', public.olnu_home_town(f.requester), 'at', f.updated_at) order by f.updated_at desc), '[]'::jsonb) into v_fr
    from (select * from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'pending' and x.requester <> v_uid
           order by x.updated_at desc limit 10) f;
  begin
    v_sq := public.squad_poll() -> 'squads';
  exception when others then v_sq := '[]'::jsonb;
  end;
  return jsonb_build_object('v', 1, 'server_time', now(),
    'share', jsonb_build_object('groups', coalesce(s.groups and s.until > now(), false), 'friends', coalesce(s.friends and s.until > now(), false),
                                'until', case when s.until > now() then s.until end),
    'find_in', v_in, 'find_out', v_out, 'friends_in', v_fr, 'squads', coalesce(v_sq, '[]'::jsonb));
end; $$;

-- ---------------------------------------------------------------------------
-- Grants: helpers nobody, RPCs authenticated only
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_find_anon_tg(), public.olnu_share_group(uuid, uuid), public.olnu_find_resolve(text, uuid), '
    || 'public.olnu_find_key(public.find_reqs, uuid), public.olnu_find_name(public.find_reqs, uuid), '
    || 'public.olnu_find_allowed(uuid, uuid), public.olnu_find_live(uuid, uuid), public.olnu_find_req_json(public.find_reqs, uuid)';
  v_rpcs text := 'public.set_find_share(boolean, boolean), public.find_request(text, text), public.find_answer(bigint, boolean), '
    || 'public.find_cancel(bigint), public.find_ping(text, double precision, double precision, double precision), '
    || 'public.find_stop(), public.near_poll(text)';
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
