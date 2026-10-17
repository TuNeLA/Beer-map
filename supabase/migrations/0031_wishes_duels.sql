-- 0031 v23 ÖNSKELISTAN + GRUPPDUELLEN. Client: docs/js/wish.js (window.WISH), docs/js/duel.js + docs/duel.css (window.DUEL).
-- 1 Önska en feature: free text wishes (max 500 chars, optional category), +1 votes ("Jag vill också"),
--   owner list on docs/stats.html (owner_wishes with the owner key) and the view owner_wishes_v for the SQL editor.
-- 2 Gruppduellen: group vs group, who drinks the most tonight (plain total of drinks since the duel started).
--   Main way in: a member shows a QR code (duel_invite -> token, link ./?duel=TOKEN); a member of another group
--   scans it and taps once (duel_accept_token) -> the duel is live at once. Fallback: type the other group's
--   6-char group code, or pick an opted-in group near you (duel_challenge) -> the other group accepts or declines.
--   A group can run up to 10 duels per night (pending + live), one per opponent. Duels end at 05:00 local.
--   A person who is a member of BOTH groups picks one side per duel (duel_pick_side); before that the person counts
--   for neither side. One switch within 10 min of the first pick, then the pick is locked.
--   Truppanda (check-ins, skål given, photos) is a side stat and the tiebreaker.
--   Drink counts come from duel_log, filled by triggers on beers / checkins / skals / chat_photos. The existing
--   10 min gap between drinks (server) is untouched.
-- Additive only. Needs 0001-0029 (groups, group_members, beers.other_count, checkins, skals, olnu_uid,
-- olnu_night_of, olnu_world_ok, olnu_dist_m, owner_keys, owner_key_fails). chat_photos (0028) is optional.
-- Rows are never removed: status flags and time filters instead. RLS on, no policies.
-- All client RPCs: SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only.
-- owner_wishes / owner_set_wish: owner key (like owner_stats), EXECUTE for anon + authenticated.
-- Safe to run again.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.feature_wishes (
  id          bigserial primary key,
  user_id     uuid not null,
  name        text null check (name is null or char_length(name) between 1 and 30),
  body        text not null check (char_length(body) between 3 and 500),
  category    text null check (category is null or category in ('kartan', 'grupper', 'chatt', 'lek', 'texter', 'annat')),
  created_at  timestamptz not null default now(),
  status      text not null default 'ny' check (status in ('ny', 'planerad', 'byggs', 'klar', 'nej', 'dold')),
  status_at   timestamptz null,
  votes       int not null default 0
);
create index if not exists feature_wishes_user_idx on public.feature_wishes (user_id, created_at desc);
create index if not exists feature_wishes_top_idx on public.feature_wishes (votes desc, created_at desc);

create table if not exists public.wish_votes (
  wish_id     bigint not null,
  user_id     uuid not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (wish_id, user_id)
);
create index if not exists wish_votes_user_idx on public.wish_votes (user_id, updated_at desc);

create table if not exists public.duels (
  id           bigserial primary key,
  group_a      uuid not null,                 -- challenger
  group_b      uuid not null,                 -- challenged
  created_by   uuid not null,
  via          text not null default 'qr' check (via in ('qr', 'code', 'near')),
  status       text not null default 'pending' check (status in ('pending', 'active', 'declined', 'cancelled', 'expired')),
  created_at   timestamptz not null default now(),
  answer_by    timestamptz not null,          -- a pending challenge lapses at this time
  answered_by  uuid null,
  accepted_at  timestamptz null,
  ends_at      timestamptz not null,          -- 05:00 local of the night
  finished_at  timestamptz null,
  drinks_a     int null, drinks_b int null, spirit_a int null, spirit_b int null,
  winner       text null check (winner is null or winner in ('a', 'b', 'draw')),
  check (group_a <> group_b)
);
create index if not exists duels_a_idx on public.duels (group_a, ends_at desc);
create index if not exists duels_b_idx on public.duels (group_b, ends_at desc);
create index if not exists duels_user_idx on public.duels (created_by, created_at desc);

create table if not exists public.duel_sides (
  duel_id     bigint not null,
  user_id     uuid not null,
  side        text not null check (side in ('a', 'b')),
  first_at    timestamptz not null default now(),
  changed_at  timestamptz not null default now(),
  changes     int not null default 0,
  primary key (duel_id, user_id)
);

