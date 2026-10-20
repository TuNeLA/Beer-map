-- 0050 v27 MEDALJCEREMONIN. Client: docs/js/ceremony.js (window.CEREMONY) + docs/ceremony.css.
-- The morning after a night (06:00-18:00 Europe/Stockholm) the members of a group who were out last night vote
-- in 9 categories. One vote per category (it may be changed while voting is open), never for yourself.
-- Results show when every out member has voted in every category, or at 18:00. Winners (ties share) get the
-- group medal "cer_<category>" in user_medals (through the generic olnu_medal_store, eval function below).
-- "Out" = a drink (medal_nights), a check-in or a king tap (medal_checkins / after_nights) that night.
-- Needs 0001-0035 (groups, group_members, medal_nights, medal_checkins, after_nights, olnu_night_of,
-- olnu_evening, olnu_uid, olnu_medal_store from 0018). Additive only; rows are never removed.
-- RLS on, no policies. RPCs: SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only.
-- Test clock: the setting olnu.cer_now (SQL editor / service role only; PostgREST clients cannot set it).
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.cer_votes (
  group_id   uuid not null,
  night      timestamptz not null,
  voter      uuid not null,
  cat        text not null check (char_length(cat) between 1 and 20),
  target     uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, night, voter, cat)
);
create index if not exists cer_votes_target_idx on public.cer_votes (target, night);

create table if not exists public.cer_rl (
  group_id uuid not null,
  night    timestamptz not null,
  user_id  uuid not null,
  n        int not null default 0,
  primary key (group_id, night, user_id)
);

create table if not exists public.cer_done (
  group_id uuid not null,
  night    timestamptz not null,
  done_at  timestamptz not null default now(),
  how      text not null default 'time',          -- 'all' (everyone voted) | 'time' (18:00)
  voters   int not null default 0,
  primary key (group_id, night)
);

create table if not exists public.cer_results (
  group_id uuid not null,
  night    timestamptz not null,
  cat      text not null,
  winner   uuid not null,
  votes    int not null,
  created_at timestamptz not null default now(),
  primary key (group_id, night, cat, winner)
);
create index if not exists cer_results_winner_idx on public.cer_results (winner);

alter table public.cer_votes   enable row level security;
alter table public.cer_rl      enable row level security;
alter table public.cer_done    enable row level security;
alter table public.cer_results enable row level security;
revoke all on table public.cer_votes, public.cer_rl, public.cer_done, public.cer_results from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.cer_votes, public.cer_rl, public.cer_done, public.cer_results from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.cer_votes, public.cer_rl, public.cer_done, public.cer_results from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.cer_votes, public.cer_rl, public.cer_done, public.cer_results to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.olnu_cer_now()
returns timestamptz language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('olnu.cer_now', true), '')::timestamptz, now());
$$;

-- Stable category ids (texts live in docs/js/ceremony.js; keep the order, add new ones at the end).
create or replace function public.olnu_cer_cats()
returns text[] language sql immutable set search_path = public as $$
  select array['hjalte', 'clown', 'citat', 'ankaret', 'dansgolv', 'filosof', 'kebab', 'stil', 'comeback']::text[];
$$;

create or replace function public.olnu_cer_k(p_gid uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5(p_gid::text || ':' || p_uid::text || ':olnu-cer'), 1, 12);
$$;

