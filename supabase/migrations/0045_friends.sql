-- 0045 VÄNNER (friends one-to-one, outside groups). Client: docs/js/near.js (window.NEAR) + docs/near.css.
-- A user adds a friend with a friend code / QR (?friend=CODE) or by tapping a member of a shared group.
-- The other person must accept. Friend list: name, home town (0033), out tonight (+ town only, never a place).
-- Rows are never removed: a friendship ends with status 'removed' / 'declined' / 'cancelled' (UPDATE).
-- RLS on, no policies. All RPCs: SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only.
-- "Radera allt om mig" (0016c sweep moves every uuid column): triggers below end the friendship, clear the name
-- and give the friend code a new value, so nothing points to the erased person any more.
-- Safe to run again.

create table if not exists public.friend_codes (
  user_id    uuid primary key,
  code       text not null unique,
  created_at timestamptz not null default now(),
  changes    int not null default 0
);
create table if not exists public.user_names (
  user_id    uuid primary key,
  name       text null,
  updated_at timestamptz not null default now()
);
create table if not exists public.friendships (
  id          bigserial primary key,
  a           uuid not null,
  b           uuid not null,
  requester   uuid not null,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'removed', 'cancelled')),
  via         text not null default 'code' check (via in ('code', 'group')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  accepted_at timestamptz null,
  ended_by    uuid null,
  notified    boolean not null default false
);
create unique index if not exists friendships_pair on public.friendships (least(a, b), greatest(a, b));
create index if not exists friendships_a on public.friendships (a, status);
create index if not exists friendships_b on public.friendships (b, status);