create table if not exists public.duel_tokens (
  token       text primary key check (token ~ '^[A-HJ-NP-Z2-9]{8}$'),
  group_id    uuid not null,
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists duel_tokens_group_idx on public.duel_tokens (group_id, expires_at desc);
create index if not exists duel_tokens_user_idx on public.duel_tokens (user_id, created_at desc);

create table if not exists public.duel_open (
  group_id    uuid primary key,
  open        boolean not null default false,
  changed_by  uuid null,
  changed_at  timestamptz not null default now()
);

-- Event log for duel scores. n = drinks delta (can be -1 after undo) or 1 for checkin / skal / photo.
create table if not exists public.duel_log (
  id          bigserial primary key,
  user_id     uuid not null,
  kind        text not null check (kind in ('drink', 'checkin', 'skal', 'photo')),
  n           int not null default 1,
  at          timestamptz not null default now()
);
create index if not exists duel_log_user_idx on public.duel_log (user_id, at);

alter table public.feature_wishes enable row level security;
alter table public.wish_votes     enable row level security;
alter table public.duels          enable row level security;
alter table public.duel_sides     enable row level security;
alter table public.duel_tokens    enable row level security;
alter table public.duel_open      enable row level security;
alter table public.duel_log       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['feature_wishes', 'wish_votes', 'duels', 'duel_sides', 'duel_tokens', 'duel_open', 'duel_log'] loop
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on table public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on table public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table public.%I to service_role', t); end if;
  end loop;
end $$;

-- Owner view for the SQL editor / execute_sql: all wishes, most wanted first. No user ids. Not for clients.
create or replace view public.owner_wishes_v as
  select w.id, w.body, w.category, w.name, w.votes, w.status, w.created_at, w.status_at
    from public.feature_wishes w
   order by w.votes desc, w.created_at desc;
revoke all on public.owner_wishes_v from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on public.owner_wishes_v from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on public.owner_wishes_v from authenticated'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_wd_clean(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

create or replace function public.olnu_wd_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$$;

create or replace function public.olnu_wd_rl(p_key text)
returns void language sql set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('olnu_wd:' || p_key, 0));
$$;

-- Owner key check (same rule as owner_stats). Wrong key: logs a fail row and returns false.
create or replace function public.olnu_wd_owner_ok(p_key text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.owner_key_fails f where f.at > now() - interval '1 hour') > 20 then
    raise exception 'rate_limited';
  end if;
  if p_key is null or char_length(p_key) > 200 or not exists (
       select 1 from public.owner_keys k where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    insert into public.owner_key_fails (at) values (now());
    perform set_config('response.status', '403', true);
    return false;
  end if;
  return true;
end; $$;

-- Opaque handle for a group in the "near you" list (changes every night, never the group id or code).
create or replace function public.olnu_duel_handle(p_group uuid)
returns text language sql stable set search_path = public as $$
  select substr(md5(p_group::text || ':' || public.olnu_night_of(now())::text || ':olnu-duel'), 1, 12);
$$;

create or replace function public.olnu_duel_token()
returns text language sql volatile set search_path = public as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '' order by i)
    from (select extensions.gen_random_bytes(8) b) x, generate_series(0, 7) i;
$$;

