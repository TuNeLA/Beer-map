-- 0509 · Skåla med telefonen (lane bump, 13 Nov 2026; owner design 01:15–01:18). OWNER-RUN. Staging first. Flag pn_bump (default OFF).
-- Needs: 0023 (post_beer_v2), 0381 (bold_flags), 0386 (olnu_bold_friends, olnu_bold_ghost, olnu_bold_name), 0206 (olnu_dm_blocked).
-- Flow: shake (the glass fills) → knock the phones (MATCH) → each person tilts the phone and drinks the glass empty (FINISH)
--       → when BOTH finished within 60 s of the match: one ÖL! for each, through post_beer_v2 (same 10-min rule, undo, spökläge).
--   1. bump_ready(p_lat, p_lng, p_ago_ms, p_acc, p_precise, p_hidden, p_kind) = "my phone felt the knock". The phone sends the ms
--      since the knock, never its clock. Server time = now - p_ago_ms (max 2 s). Match = ONE earlier, unmatched knock of another
--      user: friends or same group, not blocked, within 1.5 s, ≤ 50 m apart or at the same checked-in bar. Nothing is logged here.
--   2. bump_finish(p_id) = "my glass is empty". Counts only within 60 s of the match (late = nothing, "Skålen rann ut").
--      A second call changes nothing (replay). When the mate also finished in time, MY beer is logged now.
--   3. bump_wait(p_id): the phone polls here (match, then the mate's finish). When both finished in time, MY beer is logged here.
--      Every beer is posted in its own user's session (auth.uid()), once per row (posted_at).
--   No meriter, no medals, no counter: a skål never gives more than ÖL! gives. One finishes alone = nothing for anyone.
--   Privacy: positions only for the match, set to null after 10 min; the other phone gets only a display name.
--   Limits: 1 knock per 2 s (slow_down), 30 per night (bump_limit).
-- Flags: the server works when bold_flags pn_bump OR pn_bump_test is on. The app shows the feature only with pn_bump (or ?bump=1 /
--   PN_CFG.bump on that phone). Release: run this on live, set pn_bump_test on → the owner + a friend test with ?bump=1 while
--   everybody else sees nothing; when the owner says "works": pn_bump on (everyone). Both rows are added OFF.
-- Additive: create table / index / add column if not exists, create or replace function, one flag row (on conflict do nothing).
-- Safe to run twice; safe over the first 0509 draft (staging 13 Nov 00:5x): same table, new columns, same signatures + bump_finish.
-- Check after the run (expect t, t, t, t):
--   select to_regprocedure('public.bump_ready(double precision,double precision,integer,double precision,boolean,boolean,text)') is not null,
--          to_regprocedure('public.bump_finish(bigint)') is not null,
--          exists (select 1 from public.bold_flags f where f.key = 'pn_bump'),
--          exists (select 1 from public.bold_flags f where f.key = 'pn_bump_test');

insert into public.bold_flags (key, on_, note)
values ('pn_bump', false, 'Skåla med telefonen (0509, lane bump): shake, knock, drink = ÖL! for two friends.')
on conflict (key) do nothing;
insert into public.bold_flags (key, on_, note)
values ('pn_bump_test', false, 'Skåla med telefonen: server on for testers only (the app needs ?bump=1). pn_bump = everyone.')
on conflict (key) do nothing;

-- The server side is on for everyone (pn_bump) or for the ?bump=1 testers (pn_bump_test).
create or replace function public.olnu_bump_on()
returns boolean language sql stable security definer set search_path = public as $$
  select public.olnu_bold_on('pn_bump') or public.olnu_bold_on('pn_bump_test');
$$;

create table if not exists public.pn_bumps (
  id        bigserial primary key,
  user_id   uuid not null,
  night     timestamptz not null,
  at        timestamptz not null,
  kind      text not null default 'bump' check (kind in ('bump', 'tap')),
  lat       double precision,
  lng       double precision,
  acc       real,
  bar_id    text,
  precise   boolean not null default false,
  hidden    boolean not null default false,
  pair_id   bigint,
  partner   uuid,
  posted_at timestamptz,
  beer      jsonb
);
alter table public.pn_bumps add column if not exists matched_at timestamptz;
alter table public.pn_bumps add column if not exists finished_at timestamptz;
create index if not exists pn_bumps_night_at on public.pn_bumps (night, at);
create index if not exists pn_bumps_user_at on public.pn_bumps (user_id, at);
create index if not exists pn_bumps_pair on public.pn_bumps (pair_id) where pair_id is not null;
alter table public.pn_bumps enable row level security;
revoke all on table public.pn_bumps from public, anon, authenticated;

-- Can knock a (earlier) and knock b (newer) be one skål? Friends / group, not blocked, 1.5 s, place.
create or replace function public.olnu_bump_pairs_ok(a public.pn_bumps, b public.pn_bumps)
returns boolean language sql stable security definer set search_path = public as $$
  select a.user_id <> b.user_id
     and public.olnu_bold_friends(a.user_id, b.user_id)
     and not public.olnu_dm_blocked(a.user_id, b.user_id)
     and abs(extract(epoch from (b.at - a.at))) <= 1.5
     and (
       (a.lat is not null and b.lat is not null and public.olnu_dist_m(a.lat, a.lng, b.lat, b.lng) <= 50)
       or (a.bar_id is not null and a.bar_id = b.bar_id)
     );
$$;

-- Both glasses empty within 60 s of the match?
create or replace function public.olnu_bump_both(r public.pn_bumps)
returns boolean language sql stable security definer set search_path = public as $$
  select r.pair_id is not null and r.matched_at is not null
     and r.finished_at is not null and r.finished_at <= r.matched_at + interval '60 seconds'
     and exists (select 1 from public.pn_bumps m where m.pair_id = r.pair_id and m.id <> r.id
                    and m.finished_at is not null and m.finished_at <= r.matched_at + interval '60 seconds');
$$;

-- Log the beer for the row's user (must be the caller) with the normal ÖL! path. Only when both finished in time; once per row.
-- Answers the post_beer_v2 jsonb, or { accepted: false, error } when post_beer_v2 refused; null = not (yet) both finished.
create or replace function public.olnu_bump_post(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r     public.pn_bumps;
  v     jsonb;
  v_lat double precision;
  v_lng double precision;
  v_pre boolean;
begin
  select * into r from public.pn_bumps x where x.id = p_id and x.user_id = v_uid for update;
  if not found then return null; end if;
  if r.posted_at is not null then return r.beer; end if;
  if not public.olnu_bump_both(r) then return null; end if;
  v_lat := r.lat; v_lng := r.lng; v_pre := r.precise;
  if v_lat is null then   -- matched by the bar: post at my checked-in bar
    select c.lat, c.lng into v_lat, v_lng from public.checkins c where c.user_id = v_uid and c.expires_at > now();
    v_pre := true;
  end if;
  begin
    if v_lat is null then
      v := jsonb_build_object('accepted', false, 'error', 'no_position');
    else
      v := public.post_beer_v2(v_lat, v_lng, coalesce(v_pre, false), r.hidden);
    end if;
  exception when others then
    v := jsonb_build_object('accepted', false, 'error', sqlerrm);
  end;
  update public.pn_bumps x set posted_at = clock_timestamp(), beer = v where x.id = r.id;
  return v;
end; $$;

create or replace function public.olnu_bump_json(r public.pn_bumps, p_beer jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('v', 2, 'id', r.id, 'kind', r.kind, 'pair', r.pair_id,
    'matched', case when r.partner is null then '[]'::jsonb
                    else jsonb_build_array(jsonb_build_object('name', public.olnu_bold_name(r.user_id, r.partner))) end,
    'me_done', r.finished_at is not null,
    'mate_done', exists (select 1 from public.pn_bumps m where r.pair_id is not null and m.pair_id = r.pair_id and m.id <> r.id
                           and m.finished_at is not null),
    'both', public.olnu_bump_both(r),
    'left_s', case when r.matched_at is null then null
                   else greatest(0, ceil(extract(epoch from (r.matched_at + interval '60 seconds' - clock_timestamp()))))::int end,
    'expired', r.matched_at is not null and clock_timestamp() > r.matched_at + interval '60 seconds' and not public.olnu_bump_both(r),
    'beer', coalesce(p_beer, r.beer),
    'done', r.pair_id is not null or clock_timestamp() > r.at + interval '4 seconds');
$$;

create or replace function public.bump_ready(p_lat double precision, p_lng double precision, p_ago_ms integer default 0,
  p_acc double precision default null, p_precise boolean default false, p_hidden boolean default false, p_kind text default 'bump')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_kind  text := lower(btrim(coalesce(p_kind, 'bump')));
  v_bar   text;
  me      public.pn_bumps;
  c       public.pn_bumps;
begin
  if not public.olnu_bump_on() then raise exception 'feature_off'; end if;
  if v_kind <> 'bump' then raise exception 'invalid_kind'; end if;
  if (p_lat is null) <> (p_lng is null) or (p_lat is not null and not public.olnu_world_ok(p_lat, p_lng)) then
    raise exception 'invalid_pos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pn_bump:' || v_night::text, 0));   -- serial: a knock always sees the one before it
  if exists (select 1 from public.pn_bumps b where b.user_id = v_uid and b.at > clock_timestamp() - interval '2 seconds') then
    raise exception 'slow_down';
  end if;
  if (select count(*) from public.pn_bumps b where b.user_id = v_uid and b.night = v_night) >= 30 then raise exception 'bump_limit'; end if;
  update public.pn_bumps b set lat = null, lng = null
   where b.night = v_night and b.at < clock_timestamp() - interval '10 minutes' and b.lat is not null;
  select ci.bar_id into v_bar from public.checkins ci where ci.user_id = v_uid and ci.expires_at > now();
  insert into public.pn_bumps (user_id, night, at, kind, lat, lng, acc, bar_id, precise, hidden)
  values (v_uid, v_night,
          clock_timestamp() - make_interval(secs => least(greatest(coalesce(p_ago_ms, 0), 0), 2000) / 1000.0),
          v_kind, p_lat, p_lng, least(greatest(coalesce(p_acc, 999), 0), 999)::real, v_bar,
          coalesce(p_precise, false) and p_lat is not null,
          coalesce(p_hidden, false) or public.olnu_bold_ghost(v_uid))
  returning * into me;
  select * into c from public.pn_bumps b
   where b.night = v_night and b.id <> me.id and b.user_id <> v_uid and b.pair_id is null
     and b.at > me.at - interval '2 seconds' and b.at < me.at + interval '2 seconds'
     and public.olnu_bump_pairs_ok(b, me)
   order by abs(extract(epoch from (b.at - me.at))), b.id
   limit 1;
  if found then
    update public.pn_bumps b set pair_id = c.id, partner = me.user_id, matched_at = clock_timestamp() where b.id = c.id;
    update public.pn_bumps b set pair_id = c.id, partner = c.user_id, matched_at = clock_timestamp() where b.id = me.id returning * into me;
  end if;
  return public.olnu_bump_json(me, null);
end; $$;

-- My glass is empty. In time (≤ 60 s after the match) it counts; a replay or a late call changes nothing.
create or replace function public.bump_finish(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public.olnu_uid();
  r      public.pn_bumps;
  v_beer jsonb;
begin
  select * into r from public.pn_bumps x where x.id = p_id and x.user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if r.pair_id is null then raise exception 'not_matched'; end if;
  if r.finished_at is null and clock_timestamp() <= r.matched_at + interval '60 seconds' then
    update public.pn_bumps x set finished_at = clock_timestamp() where x.id = r.id;
  end if;
  v_beer := public.olnu_bump_post(r.id);
  select * into r from public.pn_bumps x where x.id = p_id;
  return public.olnu_bump_json(r, v_beer);
end; $$;

-- The phone asks here: first "did a friend knock back?" (every ~350 ms, max 4 s), then "did my mate finish?" (≤ 60 s).
create or replace function public.bump_wait(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public.olnu_uid();
  r      public.pn_bumps;
  v_beer jsonb;
begin
  select * into r from public.pn_bumps x where x.id = p_id and x.user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
  if r.pair_id is not null then
    v_beer := public.olnu_bump_post(r.id);
    select * into r from public.pn_bumps x where x.id = p_id;
  end if;
  return public.olnu_bump_json(r, v_beer);
end; $$;

do $$
declare
  v_int  text := 'public.olnu_bump_on(), public.olnu_bump_pairs_ok(public.pn_bumps, public.pn_bumps), public.olnu_bump_both(public.pn_bumps), '
              || 'public.olnu_bump_post(bigint), public.olnu_bump_json(public.pn_bumps, jsonb)';
  v_user text := 'public.bump_ready(double precision, double precision, integer, double precision, boolean, boolean, text), '
              || 'public.bump_finish(bigint), public.bump_wait(bigint)';
begin
  execute 'revoke all on function ' || v_int || ', ' || v_user || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_int || ', ' || v_user || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_int || ' from authenticated';
    execute 'grant execute on function ' || v_user || ' to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ' || v_user || ' to service_role';
  end if;
end $$;

select public.olnu_strip_cr();