-- The night the ceremony is about: the night that ended at the last 05:00 (DST-safe, same as 0027 replay).
create or replace function public.olnu_cer_night(p_now timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select public.olnu_night_of(public.olnu_night_of(p_now) - interval '26 hours');
$$;

create or replace function public.olnu_cer_was_out(p_uid uuid, p_night timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.medal_nights mn where mn.user_id = p_uid and mn.night = p_night and mn.beers + mn.others > 0)
      or exists (select 1 from public.medal_checkins mc where mc.user_id = p_uid and mc.night = p_night)
      or exists (select 1 from public.after_nights an where an.user_id = p_uid and an.night = p_night and (an.out or an.checkins > 0));
$$;

-- Current members of the group who were out that night.
create or replace function public.olnu_cer_out(p_gid uuid, p_night timestamptz)
returns table (user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select gm.user_id, gm.display_name from public.group_members gm
   where gm.group_id = p_gid and public.olnu_cer_was_out(gm.user_id, p_night)
   order by gm.joined_at, gm.user_id;
$$;

-- Finishes the ceremony once (everyone voted, or 18:00 passed) and stores the winners. Idempotent.
create or replace function public.olnu_cer_finish(p_gid uuid, p_night timestamptz, p_how text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ins int := 0;
  v_n int := 0;
begin
  select count(*) into v_n from public.olnu_cer_out(p_gid, p_night);
  insert into public.cer_done (group_id, night, how, voters) values (p_gid, p_night, p_how, v_n)
    on conflict (group_id, night) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then return; end if;
  insert into public.cer_results (group_id, night, cat, winner, votes)
  select p_gid, p_night, x.cat, x.target, x.n from (
    select v.cat, v.target, count(*)::int as n, max(count(*)) over (partition by v.cat) as top
      from public.cer_votes v
     where v.group_id = p_gid and v.night = p_night and v.voter <> v.target
       and v.cat = any (public.olnu_cer_cats())
       and v.voter in (select o.user_id from public.olnu_cer_out(p_gid, p_night) o)
       and v.target in (select o.user_id from public.olnu_cer_out(p_gid, p_night) o)
     group by v.cat, v.target) x
   where x.n = x.top and x.n >= 1
  on conflict do nothing;
end;
$$;

-- Full state of one group's ceremony for the caller. Finishes it when due.
create or replace function public.olnu_cer_json(p_gid uuid, p_uid uuid, p_full boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamptz := public.olnu_cer_now();
  v_night  timestamptz := public.olnu_cer_night(v_now);
  v_day    date := (v_night at time zone 'Europe/Stockholm')::date;
  v_open   timestamptz := (v_day + time '06:00') at time zone 'Europe/Stockholm';
  v_close  timestamptz := (v_day + time '18:00') at time zone 'Europe/Stockholm';
  v_cats   text[] := public.olnu_cer_cats();
  v_out    uuid[];
  v_n      int := 0;
  v_done_n int := 0;
  v_me_out boolean := false;
  v_phase  text;
  v_done   record;
  v_mine   jsonb := '{}'::jsonb;
  v_my_n   int := 0;
  v_members jsonb := '[]'::jsonb;
  v_res    jsonb := null;
  v_wins   jsonb := '[]'::jsonb;
  v_done_names jsonb := '[]'::jsonb;
begin
  select coalesce(array_agg(o.user_id), '{}') into v_out from public.olnu_cer_out(p_gid, v_night) o;
  v_n := coalesce(array_length(v_out, 1), 0);
  v_me_out := p_uid = any (v_out);
  select count(*) into v_done_n from (
    select v.voter from public.cer_votes v
     where v.group_id = p_gid and v.night = v_night and v.voter = any (v_out) and v.target = any (v_out)
       and v.cat = any (v_cats)
     group by v.voter having count(*) >= array_length(v_cats, 1)) d;
  select * into v_done from public.cer_done d where d.group_id = p_gid and d.night = v_night;
  if v_n < 2 then
    v_phase := 'none';
  elsif v_done.group_id is not null then
    v_phase := 'done';
  elsif v_now >= v_close then
    perform public.olnu_cer_finish(p_gid, v_night, 'time'); v_phase := 'done';
  elsif v_now < v_open then
    v_phase := 'before';
  elsif v_done_n >= v_n then
    perform public.olnu_cer_finish(p_gid, v_night, 'all'); v_phase := 'done';
  else
    v_phase := 'open';
  end if;

  select coalesce(jsonb_object_agg(v.cat, public.olnu_cer_k(p_gid, v.target)), '{}'::jsonb), count(*)
    into v_mine, v_my_n
    from public.cer_votes v
   where v.group_id = p_gid and v.night = v_night and v.voter = p_uid and v.target = any (v_out) and v.cat = any (v_cats);

  if v_phase = 'done' then
    select coalesce(jsonb_agg(r.cat), '[]'::jsonb) into v_wins
      from public.cer_results r where r.group_id = p_gid and r.night = v_night and r.winner = p_uid;
  end if;

  if p_full then
    select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_cer_k(p_gid, o.user_id), 'name', o.name,
             'is_me', o.user_id = p_uid)), '[]'::jsonb)
      into v_members from public.olnu_cer_out(p_gid, v_night) o;
    select coalesce(jsonb_agg(gm.display_name), '[]'::jsonb) into v_done_names
      from public.group_members gm
     where gm.group_id = p_gid and gm.user_id = any (v_out)
       and (select count(*) from public.cer_votes v where v.group_id = p_gid and v.night = v_night and v.voter = gm.user_id
              and v.target = any (v_out) and v.cat = any (v_cats)) >= array_length(v_cats, 1);
    if v_phase = 'done' then
      select coalesce(jsonb_agg(jsonb_build_object('cat', c.cat, 'votes', c.votes, 'winners', c.w) order by c.ord), '[]'::jsonb)
        into v_res
        from (select r.cat, max(r.votes) as votes, array_position(v_cats, r.cat) as ord,
                     jsonb_agg(jsonb_build_object('k', public.olnu_cer_k(p_gid, r.winner),
                       'name', (select gm.display_name from public.group_members gm where gm.group_id = p_gid and gm.user_id = r.winner),
                       'is_me', r.winner = p_uid)) as w
                from public.cer_results r where r.group_id = p_gid and r.night = v_night
               group by r.cat) c;
    end if;
  end if;

  return jsonb_build_object(
    'v', 1, 'group_id', p_gid, 'group_name', (select g.name from public.groups g where g.id = p_gid),
    'night', v_night, 'evening', public.olnu_evening(v_night), 'now', v_now,
    'opens_at', v_open, 'closes_at', v_close, 'phase', v_phase,
    'how', (select d.how from public.cer_done d where d.group_id = p_gid and d.night = v_night),
    'eligible', v_me_out, 'cats', to_jsonb(v_cats), 'voters_n', v_n, 'done_n', v_done_n,
    'my_votes', v_mine, 'my_n', v_my_n, 'my_done', v_my_n >= array_length(v_cats, 1),
    'my_wins', v_wins, 'members', case when p_full then v_members else null end,
    'done_names', case when p_full then v_done_names else null end,
    'results', v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- ceremony_poll() -> {v, now, night, evening, opens_at, closes_at, groups:[lite state]} (max 20 groups)
create or replace function public.ceremony_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_cer_now();
  v_night timestamptz := public.olnu_cer_night(v_now);
  v_day date := (v_night at time zone 'Europe/Stockholm')::date;
  v_out jsonb := '[]'::jsonb;
  r record;
begin
  for r in select gm.group_id from public.group_members gm where gm.user_id = v_uid order by gm.joined_at limit 20 loop
    v_out := v_out || jsonb_build_array(public.olnu_cer_json(r.group_id, v_uid, false));
  end loop;
  return jsonb_build_object('v', 1, 'now', v_now, 'night', v_night, 'evening', public.olnu_evening(v_night),
    'opens_at', (v_day + time '06:00') at time zone 'Europe/Stockholm',
    'closes_at', (v_day + time '18:00') at time zone 'Europe/Stockholm', 'groups', v_out);
end;
$$;

-- ceremony_group(p_group_id) -> full state (members = out members with key k, my_votes {cat: k}, results when done)
create or replace function public.ceremony_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return public.olnu_cer_json(p_group_id, v_uid, true);
end;
$$;

-- ceremony_vote(p_group_id, p_cat, p_k) -> full state. One vote per category (changing is fine while open).
create or replace function public.ceremony_vote(p_group_id uuid, p_cat text, p_k text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_cer_now();
  v_night timestamptz := public.olnu_cer_night(v_now);
  v_st jsonb;
  v_target uuid;
  v_rl int;
begin
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_cat is null or not (p_cat = any (public.olnu_cer_cats())) then raise exception 'invalid_cat'; end if;
  v_st := public.olnu_cer_json(p_group_id, v_uid, false);
  if v_st->>'phase' = 'done' then raise exception 'ceremony_done'; end if;
  if v_st->>'phase' <> 'open' then raise exception 'not_open'; end if;
  if not coalesce((v_st->>'eligible')::boolean, false) then raise exception 'not_out'; end if;
  select o.user_id into v_target from public.olnu_cer_out(p_group_id, v_night) o
   where public.olnu_cer_k(p_group_id, o.user_id) = p_k limit 1;
  if v_target is null then raise exception 'invalid_member'; end if;
  if v_target = v_uid then raise exception 'self_vote'; end if;
  insert into public.cer_rl as c (group_id, night, user_id, n) values (p_group_id, v_night, v_uid, 1)
    on conflict (group_id, night, user_id) do update set n = c.n + 1
    returning c.n into v_rl;
  if v_rl > 120 then raise exception 'slow_down'; end if;
  insert into public.cer_votes as v (group_id, night, voter, cat, target)
  values (p_group_id, v_night, v_uid, p_cat, v_target)
  on conflict (group_id, night, voter, cat) do update set target = excluded.target, updated_at = now();
  return public.olnu_cer_json(p_group_id, v_uid, true);
end;
$$;

-- Group medals: one stacking medal per category won ("cer_hjalte" ×N ...). Picked up by olnu_medal_store (0018).
create or replace function public.olnu_medal_eval_cer(p_uid uuid)
returns table (medal text, n integer)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select 'cer_' || r.cat, count(distinct (r.group_id, r.night))::int
    from public.cer_results r where r.winner = p_uid group by r.cat;
exception when others then
  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_cer_now(), public.olnu_cer_cats(), public.olnu_cer_k(uuid, uuid), public.olnu_cer_night(timestamptz), '
    || 'public.olnu_cer_was_out(uuid, timestamptz), public.olnu_cer_out(uuid, timestamptz), public.olnu_cer_finish(uuid, timestamptz, text), '
    || 'public.olnu_cer_json(uuid, uuid, boolean), public.olnu_medal_eval_cer(uuid)';
  v_rpcs text := 'public.ceremony_poll(), public.ceremony_group(uuid), public.ceremony_vote(uuid, text, text)';
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
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ' || v_helpers || ', ' || v_rpcs || ' to service_role';
  end if;
end $$;