-- Live duels + pending challenges of a group tonight.
create or replace function public.olnu_duel_open_n(p_group uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.duels d
   where (d.group_a = p_group or d.group_b = p_group) and d.ends_at > now()
     and (d.status = 'active' or (d.status = 'pending' and d.answer_by > now()));
$$;

-- The live/pending duel between two groups tonight, if any.
create or replace function public.olnu_duel_pair(p_g1 uuid, p_g2 uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select d.id from public.duels d
   where ((d.group_a = p_g1 and d.group_b = p_g2) or (d.group_a = p_g2 and d.group_b = p_g1))
     and d.ends_at > now() and (d.status = 'active' or (d.status = 'pending' and d.answer_by > now()))
   order by d.id desc limit 1;
$$;

-- One side's numbers: drinks (sum since start), spirit (truppanda), members counted, undecided (in both groups,
-- no pick yet). A member of both groups counts only for the side they picked.
create or replace function public.olnu_duel_side(p_duel bigint, p_side text, p_t1 timestamptz default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (
    select x.*, case when p_side = 'a' then x.group_a else x.group_b end as gid,
                case when p_side = 'a' then x.group_b else x.group_a end as oid,
                x.accepted_at as t0, least(coalesce(p_t1, now()), x.ends_at) as t1
      from public.duels x where x.id = p_duel
  ), mem as (
    select m.user_id,
           exists (select 1 from public.group_members o, d where o.group_id = d.oid and o.user_id = m.user_id) as dual,
           (select s.side from public.duel_sides s, d where s.duel_id = d.id and s.user_id = m.user_id) as pick
      from d join public.group_members m on m.group_id = d.gid
  ), cnt as (
    select mem.user_id from mem where not mem.dual or mem.pick = p_side
  ), per as (
    select c.user_id,
      greatest(0, coalesce((select sum(l.n) from public.duel_log l, d where l.user_id = c.user_id and l.kind = 'drink'
                                and d.t0 is not null and l.at >= d.t0 and l.at <= d.t1), 0))::int as dr,
      (least(3, (select count(*) from public.duel_log l, d where l.user_id = c.user_id and l.kind = 'checkin'
                    and d.t0 is not null and l.at >= d.t0 and l.at <= d.t1)) * 3
       + least(10, (select count(*) from public.duel_log l, d where l.user_id = c.user_id and l.kind = 'skal'
                    and d.t0 is not null and l.at >= d.t0 and l.at <= d.t1))
       + least(3, (select count(*) from public.duel_log l, d where l.user_id = c.user_id and l.kind = 'photo'
                    and d.t0 is not null and l.at >= d.t0 and l.at <= d.t1)) * 2)::int as sp
      from cnt c
  )
  select jsonb_build_object(
    'drinks', coalesce((select sum(per.dr) from per), 0)::int,
    'spirit', coalesce((select sum(per.sp) from per), 0)::int,
    'members', (select count(*) from cnt)::int,
    'undecided', (select count(*) from mem where mem.dual and mem.pick is null)::int);
$$;

-- Settle a duel whose time is up (idempotent). Pending past its answer time -> expired.
create or replace function public.olnu_duel_finish(p_duel bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.duels;
  sa jsonb; sb jsonb;
  w text;
begin
  select * into d from public.duels x where x.id = p_duel;
  if not found then return; end if;
  if d.status = 'pending' and (d.answer_by <= now() or d.ends_at <= now()) then
    update public.duels x set status = 'expired' where x.id = d.id and x.status = 'pending';
    return;
  end if;
  if d.status <> 'active' or d.ends_at > now() or d.finished_at is not null then return; end if;
  perform public.olnu_wd_rl('duel:' || d.id::text);
  select * into d from public.duels x where x.id = p_duel;
  if d.finished_at is not null then return; end if;
  sa := public.olnu_duel_side(d.id, 'a', d.ends_at);
  sb := public.olnu_duel_side(d.id, 'b', d.ends_at);
  w := case
         when (sa->>'drinks')::int > (sb->>'drinks')::int then 'a'
         when (sa->>'drinks')::int < (sb->>'drinks')::int then 'b'
         when (sa->>'spirit')::int > (sb->>'spirit')::int then 'a'
         when (sa->>'spirit')::int < (sb->>'spirit')::int then 'b'
         else 'draw' end;
  update public.duels x
     set finished_at = now(), drinks_a = (sa->>'drinks')::int, drinks_b = (sb->>'drinks')::int,
         spirit_a = (sa->>'spirit')::int, spirit_b = (sb->>'spirit')::int, winner = w
   where x.id = d.id and x.finished_at is null;
end; $$;

create or replace function public.olnu_duel_wins(p_group uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.duels d
   where d.finished_at is not null and ((d.group_a = p_group and d.winner = 'a') or (d.group_b = p_group and d.winner = 'b'));
$$;

-- One duel from the caller's view. "Us" = the side of the caller's group; a member of both groups sees the side
-- they picked (before picking: side a, needs_pick = true).
create or replace function public.olnu_duel_json(p_duel bigint, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d public.duels;
  in_a boolean; in_b boolean;
  s public.duel_sides;
  me text; op text;
  ga uuid; gb uuid;
  su jsonb; st jsonb;
  v_status text;
begin
  select * into d from public.duels x where x.id = p_duel;
  if not found then return null; end if;
  in_a := public.olnu_wd_member(d.group_a, p_uid);
  in_b := public.olnu_wd_member(d.group_b, p_uid);
  if not in_a and not in_b then return null; end if;
  select * into s from public.duel_sides x where x.duel_id = d.id and x.user_id = p_uid;
  me := case when in_a and in_b then coalesce(s.side, 'a') when in_a then 'a' else 'b' end;
  op := case when me = 'a' then 'b' else 'a' end;
  ga := case when me = 'a' then d.group_a else d.group_b end;
  gb := case when me = 'a' then d.group_b else d.group_a end;
  v_status := case when d.status = 'active' and d.finished_at is not null then 'done'
                   when d.status = 'active' and d.ends_at <= now() then 'done'
                   when d.status = 'pending' and (d.answer_by <= now() or d.ends_at <= now()) then 'expired'
                   else d.status end;
  if d.finished_at is not null then
    su := jsonb_build_object('drinks', case when me = 'a' then d.drinks_a else d.drinks_b end,
                             'spirit', case when me = 'a' then d.spirit_a else d.spirit_b end);
    st := jsonb_build_object('drinks', case when me = 'a' then d.drinks_b else d.drinks_a end,
                             'spirit', case when me = 'a' then d.spirit_b else d.spirit_a end);
    su := su || jsonb_build_object('members', (public.olnu_duel_side(d.id, me, d.ends_at))->'members');
    st := st || jsonb_build_object('members', (public.olnu_duel_side(d.id, op, d.ends_at))->'members');
  else
    su := public.olnu_duel_side(d.id, me);
    st := public.olnu_duel_side(d.id, op);
  end if;
  return jsonb_build_object(
    'id', d.id, 'status', v_status, 'via', d.via,
    'incoming', v_status = 'pending' and me = 'b' and not (in_a and in_b),
    'outgoing', v_status = 'pending' and me = 'a',
    'created_at', d.created_at, 'answer_by', d.answer_by, 'accepted_at', d.accepted_at, 'ends_at', d.ends_at,
    'finished_at', d.finished_at,
    'group', jsonb_build_object('id', ga, 'name', (select g.name from public.groups g where g.id = ga), 'wins', public.olnu_duel_wins(ga)),
    'opp', jsonb_build_object('name', (select g.name from public.groups g where g.id = gb),
                              'members', (select count(*) from public.group_members m where m.group_id = gb)::int,
                              'wins', public.olnu_duel_wins(gb)),
    'us', su, 'them', st,
    'both', in_a and in_b,
    'needs_pick', in_a and in_b and s.side is null and v_status in ('pending', 'active'),
    'pick', case when s.side is null then null else jsonb_build_object(
              'group_id', case when s.side = 'a' then d.group_a else d.group_b end,
              'can_switch', s.changes = 0 and s.first_at > now() - interval '10 minutes' and v_status in ('pending', 'active'),
              'locked_at', case when s.changes > 0 then s.changed_at else s.first_at + interval '10 minutes' end) end,
    'sides', case when in_a and in_b then jsonb_build_array(
               jsonb_build_object('id', d.group_a, 'name', (select g.name from public.groups g where g.id = d.group_a)),
               jsonb_build_object('id', d.group_b, 'name', (select g.name from public.groups g where g.id = d.group_b)))
             else null end,
    'winner', case when d.winner is null then null when d.winner = 'draw' then 'draw' when d.winner = me then 'us' else 'them' end);
end; $$;

-- ---------------------------------------------------------------------------
-- Log triggers (never block the write)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_duel_beers_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new int := coalesce(new.beer_count, 0) + coalesce(new.other_count, 0);
  v_d int;
begin
  begin
    if tg_op = 'UPDATE' and old.expires_at is not distinct from new.expires_at then
      v_d := v_new - (coalesce(old.beer_count, 0) + coalesce(old.other_count, 0));
    else
      v_d := v_new;
    end if;
    if v_d <> 0 and exists (select 1 from public.group_members m where m.user_id = new.user_id) then
      insert into public.duel_log (user_id, kind, n) values (new.user_id, 'drink', v_d);
    end if;
  exception when others then null;
  end;
  return new;
end; $$;
create or replace trigger olnu_duel_beers
  after insert or update of beer_count, other_count on public.beers
  for each row execute function public.olnu_duel_beers_tg();

create or replace function public.olnu_duel_checkin_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if (tg_op = 'INSERT' or new.created_at is distinct from old.created_at)
       and exists (select 1 from public.group_members m where m.user_id = new.user_id) then
      insert into public.duel_log (user_id, kind, n) values (new.user_id, 'checkin', 1);
    end if;
  exception when others then null;
  end;
  return new;
end; $$;
create or replace trigger olnu_duel_checkin
  after insert or update of created_at on public.checkins
  for each row execute function public.olnu_duel_checkin_tg();

create or replace function public.olnu_duel_skal_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if exists (select 1 from public.group_members m where m.user_id = new.user_id) then
      insert into public.duel_log (user_id, kind, n) values (new.user_id, 'skal', 1);
    end if;
  exception when others then null;
  end;
  return new;
end; $$;
create or replace trigger olnu_duel_skal
  after insert on public.skals
  for each row execute function public.olnu_duel_skal_tg();

create or replace function public.olnu_duel_photo_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.duel_log (user_id, kind, n) values (new.user_id, 'photo', 1);
  exception when others then null;
  end;
  return new;
end; $$;
do $$
begin
  if to_regclass('public.chat_photos') is not null then
    execute 'create or replace trigger olnu_duel_photo after insert on public.chat_photos for each row execute function public.olnu_duel_photo_tg()';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Önskelistan
-- ---------------------------------------------------------------------------
-- submit_wish(text, category?, name?) -> {id, votes, dup, left_today}
-- 3-500 chars (one line), no links. Category: kartan|grupper|chatt|lek|texter|annat (or null).
-- 5 per user per day (Europe/Stockholm) + 1 per 15 s -> slow_down. The same text as a visible wish -> +1 on that one.
create or replace function public.submit_wish(p_text text, p_category text default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_body text := left(public.olnu_wd_clean(p_text), 501);
  v_cat text := nullif(lower(public.olnu_wd_clean(p_category)), '');
  v_name text := nullif(public.olnu_wd_clean(p_name), '');
  v_day timestamptz := date_trunc('day', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm';
  v_n int;
  v_id bigint;
  v_dup boolean := false;
begin
  if char_length(v_body) < 3 or char_length(v_body) > 500 or v_body ~* '(https?://|www\.|\.(se|com|nu|net|org)\M)' then
    raise exception 'invalid_wish';
  end if;
  if v_cat is not null and v_cat not in ('kartan', 'grupper', 'chatt', 'lek', 'texter', 'annat') then raise exception 'invalid_category'; end if;
  if v_name is not null and char_length(v_name) > 30 then v_name := left(v_name, 30); end if;
  perform public.olnu_wd_rl('wish:' || v_uid::text);
  select count(*) into v_n from public.feature_wishes w where w.user_id = v_uid and w.created_at >= v_day;
  if v_n >= 5 or exists (select 1 from public.feature_wishes w where w.user_id = v_uid and w.created_at > now() - interval '15 seconds') then
    raise exception 'slow_down';
  end if;
  select w.id into v_id from public.feature_wishes w
   where lower(w.body) = lower(v_body) and w.status <> 'dold' order by w.id limit 1;
  if v_id is not null then
    v_dup := true;
  else
    insert into public.feature_wishes (user_id, name, body, category) values (v_uid, v_name, v_body, v_cat) returning id into v_id;
    v_n := v_n + 1;
  end if;
  insert into public.wish_votes (wish_id, user_id, active) values (v_id, v_uid, true)
  on conflict (wish_id, user_id) do update set active = true, updated_at = now();
  update public.feature_wishes w set votes = (select count(*) from public.wish_votes v where v.wish_id = w.id and v.active)
   where w.id = v_id;
  return jsonb_build_object('id', v_id, 'dup', v_dup, 'left_today', greatest(0, 5 - v_n),
                            'votes', (select w.votes from public.feature_wishes w where w.id = v_id));
end; $$;

-- vote_wish(id) -> {votes, mine}: toggles the caller's +1. 40 toggles per minute -> slow_down.
create or replace function public.vote_wish(p_wish_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_on boolean;
  v_votes int;
begin
  if not exists (select 1 from public.feature_wishes w where w.id = p_wish_id and (w.status <> 'dold' or w.user_id = v_uid)) then
    raise exception 'wish_not_found';
  end if;
  perform public.olnu_wd_rl('wv:' || v_uid::text);
  if (select count(*) from public.wish_votes v where v.user_id = v_uid and v.updated_at > now() - interval '1 minute') >= 40 then
    raise exception 'slow_down';
  end if;
  insert into public.wish_votes (wish_id, user_id, active) values (p_wish_id, v_uid, true)
  on conflict (wish_id, user_id) do update set active = not public.wish_votes.active, updated_at = now()
  returning active into v_on;
  update public.feature_wishes w set votes = (select count(*) from public.wish_votes v where v.wish_id = w.id and v.active)
   where w.id = p_wish_id returning w.votes into v_votes;
  return jsonb_build_object('votes', v_votes, 'mine', v_on);
end; $$;

-- top_wishes(limit 30, category?) -> visible wishes (not 'dold') + the caller's own, most votes first. No user ids.
create or replace function public.top_wishes(p_limit int default 30, p_category text default null)
returns table (id bigint, body text, category text, name text, votes int, status text, created_at timestamptz,
               mine boolean, is_mine boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_cat text := nullif(lower(btrim(coalesce(p_category, ''))), '');
begin
  return query
  select w.id, w.body, w.category, w.name, w.votes, w.status, w.created_at,
         exists (select 1 from public.wish_votes v where v.wish_id = w.id and v.user_id = v_uid and v.active),
         w.user_id = v_uid
    from public.feature_wishes w
   where (w.status <> 'dold' or w.user_id = v_uid)
     and (v_cat is null or w.category = v_cat)
   order by (w.status in ('klar', 'nej')), w.votes desc, w.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
end; $$;

-- owner_wishes(key) -> jsonb {generated_at, total, wishes:[{id, body, category, name, votes, status, created_at}]}
-- All wishes (also 'dold'), votes desc then newest. Wrong key: 403 like owner_stats.
create or replace function public.owner_wishes(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(), 'total', (select count(*) from public.feature_wishes),
    'wishes', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'body', w.body, 'category', w.category, 'name', w.name,
                 'votes', w.votes, 'status', w.status, 'created_at', w.created_at) order by w.votes desc, w.created_at desc)
              from (select * from public.feature_wishes x order by x.votes desc, x.created_at desc limit 1000) w), '[]'::jsonb));
end; $$;

-- owner_set_wish(key, id, status) -> {ok, status}. status: ny|planerad|byggs|klar|nej|dold ('dold' hides it from users).
create or replace function public.owner_set_wish(p_key text, p_wish_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(btrim(coalesce(p_status, '')));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('ny', 'planerad', 'byggs', 'klar', 'nej', 'dold') then raise exception 'invalid_status'; end if;
  update public.feature_wishes w set status = v_s, status_at = now() where w.id = p_wish_id;
  if not found then raise exception 'wish_not_found'; end if;
  return jsonb_build_object('ok', true, 'status', v_s);
end; $$;

-- ---------------------------------------------------------------------------
-- 2. Gruppduellen
-- ---------------------------------------------------------------------------
-- duel_invite(group) -> {token, expires_at, group_name}. Reuses the group's token while > 10 min are left.
-- Token lives 30 min (never past 05:00). Many groups may use the same token (one duel each).
create or replace function public.duel_invite(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  t public.duel_tokens;
  i int := 0;
begin
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform public.olnu_wd_rl('dt:' || p_group_id::text);
  select * into t from public.duel_tokens x
   where x.group_id = p_group_id and x.expires_at > now() + interval '10 minutes' order by x.expires_at desc limit 1;
  if not found then
    if (select count(*) from public.duel_tokens x where x.user_id = v_uid and x.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'slow_down';
    end if;
    loop
      i := i + 1;
      begin
        insert into public.duel_tokens (token, group_id, user_id, expires_at)
        values (public.olnu_duel_token(), p_group_id, v_uid, least(now() + interval '30 minutes', public.olnu_night_of(now())))
        returning * into t;
        exit;
      exception when unique_violation then
        if i >= 5 then raise exception 'code_generation_failed'; end if;
      end;
    end loop;
  end if;
  return jsonb_build_object('token', t.token, 'expires_at', t.expires_at,
                            'group_name', (select g.name from public.groups g where g.id = p_group_id));
end; $$;

-- duel_token_info(token) -> {group_name, members, expires_at, mine bool (caller is in that group),
--   groups:[{id, name, state: 'ok'|'same'|'dueling'|'full'}]} = the caller's groups that could accept.
create or replace function public.duel_token_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  t public.duel_tokens;
begin
  select * into t from public.duel_tokens x where x.token = upper(btrim(coalesce(p_token, ''))) and x.expires_at > now();
  if not found then raise exception 'token_not_found'; end if;
  return jsonb_build_object(
    'group_name', (select g.name from public.groups g where g.id = t.group_id),
    'members', (select count(*) from public.group_members m where m.group_id = t.group_id)::int,
    'expires_at', t.expires_at,
    'mine', public.olnu_wd_member(t.group_id, v_uid),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
                'state', case when g.id = t.group_id then 'same'
                              when public.olnu_duel_pair(g.id, t.group_id) is not null then 'dueling'
                              when public.olnu_duel_open_n(g.id) >= 10 then 'full' else 'ok' end) order by m.joined_at)
              from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = v_uid), '[]'::jsonb));
end; $$;

-- duel_accept_token(token, my group) -> duel json (+ already bool). One tap: the duel is live at once.
-- A pending challenge between the two groups is accepted. A live one is returned with already = true.
create or replace function public.duel_accept_token(p_token text, p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  t public.duel_tokens;
  v_id bigint;
  d public.duels;
begin
  select * into t from public.duel_tokens x where x.token = upper(btrim(coalesce(p_token, ''))) and x.expires_at > now();
  if not found then raise exception 'token_not_found'; end if;
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_group_id = t.group_id then raise exception 'same_group'; end if;
  perform public.olnu_wd_rl('pair:' || least(p_group_id::text, t.group_id::text) || greatest(p_group_id::text, t.group_id::text));
  v_id := public.olnu_duel_pair(p_group_id, t.group_id);
  if v_id is not null then
    select * into d from public.duels x where x.id = v_id;
    if d.status = 'pending' then
      update public.duels x set status = 'active', accepted_at = now(), answered_by = v_uid where x.id = v_id;
      return public.olnu_duel_json(v_id, v_uid) || jsonb_build_object('already', false);
    end if;
    return public.olnu_duel_json(v_id, v_uid) || jsonb_build_object('already', true);
  end if;
  if public.olnu_duel_open_n(p_group_id) >= 10 or public.olnu_duel_open_n(t.group_id) >= 10 then raise exception 'too_many_duels'; end if;
  insert into public.duels (group_a, group_b, created_by, via, status, answer_by, answered_by, accepted_at, ends_at)
  values (t.group_id, p_group_id, t.user_id, 'qr', 'active', now(), v_uid, now(), public.olnu_night_of(now()))
  returning id into v_id;
  return public.olnu_duel_json(v_id, v_uid) || jsonb_build_object('already', false);
end; $$;

-- duel_challenge(my group, code 6 chars | handle from duel_nearby) -> duel json. The other group must accept
-- (duel_answer) within 30 min. 1 per 20 s per user.
create or replace function public.duel_challenge(p_group_id uuid, p_code text default null, p_handle text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_other uuid;
  v_via text;
  v_id bigint;
begin
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if nullif(btrim(coalesce(p_code, '')), '') is not null then
    select g.id into v_other from public.groups g where g.code = upper(btrim(p_code));
    v_via := 'code';
  elsif nullif(btrim(coalesce(p_handle, '')), '') is not null then
    select o.group_id into v_other from public.duel_open o
     where o.open and public.olnu_duel_handle(o.group_id) = btrim(p_handle) limit 1;
    v_via := 'near';
  end if;
  if v_other is null then raise exception 'group_not_found'; end if;
  if v_other = p_group_id then raise exception 'same_group'; end if;
  perform public.olnu_wd_rl('pair:' || least(p_group_id::text, v_other::text) || greatest(p_group_id::text, v_other::text));
  if public.olnu_duel_pair(p_group_id, v_other) is not null then raise exception 'already_dueling'; end if;
  if public.olnu_duel_open_n(p_group_id) >= 10 or public.olnu_duel_open_n(v_other) >= 10 then raise exception 'too_many_duels'; end if;
  if exists (select 1 from public.duels d where d.created_by = v_uid and d.created_at > now() - interval '20 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.duels (group_a, group_b, created_by, via, status, answer_by, ends_at)
  values (p_group_id, v_other, v_uid, v_via, 'pending',
          least(now() + interval '30 minutes', public.olnu_night_of(now())), public.olnu_night_of(now()))
  returning id into v_id;
  return public.olnu_duel_json(v_id, v_uid);
end; $$;

-- duel_answer(duel, accept) -> duel json. Members of the challenged group only.
create or replace function public.duel_answer(p_duel_id bigint, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  d public.duels;
begin
  select * into d from public.duels x where x.id = p_duel_id;
  if not found or not public.olnu_wd_member(d.group_b, v_uid) then raise exception 'duel_not_found'; end if;
  perform public.olnu_duel_finish(d.id);
  select * into d from public.duels x where x.id = p_duel_id;
  if d.status <> 'pending' then
    if d.status = 'active' then return public.olnu_duel_json(d.id, v_uid); end if;
    raise exception 'duel_over';
  end if;
  if coalesce(p_accept, false) then
    update public.duels x set status = 'active', accepted_at = now(), answered_by = v_uid where x.id = d.id and x.status = 'pending';
  else
    update public.duels x set status = 'declined', answered_by = v_uid where x.id = d.id and x.status = 'pending';
  end if;
  return public.olnu_duel_json(d.id, v_uid);
end; $$;

-- duel_cancel(duel) -> {ok}: a member of the challenging group takes back a pending challenge.
create or replace function public.duel_cancel(p_duel_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  d public.duels;
begin
  select * into d from public.duels x where x.id = p_duel_id;
  if not found or not public.olnu_wd_member(d.group_a, v_uid) then raise exception 'duel_not_found'; end if;
  if d.status <> 'pending' then raise exception 'duel_over'; end if;
  update public.duels x set status = 'cancelled', answered_by = v_uid where x.id = d.id and x.status = 'pending';
  return jsonb_build_object('ok', true);
end; $$;

-- duel_pick_side(duel, group) -> duel json. Only for a member of both groups. First pick any time while the duel
-- is pending or live; one switch within 10 min of the first pick; then locked (side_locked).
create or replace function public.duel_pick_side(p_duel_id bigint, p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  d public.duels;
  s public.duel_sides;
  v_side text;
begin
  select * into d from public.duels x where x.id = p_duel_id;
  if not found or not (public.olnu_wd_member(d.group_a, v_uid) or public.olnu_wd_member(d.group_b, v_uid)) then
    raise exception 'duel_not_found';
  end if;
  if not (public.olnu_wd_member(d.group_a, v_uid) and public.olnu_wd_member(d.group_b, v_uid)) then raise exception 'not_both'; end if;
  if d.ends_at <= now() or d.status not in ('pending', 'active') then raise exception 'duel_over'; end if;
  v_side := case when p_group_id = d.group_a then 'a' when p_group_id = d.group_b then 'b' end;
  if v_side is null then raise exception 'invalid_side'; end if;
  perform public.olnu_wd_rl('side:' || d.id::text || ':' || v_uid::text);
  select * into s from public.duel_sides x where x.duel_id = d.id and x.user_id = v_uid;
  if not found then
    insert into public.duel_sides (duel_id, user_id, side) values (d.id, v_uid, v_side);
  elsif s.side <> v_side then
    if s.changes > 0 or s.first_at <= now() - interval '10 minutes' then raise exception 'side_locked'; end if;
    update public.duel_sides x set side = v_side, changes = x.changes + 1, changed_at = now()
     where x.duel_id = d.id and x.user_id = v_uid;
  end if;
  return public.olnu_duel_json(d.id, v_uid);
end; $$;

-- duel_set_open(group, on) -> {open}: the group can be challenged from the "near you" list.
create or replace function public.duel_set_open(p_group_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  insert into public.duel_open (group_id, open, changed_by, changed_at) values (p_group_id, coalesce(p_on, false), v_uid, now())
  on conflict (group_id) do update set open = excluded.open, changed_by = v_uid, changed_at = now();
  return jsonb_build_object('open', coalesce(p_on, false));
end; $$;

-- duel_nearby(my group, lat, lng) -> {open, groups:[{handle, name, members, out}]}: opted-in groups with a member out
-- tonight (visible live pin, not ghost, or a live check-in) within 30 km. Not the caller's groups, not already dueling.
create or replace function public.duel_nearby(p_group_id uuid, p_lat float8, p_lng float8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  return jsonb_build_object(
    'open', coalesce((select o.open from public.duel_open o where o.group_id = p_group_id), false),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('handle', x.handle, 'name', x.name, 'members', x.members, 'out', x.out_n)
                                         order by x.out_n desc, x.name)
      from (
        select public.olnu_duel_handle(g.id) as handle, g.name,
               (select count(*) from public.group_members m where m.group_id = g.id)::int as members,
               (select count(distinct m.user_id) from public.group_members m
                 where m.group_id = g.id and (
                   exists (select 1 from public.beers b where b.user_id = m.user_id and b.expires_at > now() and not b.stopped
                             and not coalesce(b.ghost, false) and public.olnu_dist_m(b.lat, b.lng, p_lat, p_lng) <= 30000)
                   or exists (select 1 from public.checkins c where c.user_id = m.user_id and c.expires_at > now()
                             and public.olnu_dist_m(c.lat, c.lng, p_lat, p_lng) <= 30000)))::int as out_n
          from public.duel_open o join public.groups g on g.id = o.group_id
         where o.open
           and not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_uid)
           and public.olnu_duel_pair(g.id, p_group_id) is null
      ) x where x.out_n > 0 limit 20), '[]'::jsonb));
end; $$;

-- duel_poll() -> {v, server_time, duels:[duel json]}: every duel of the caller's groups that is pending, live,
-- or ended in the last 16 h (winner card). Settles ended duels on the way. Newest first, max 40.
create or replace function public.duel_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r record;
  v_list jsonb := '[]'::jsonb;
begin
  for r in
    select distinct d.id from public.duels d
      join public.group_members m on m.user_id = v_uid and (m.group_id = d.group_a or m.group_id = d.group_b)
     where (d.status in ('pending', 'active') and d.ends_at > now() - interval '16 hours')
        or (d.status = 'declined' and d.created_at > now() - interval '2 hours')
     order by d.id desc limit 40
  loop
    perform public.olnu_duel_finish(r.id);
    v_list := v_list || jsonb_build_array(public.olnu_duel_json(r.id, v_uid));
  end loop;
  return jsonb_build_object('v', 1, 'server_time', now(), 'night', public.olnu_night_of(now()),
    'open', coalesce((select jsonb_agg(o.group_id) from public.duel_open o
                       join public.group_members m on m.group_id = o.group_id and m.user_id = v_uid where o.open), '[]'::jsonb),
    'duels', v_list);
end; $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  internal text[] := array[
    'public.olnu_wd_clean(text)', 'public.olnu_wd_member(uuid, uuid)', 'public.olnu_wd_rl(text)', 'public.olnu_wd_owner_ok(text)',
    'public.olnu_duel_handle(uuid)', 'public.olnu_duel_token()', 'public.olnu_duel_open_n(uuid)', 'public.olnu_duel_pair(uuid, uuid)',
    'public.olnu_duel_side(bigint, text, timestamptz)', 'public.olnu_duel_finish(bigint)', 'public.olnu_duel_wins(uuid)',
    'public.olnu_duel_json(bigint, uuid)', 'public.olnu_duel_beers_tg()', 'public.olnu_duel_checkin_tg()',
    'public.olnu_duel_skal_tg()', 'public.olnu_duel_photo_tg()'];
  rpcs text[] := array[
    'public.submit_wish(text, text, text)', 'public.vote_wish(bigint)', 'public.top_wishes(int, text)',
    'public.duel_invite(uuid)', 'public.duel_token_info(text)', 'public.duel_accept_token(text, uuid)',
    'public.duel_challenge(uuid, text, text)', 'public.duel_answer(bigint, boolean)', 'public.duel_cancel(bigint)',
    'public.duel_pick_side(bigint, uuid)', 'public.duel_set_open(uuid, boolean)', 'public.duel_nearby(uuid, float8, float8)',
    'public.duel_poll()'];
  owner text[] := array['public.owner_wishes(text)', 'public.owner_set_wish(text, bigint, text)'];
begin
  foreach f in array internal || rpcs || owner loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach f in array rpcs || owner loop execute format('grant execute on function %s to authenticated', f); end loop;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach f in array owner loop execute format('grant execute on function %s to anon', f); end loop;
  end if;
end $$;
