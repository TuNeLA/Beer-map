-- 0509 · Skåla med telefonen (lane bump, 13 Nov 2026). OWNER-RUN. Staging first. PROTOTYPE behind flag pn_bump (default OFF).
-- Needs: 0023 (post_beer_v2), 0381 (bold_flags), 0386 (olnu_bold_friends, olnu_bold_ghost, olnu_bold_name), 0206 (olnu_dm_blocked).
-- Idea (owner 13 Nov 00:34): two friends shake their phones (the glass fills), then knock the phones together = both press ÖL!.
--   1. bump_ready(p_lat, p_lng, p_ago_ms, p_acc, p_precise, p_hidden, p_kind) = "my phone felt the knock" (or a tap on Skål).
--      The phone sends the ms since the knock, never its clock (phone clocks are wrong). Server time = now - p_ago_ms (max 2 s).
--      The server matches it with ONE earlier, unmatched bump of another user: friends or same group, not blocked,
--      within 1.5 s (both 'bump') or 3 s (a 'tap' fallback), and ≤ 50 m apart or at the same checked-in bar.
--   2. On a match the beer is logged for the CALLER with post_beer_v2 (same 10-min limit, undo, spökläge). The first phone gets
--      its beer in bump_wait (it polls every ~350 ms, max 4 s). Every beer is posted in its own user's session (auth.uid()).
--   3. No meriter, no medals, no counter: a bump never gives more than ÖL! gives.
--   Privacy: positions only for the match, set to null after 10 min; the other phone gets only a display name.
--   Limits: 1 bump per 2 s (slow_down), 30 per night (bump_limit).
-- Additive: create table / index if not exists, create or replace function, one flag row (on conflict do nothing). Safe to run twice.
-- Check after the run (expect t, t, t):
--   select to_regprocedure('public.bump_ready(double precision,double precision,integer,double precision,boolean,boolean,text)') is not null,
--          to_regprocedure('public.bump_wait(bigint)') is not null,
--          exists (select 1 from public.bold_flags f where f.key = 'pn_bump');

insert into public.bold_flags (key, on_, note)
values ('pn_bump', false, 'Skåla med telefonen (0509, lane bump): shake + knock = ÖL! for two friends. Prototype.')
on conflict (key) do nothing;

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
create index if not exists pn_bumps_night_at on public.pn_bumps (night, at);
create index if not exists pn_bumps_user_at on public.pn_bumps (user_id, at);
alter table public.pn_bumps enable row level security;
revoke all on table public.pn_bumps from public, anon, authenticated;

-- Can bump a (earlier) and bump b (newer) be one skål? Friends / group, not blocked, time window, place.
create or replace function public.olnu_bump_pairs_ok(a public.pn_bumps, b public.pn_bumps)
returns boolean language sql stable security definer set search_path = public as $$
  select a.user_id <> b.user_id
     and public.olnu_bold_friends(a.user_id, b.user_id)
     and not public.olnu_dm_blocked(a.user_id, b.user_id)
     and abs(extract(epoch from (b.at - a.at))) <= case when a.kind = 'bump' and b.kind = 'bump' then 1.5 else 3.0 end
     and (
       (a.lat is not null and b.lat is not null and public.olnu_dist_m(a.lat, a.lng, b.lat, b.lng) <= 50)
       or (a.bar_id is not null and a.bar_id = b.bar_id)
     );
$$;

-- Log the beer for the row's user (must be the caller) with the normal ÖL! path. Once per row. Answers the post_beer_v2 jsonb,
-- or { accepted: false, error } when post_beer_v2 refused (outside the world box, not signed in …).
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
  if not found or r.pair_id is null then return null; end if;
  if r.posted_at is not null then return r.beer; end if;
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
  select jsonb_build_object('v', 1, 'id', r.id, 'kind', r.kind, 'pair', r.pair_id,
    'matched', case when r.partner is null then '[]'::jsonb
                    else jsonb_build_array(jsonb_build_object('name', public.olnu_bold_name(r.user_id, r.partner))) end,
    'beer', p_beer,
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
  v_beer  jsonb;
begin
  if not public.olnu_bold_on('pn_bump') then raise exception 'feature_off'; end if;
  if v_kind not in ('bump', 'tap') then raise exception 'invalid_kind'; end if;
  if (p_lat is null) <> (p_lng is null) or (p_lat is not null and not public.olnu_world_ok(p_lat, p_lng)) then
    raise exception 'invalid_pos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pn_bump:' || v_night::text, 0));   -- serial: a bump always sees the one before it
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
     and b.at > me.at - interval '3 seconds' and b.at < me.at + interval '3 seconds'
     and public.olnu_bump_pairs_ok(b, me)
   order by abs(extract(epoch from (b.at - me.at))), b.id
   limit 1;
  if found then
    update public.pn_bumps b set pair_id = c.id, partner = me.user_id where b.id = c.id;
    update public.pn_bumps b set pair_id = c.id, partner = c.user_id where b.id = me.id returning * into me;
    v_beer := public.olnu_bump_post(me.id);
    select * into me from public.pn_bumps b where b.id = me.id;
  end if;
  return public.olnu_bump_json(me, v_beer);
end; $$;

-- The first phone asks here (every ~350 ms, max 4 s) whether a friend knocked back. On a match its own beer is logged here.
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
begin
  execute 'revoke all on function public.olnu_bump_pairs_ok(public.pn_bumps, public.pn_bumps), public.olnu_bump_post(bigint), '
       || 'public.olnu_bump_json(public.pn_bumps, jsonb), '
       || 'public.bump_ready(double precision, double precision, integer, double precision, boolean, boolean, text), '
       || 'public.bump_wait(bigint) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.bump_ready(double precision, double precision, integer, double precision, boolean, boolean, text), '
         || 'public.bump_wait(bigint), public.olnu_bump_post(bigint), public.olnu_bump_pairs_ok(public.pn_bumps, public.pn_bumps), '
         || 'public.olnu_bump_json(public.pn_bumps, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_bump_post(bigint), public.olnu_bump_pairs_ok(public.pn_bumps, public.pn_bumps), '
         || 'public.olnu_bump_json(public.pn_bumps, jsonb) from authenticated';
    execute 'grant execute on function public.bump_ready(double precision, double precision, integer, double precision, boolean, boolean, text), '
         || 'public.bump_wait(bigint) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.bump_ready(double precision, double precision, integer, double precision, boolean, boolean, text), '
         || 'public.bump_wait(bigint) to service_role';
  end if;
end $$;

select public.olnu_strip_cr();