do $$
declare t text;
begin
  foreach t in array array['friend_codes', 'user_names', 'friendships'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on table public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on table public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table public.%I to service_role', t); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage, select on sequence public.friendships_id_seq to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Erase guards (0016c sweep changes user ids with UPDATE)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_friend_anon_tg()
returns trigger language plpgsql set search_path = public as $$
begin
  begin
    if new.a is distinct from old.a or new.b is distinct from old.b then
      if new.status in ('pending', 'accepted') then
        new.status := 'removed'; new.updated_at := now();
      end if;
    end if;
  exception when others then null;
  end;
  return new;
end; $$;
create or replace trigger friendships_anon before update of a, b on public.friendships
  for each row execute function public.olnu_friend_anon_tg();

create or replace function public.olnu_uname_anon_tg()
returns trigger language plpgsql set search_path = public as $$
begin
  begin
    if new.user_id is distinct from old.user_id then new.name := null; end if;
  exception when others then null;
  end;
  return new;
end; $$;
create or replace trigger user_names_anon before update of user_id on public.user_names
  for each row execute function public.olnu_uname_anon_tg();

create or replace function public.olnu_fcode_anon_tg()
returns trigger language plpgsql set search_path = public as $$
begin
  begin
    if new.user_id is distinct from old.user_id then
      new.code := 'X' || substr(md5(random()::text || clock_timestamp()::text), 1, 15);
    end if;
  exception when others then null;
  end;
  return new;
end; $$;
create or replace trigger friend_codes_anon before update of user_id on public.friend_codes
  for each row execute function public.olnu_fcode_anon_tg();

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
-- Friend code: 7 chars (group codes have 6, duel tokens 8), same alphabet as group codes.
create or replace function public.olnu_friend_newcode()
returns text language plpgsql volatile set search_path = public as $$
declare
  v_abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v text; i int; n int := 0;
begin
  loop
    v := '';
    for i in 1..7 loop v := v || substr(v_abc, 1 + floor(random() * 32)::int, 1); end loop;
    exit when not exists (select 1 from public.friend_codes c where c.code = v);
    n := n + 1;
    if n > 20 then raise exception 'code_generation_failed'; end if;
  end loop;
  return v;
end; $$;

-- Remember the caller's own display name (sent by the client with friend calls). Bad names are ignored.
create or replace function public.olnu_friend_setname(p_uid uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := btrim(regexp_replace(coalesce(p_name, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
begin
  if char_length(v) < 1 or char_length(v) > 30 then return; end if;
  insert into public.user_names (user_id, name, updated_at) values (p_uid, v, now())
    on conflict (user_id) do update set name = excluded.name, updated_at = now()
    where public.user_names.name is distinct from excluded.name;
end; $$;

-- Name shown to friends: own friend name, else the smallest group display name, else null.
create or replace function public.olnu_friend_name(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select n.name from public.user_names n where n.user_id = p_uid),
                  (select min(gm.display_name) from public.group_members gm where gm.user_id = p_uid));
$$;

-- Out tonight (crew presence rule 0027: live check-in < 3 h or live visible pin, newer than Hej då / home).
-- Returns the town only (never a bar or a point).
create or replace function public.olnu_friend_out(p_uid uuid)
returns table (is_out boolean, town text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_night timestamptz := public.olnu_night_of(now());
  p record; v_bye timestamptz; v_home timestamptz;
begin
  select * into p from public.olnu_crew_pres(p_uid);
  if p.at is null then is_out := false; town := null; return next; return; end if;
  begin
    select y.at into v_bye from public.crew_byes y where y.user_id = p_uid and y.night = v_night and y.cleared_at is null;
  exception when others then v_bye := null; end;
  begin
    select an.home_at into v_home from public.after_nights an where an.user_id = p_uid and an.night = v_night;
  exception when others then v_home := null; end;
  is_out := (v_bye is null or p.at > v_bye) and (v_home is null or p.at > v_home);
  town := case when is_out then public.olnu_town_of(coalesce(p.bar_lat, p.lat), coalesce(p.bar_lng, p.lng)) end;
  return next;
end; $$;

create or replace function public.olnu_friend_other(f public.friendships, p_uid uuid)
returns uuid language sql immutable set search_path = public as $$
  select case when f.a = p_uid then f.b else f.a end;
$$;

create or replace function public.olnu_are_friends(p_x uuid, p_y uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships f
                  where least(f.a, f.b) = least(p_x, p_y) and greatest(f.a, f.b) = greatest(p_x, p_y)
                    and f.status = 'accepted');
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- my_friend_code(p_new bool default false, p_name text default null) -> jsonb {code}
-- p_new = a fresh code (old code stops working). Errors: slow_down (10 new codes per day).
create or replace function public.my_friend_code(p_new boolean default false, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  c public.friend_codes;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  perform pg_advisory_xact_lock(hashtextextended('olnu_fcode:' || v_uid::text, 0));
  select * into c from public.friend_codes x where x.user_id = v_uid;
  if not found then
    insert into public.friend_codes (user_id, code) values (v_uid, public.olnu_friend_newcode()) returning * into c;
  elsif coalesce(p_new, false) then
    if c.changes >= 10 and c.created_at > now() - interval '1 day' then raise exception 'slow_down'; end if;
    update public.friend_codes x
       set code = public.olnu_friend_newcode(),
           changes = case when x.created_at > now() - interval '1 day' then x.changes + 1 else 1 end,
           created_at = now()
     where x.user_id = v_uid returning * into c;
  end if;
  return jsonb_build_object('code', c.code);
end; $$;

-- friend_code_info(p_code) -> jsonb {name, home_town, mine, state} (state: none | pending_out | pending_in | accepted)
-- Errors: friend_not_found.
create or replace function public.friend_code_info(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_t uuid; f public.friendships;
begin
  select c.user_id into v_t from public.friend_codes c where c.code = v_code;
  if v_t is null then raise exception 'friend_not_found'; end if;
  select * into f from public.friendships x
   where least(x.a, x.b) = least(v_uid, v_t) and greatest(x.a, x.b) = greatest(v_uid, v_t);
  return jsonb_build_object('name', public.olnu_friend_name(v_t), 'home_town', public.olnu_home_town(v_t),
    'mine', v_t = v_uid,
    'state', case when f.id is null or f.status not in ('pending', 'accepted') then 'none'
                  when f.status = 'accepted' then 'accepted'
                  when f.requester = v_uid then 'pending_out' else 'pending_in' end);
end; $$;

-- friend_request(p_code default null, p_group_id default null, p_k default null, p_name default null)
--   -> jsonb {id, status, name, already, auto}
-- Target = the owner of a friend code, or member k (0030 olnu_chief_k / group_status_v2.k) of a shared group.
-- A pending request from the target is accepted at once (auto). Errors: friend_not_found, own_code,
-- not_member, invalid_member, slow_down (30 new requests per hour), friend_limit (300 friends).
create or replace function public.friend_request(p_code text default null, p_group_id uuid default null,
                                                 p_k text default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_t uuid; v_via text := 'code';
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  f public.friendships;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  if p_group_id is not null then
    v_via := 'group';
    if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    select gm.user_id into v_t from public.group_members gm
     where gm.group_id = p_group_id
       and (public.olnu_chief_k(p_group_id, gm.user_id) = btrim(coalesce(p_k, '')));
    if v_t is null then raise exception 'invalid_member'; end if;
  else
    select c.user_id into v_t from public.friend_codes c where c.code = v_code;
    if v_t is null then raise exception 'friend_not_found'; end if;
  end if;
  if v_t = v_uid then raise exception 'own_code'; end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_friend:' || least(v_uid, v_t)::text || greatest(v_uid, v_t)::text, 0));
  select * into f from public.friendships x
   where least(x.a, x.b) = least(v_uid, v_t) and greatest(x.a, x.b) = greatest(v_uid, v_t);

  if f.id is not null and f.status = 'accepted' then
    return jsonb_build_object('id', f.id, 'status', 'accepted', 'name', public.olnu_friend_name(v_t), 'already', true, 'auto', false);
  end if;
  if f.id is not null and f.status = 'pending' and f.requester = v_uid then
    return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', true, 'auto', false);
  end if;
  if (select count(*) from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'accepted') >= 300 then
    raise exception 'friend_limit';
  end if;
  if f.id is not null and f.status = 'pending' then
    -- They asked me first: accept.
    update public.friendships x set status = 'accepted', accepted_at = now(), updated_at = now()
     where x.id = f.id returning * into f;
    return jsonb_build_object('id', f.id, 'status', 'accepted', 'name', public.olnu_friend_name(v_t), 'already', false, 'auto', true);
  end if;
  -- A request the target declined in the last 24 h: say "pending" again, change nothing (no spam, no "declined" leak).
  if f.id is not null and f.status = 'declined' and f.requester = v_uid and f.updated_at > now() - interval '24 hours' then
    return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', true, 'auto', false);
  end if;
  if (select count(*) from public.friendships x where x.requester = v_uid and x.updated_at > now() - interval '1 hour'
        and x.status in ('pending', 'cancelled', 'declined')) >= 30 then
    raise exception 'slow_down';
  end if;
  if f.id is not null then
    update public.friendships x set status = 'pending', requester = v_uid, via = v_via, updated_at = now(),
           accepted_at = null, ended_by = null, notified = false
     where x.id = f.id returning * into f;
  else
    insert into public.friendships (a, b, requester, status, via)
    values (least(v_uid, v_t), greatest(v_uid, v_t), v_uid, 'pending', v_via) returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', false, 'auto', false);
end; $$;

-- friend_answer(p_id, p_accept bool, p_name default null) -> jsonb {id, status, name}
-- Errors: friend_req_not_found (not pending, or the caller sent it), friend_limit.
create or replace function public.friend_answer(p_id bigint, p_accept boolean, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  f public.friendships;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select * into f from public.friendships x where x.id = p_id and (x.a = v_uid or x.b = v_uid) for update;
  if f.id is null or f.status <> 'pending' or f.requester = v_uid then raise exception 'friend_req_not_found'; end if;
  if coalesce(p_accept, false) then
    if (select count(*) from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'accepted') >= 300 then
      raise exception 'friend_limit';
    end if;
    update public.friendships x set status = 'accepted', accepted_at = now(), updated_at = now() where x.id = f.id returning * into f;
  else
    update public.friendships x set status = 'declined', updated_at = now(), ended_by = v_uid where x.id = f.id returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', f.status, 'name', public.olnu_friend_name(public.olnu_friend_other(f, v_uid)));
end; $$;

-- friend_remove(p_id) -> jsonb {id, status}. Accepted → removed; own pending request → cancelled;
-- their pending request → declined. Ending twice is fine. Errors: friend_req_not_found.
create or replace function public.friend_remove(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  f public.friendships;
begin
  select * into f from public.friendships x where x.id = p_id and (x.a = v_uid or x.b = v_uid) for update;
  if f.id is null then raise exception 'friend_req_not_found'; end if;
  if f.status = 'accepted' then
    update public.friendships x set status = 'removed', updated_at = now(), ended_by = v_uid where x.id = f.id returning * into f;
  elsif f.status = 'pending' and f.requester = v_uid then
    update public.friendships x set status = 'cancelled', updated_at = now(), ended_by = v_uid where x.id = f.id returning * into f;
  elsif f.status = 'pending' then
    update public.friendships x set status = 'declined', updated_at = now(), ended_by = v_uid where x.id = f.id returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', f.status);
end; $$;

-- my_friends(p_name default null) -> jsonb {code, friends:[{id, key, name, home_town, out, town, since, via}],
--   incoming:[{id, name, home_town, at, via}], outgoing:[{id, name, at}]}. key = "f<id>" (finder target key).
create or replace function public.my_friends(p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_fr jsonb; v_in jsonb; v_out jsonb;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select coalesce(jsonb_agg(x.j order by x.is_out desc, lower(coalesce(x.nm, '~'))), '[]'::jsonb) into v_fr from (
    select jsonb_build_object('id', f.id, 'key', 'f' || f.id, 'name', public.olnu_friend_name(o.uid),
             'home_town', public.olnu_home_town(o.uid), 'out', coalesce(po.is_out, false), 'town', po.town,
             'since', f.accepted_at, 'via', f.via) as j,
           coalesce(po.is_out, false) as is_out, public.olnu_friend_name(o.uid) as nm
      from public.friendships f
      cross join lateral (select public.olnu_friend_other(f, v_uid) as uid) o
      left join lateral public.olnu_friend_out(o.uid) po on true
     where (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
     limit 300) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', public.olnu_friend_name(f.requester),
           'home_town', public.olnu_home_town(f.requester), 'at', f.updated_at, 'via', f.via) order by f.updated_at desc), '[]'::jsonb)
    into v_in
    from public.friendships f
   where (f.a = v_uid or f.b = v_uid) and f.status = 'pending' and f.requester <> v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', public.olnu_friend_name(public.olnu_friend_other(f, v_uid)),
           'at', f.updated_at) order by f.updated_at desc), '[]'::jsonb)
    into v_out
    from public.friendships f
   where (f.a = v_uid or f.b = v_uid) and f.status = 'pending' and f.requester = v_uid;
  return jsonb_build_object('code', (select c.code from public.friend_codes c where c.user_id = v_uid),
    'friends', v_fr, 'incoming', v_in, 'outgoing', v_out);
end; $$;

-- ---------------------------------------------------------------------------
-- Grants: helpers nobody, RPCs authenticated only
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_friend_newcode(), public.olnu_friend_setname(uuid, text), public.olnu_friend_name(uuid), '
    || 'public.olnu_friend_out(uuid), public.olnu_friend_other(public.friendships, uuid), public.olnu_are_friends(uuid, uuid), '
    || 'public.olnu_friend_anon_tg(), public.olnu_uname_anon_tg(), public.olnu_fcode_anon_tg()';
  v_rpcs text := 'public.my_friend_code(boolean, text), public.friend_code_info(text), '
    || 'public.friend_request(text, uuid, text, text), public.friend_answer(bigint, boolean, text), '
    || 'public.friend_remove(bigint), public.my_friends(text)';
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
