-- 0530 · "Öppen ikväll" (P-088, lane dating2): an anonymous match game between two open people at the SAME bar. OWNER-RUN via
-- the coordinator (RULES §5). Staging first, then live. NOT run by the lane. Beta client only (docs/js/dating*.js).
-- Check after the run (expect t, t, t, t, t, t, t, t):
--   select to_regclass('public.oi_pair') is not null, to_regclass('public.oi_report') is not null,
--     to_regprocedure('public.oi_state(bigint)') is not null,
--     not has_function_privilege('anon', 'public.oi_state(bigint)', 'execute'),
--     has_function_privilege('authenticated', 'public.oi_state(bigint)', 'execute'),
--     not has_function_privilege('authenticated', 'public.olnu_oi_match(uuid)', 'execute'),
--     not has_function_privilege('authenticated', 'public.olnu_oi_view(uuid, uuid, bigint)', 'execute'),
--     exists (select 1 from public.bold_flags f where f.key = 'oi_dating');
--
-- Why: the owner (19 Nov 12:39, OWNER-INPUTS A31): "Create the whole dating feature ... with the games and stuff ... Put it in the
-- beta". Design: pintsnow-ops research/dating/DESIGN.md (flow §2, game §4, safety §5, data §7). Data rule (A32): every night row
-- expires at 06:00 Europe/Stockholm and NO function returns an expired row. The real purge (rows away) is owner-run text in the
-- lane DONE file, because our SQL files never hold remove statements.
-- What it adds (all new; nothing existing is changed):
--   Tables (RLS on, no policy, no grant: only the functions below read or write them). No location column anywhere.
--     oi_consent   (user_id, version, given_at, withdrawn_at)                       kept while the account lives (Art. 7(1) proof)
--     oi_open      (user_id, bar_id, night, age_group, i_am, want, no_groups, offers_left, opened_at, expires_at)   night only
--     oi_pair      (id uuid, night, bar_id, user_a/b, alias_a/b, age_a/b, plan, state, round, step, ...)            night only
--     oi_answer    (pair_id, round, item, user_id, answer)                          night only
--     oi_msg       (id, pair_id, sender, body <= 300)                               night only
--     oi_recent    (user_id, other_id, pair_id, alias, name, night)                 7 days: "Anmäl nån från Öppen ikväll"
--     oi_block     (blocker, blocked)                                               until an account is erased
--     oi_report    (id, reporter, reported, pair_id, reason, note, snapshot, status) owner queue (proposed 180 days after handled)
--     oi_pause     (user_id, until, reason)                                         auto-pause after reports
--     oi_hits      (user_id, kind, at)                                              rate limits, 1 day
--     oi_stats_day (day, opens, offers, accepts, reveals, meets, stops, reports)    no user ids
--   RPCs (security definer, fixed search_path, auth.uid() in the body, execute for authenticated only; public + anon revoked):
--     oi_state(after) · oi_give_consent(version) · oi_withdraw() · oi_set_open(on, age, i_am, want, no_groups, lat, lng, acc)
--     oi_offer(pair, yes) · oi_answer(pair, round, item, answer) · oi_step(pair, yes) · oi_send(pair, body) · oi_meet(pair)
--     oi_stop(pair) · oi_block(pair) · oi_report(pair, reason, note, block) · oi_recent()
--     owner_oi_reports(key, status) · owner_oi_act(key, id, action)   (owner key, like owner_film_reports; authenticated only)
--   Helpers (internal, no grant to anyone): olnu_oi_* below. Matching (olnu_oi_match) runs inside oi_state of an open person
--     (no pg_cron job): the bar needs >= 5 live, proven check-ins; both open at that bar; preferences fit both ways; no block;
--     not paired tonight; max 3 offers per person per night; group mates are skipped when either side asks (default on).
--     The notice shows 2-8 min (random) after the pair is made, the same moment for both; the offer window is 10 min.
-- Never returned to a client: a count of open people, a distance, coordinates, a bar id, or the other person's user id.
--   The other side of every "no" / Stopp / block / report / timeout / check-out sees the same neutral end (only 'ended' + phase).
-- Flag: bold_flags 'oi_dating' (ON when this file runs; the beta client is the only caller). Kill switch:
--   update public.bold_flags set on_ = false, updated_at = now() where key = 'oi_dating';   -> every oi_* RPC raises feature_off.
-- Owner review queue (SQL editor):  select id, reason, note, created_at, status from public.oi_report where status = 'new' order by created_at;
-- Personal data: every table keys a person by a uuid column, so the account erase function (0209, generic uuid sweep) covers them.
-- Additive. Safe to run twice. CR LF safe. Needs: checkins (0011, + unverified 0517 when present), bold_flags (0381),
--   user_safety (0205), user_blocks (0206), group_members, avatars (0172), olnu_friend_name (0045), olnu_dist_m (0007),
--   olnu_wd_owner_ok (0031), olnu_strip_cr (0436).

-- ---------- flag ----------
insert into public.bold_flags (key, on_, note)
values ('oi_dating', true, 'Öppen ikväll (P-088): bar dating game, beta client only. false = every oi_* RPC raises feature_off')
on conflict (key) do nothing;

-- ---------- tables ----------
create table if not exists public.oi_consent (
  user_id      uuid primary key,
  version      smallint not null,
  given_at     timestamptz not null default now(),
  withdrawn_at timestamptz null
);
alter table public.oi_consent enable row level security;
revoke all on table public.oi_consent from public, anon, authenticated;

create table if not exists public.oi_open (
  user_id     uuid primary key,
  bar_id      text not null check (char_length(bar_id) between 1 and 80),
  night       date not null,
  age_group   text null check (age_group is null or age_group in ('18-24', '25-34', '35-44', '45+')),
  i_am        text null check (i_am is null or i_am in ('k', 'm', 'a')),
  want        text null check (want is null or want in ('k', 'm', 'alla')),
  no_groups   boolean not null default true,
  offers_left smallint not null default 3 check (offers_left between 0 and 3),
  opened_at   timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists oi_open_bar on public.oi_open (bar_id, expires_at);
alter table public.oi_open enable row level security;
revoke all on table public.oi_open from public, anon, authenticated;

create table if not exists public.oi_pair (
  id          uuid primary key default gen_random_uuid(),
  night       date not null,
  bar_id      text not null,
  user_a      uuid not null,
  user_b      uuid not null,
  alias_a     text not null,
  alias_b     text not null,
  age_a       text null,
  age_b       text null,
  plan        jsonb not null,
  state       text not null default 'offered' check (state in ('offered', 'playing', 'chat', 'ended')),
  phase       text not null default 'offer' check (phase in ('offer', 'game')),
  round       smallint not null default 1 check (round between 1 and 3),
  step        smallint not null default 0 check (step between 0 and 3),
  ok_a        boolean null,
  ok_b        boolean null,
  step_a      smallint not null default 0,
  step_b      smallint not null default 0,
  meet_a      boolean not null default false,
  meet_b      boolean not null default false,
  code_word   text null,
  notice_at   timestamptz not null,
  offer_until timestamptz not null,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz null,
  end_reason  text null check (end_reason is null or end_reason in
                ('no', 'timeout', 'stop', 'block', 'report', 'left', 'off', 'withdraw', 'paused')),
  expires_at  timestamptz not null,
  check (user_a <> user_b)
);
create index if not exists oi_pair_a on public.oi_pair (user_a, expires_at);
create index if not exists oi_pair_b on public.oi_pair (user_b, expires_at);
alter table public.oi_pair enable row level security;
revoke all on table public.oi_pair from public, anon, authenticated;

create table if not exists public.oi_answer (
  pair_id    uuid not null,
  round      smallint not null check (round between 1 and 3),
  item       smallint not null check (item between 0 and 3),
  user_id    uuid not null,
  answer     text not null check (char_length(answer) between 1 and 260),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (pair_id, round, item, user_id)
);
alter table public.oi_answer enable row level security;
revoke all on table public.oi_answer from public, anon, authenticated;

create table if not exists public.oi_msg (
  id         bigserial primary key,
  pair_id    uuid not null,
  sender     uuid not null,
  body       text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists oi_msg_pair on public.oi_msg (pair_id, id);
alter table public.oi_msg enable row level security;
revoke all on table public.oi_msg from public, anon, authenticated;
revoke all on sequence public.oi_msg_id_seq from public, anon, authenticated;

create table if not exists public.oi_recent (
  user_id    uuid not null,
  pair_id    uuid not null,
  other_id   uuid not null,
  alias      text not null,
  name       text null,
  night      date not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, pair_id)
);
alter table public.oi_recent enable row level security;
revoke all on table public.oi_recent from public, anon, authenticated;

create table if not exists public.oi_block (
  blocker    uuid not null,
  blocked    uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
create index if not exists oi_block_blocked on public.oi_block (blocked);
alter table public.oi_block enable row level security;
revoke all on table public.oi_block from public, anon, authenticated;

create table if not exists public.oi_report (
  id         bigserial primary key,
  reporter   uuid not null,
  reported   uuid not null,
  pair_id    uuid not null,
  reason     text not null check (reason in ('hot', 'sex', 'minor', 'fake', 'meet', 'other')),
  note       text null check (note is null or char_length(note) <= 300),
  snapshot   jsonb not null default '{}'::jsonb,
  status     text not null default 'new' check (status in ('new', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  handled_at timestamptz null,
  unique (reporter, pair_id)
);
create index if not exists oi_report_reported on public.oi_report (reported, created_at);
create index if not exists oi_report_status on public.oi_report (status, created_at);
alter table public.oi_report enable row level security;
revoke all on table public.oi_report from public, anon, authenticated;
revoke all on sequence public.oi_report_id_seq from public, anon, authenticated;

create table if not exists public.oi_pause (
  user_id    uuid primary key,
  until      timestamptz not null,
  reason     text not null check (reason in ('reports', 'minor', 'owner')),
  created_at timestamptz not null default now()
);
alter table public.oi_pause enable row level security;
revoke all on table public.oi_pause from public, anon, authenticated;

create table if not exists public.oi_hits (
  user_id uuid not null,
  kind    text not null check (kind in ('set', 'report', 'consent')),
  at      timestamptz not null default now()
);
create index if not exists oi_hits_u on public.oi_hits (user_id, kind, at);
alter table public.oi_hits enable row level security;
revoke all on table public.oi_hits from public, anon, authenticated;

create table if not exists public.oi_stats_day (
  day     date primary key,
  opens   integer not null default 0,
  offers  integer not null default 0,
  accepts integer not null default 0,
  reveals integer not null default 0,
  meets   integer not null default 0,
  stops   integer not null default 0,
  reports integer not null default 0
);
alter table public.oi_stats_day enable row level security;
revoke all on table public.oi_stats_day from public, anon, authenticated;

-- ---------- helpers (internal: no grant to public, anon or authenticated) ----------
-- the flag (missing row = off)
create or replace function public.olnu_oi_on()
returns boolean language sql stable set search_path = public as $$
  select coalesce((select f.on_ from public.bold_flags f where f.key = 'oi_dating'), false);
$$;

-- next 06:00 Europe/Stockholm strictly after now() (owner A32: night rows expire at 06:00)
create or replace function public.olnu_oi_night_end()
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  v_local timestamp := now() at time zone 'Europe/Stockholm';
  v_t     timestamp := date_trunc('day', v_local) + interval '6 hours';
begin
  if v_local >= v_t then v_t := v_t + interval '1 day'; end if;
  return v_t at time zone 'Europe/Stockholm';
end $$;

-- the night key = the date of the morning when the night ends
create or replace function public.olnu_oi_night()
returns date language sql stable set search_path = public as $$
  select (public.olnu_oi_night_end() at time zone 'Europe/Stockholm')::date;
$$;

-- the bar of a person's live, proven check-in (0517 unverified rows do not count; read through jsonb so this works before 0517)
create or replace function public.olnu_oi_ci_bar(p_uid uuid)
returns text language sql stable set search_path = public as $$
  select c.bar_id from public.checkins c
   where c.user_id = p_uid and c.expires_at > now()
     and not coalesce((to_jsonb(c) ->> 'unverified')::boolean, false);
$$;

create or replace function public.olnu_oi_consent_ok(p_uid uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.oi_consent c where c.user_id = p_uid and c.version >= 1 and c.withdrawn_at is null);
$$;

create or replace function public.olnu_oi_paused(p_uid uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.oi_pause p where p.user_id = p_uid and p.until > now());
$$;

-- a block in either direction: the dating block or the app's own block list
create or replace function public.olnu_oi_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.oi_block k where (k.blocker = p_a and k.blocked = p_b) or (k.blocker = p_b and k.blocked = p_a))
      or exists (select 1 from public.user_blocks k where k.active and ((k.blocker = p_a and k.blocked = p_b) or (k.blocker = p_b and k.blocked = p_a)));
$$;

-- items per round for a game type: A Hellre än, D Snabbfrågor, E Vem ä mest sannolik = 4 questions; B 2 sanningar 1 lögn =
-- lines, lie, guess; C Gissa vad jag dricker = my glass, guess, one follow-up
create or replace function public.olnu_oi_items(p_type text)
returns smallint language sql immutable set search_path = public as $$
  select (case p_type when 'B' then 3 when 'C' then 3 else 4 end)::smallint;
$$;

-- k distinct numbers from 1..n in random order
create or replace function public.olnu_oi_pick(p_n integer, p_k integer)
returns jsonb language sql volatile set search_path = public as $$
  select coalesce(jsonb_agg(s.g), '[]'::jsonb) from (select g from generate_series(1, p_n) g order by random() limit p_k) s;
$$;

-- the game: 3 of the 5 types in random order, with their question numbers
create or replace function public.olnu_oi_plan()
returns jsonb language sql volatile set search_path = public as $$
  select jsonb_agg(jsonb_build_object('t', s.t, 'q', public.olnu_oi_pick(10, case s.t when 'B' then 3 when 'C' then 1 else 4 end)))
    from (select t from unnest(array['A', 'B', 'C', 'D', 'E']) t order by random() limit 3) s;
$$;

-- free-text filter (chat, 2 sanningar, follow-ups): 'ok' or what was found. The client has the same rules (dating-logic.js).
create or replace function public.olnu_oi_filter(p_text text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v text := lower(coalesce(p_text, ''));
begin
  if char_length(regexp_replace(v, '[^0-9]', '', 'g')) >= 7 and v ~ '\d[\d\s().+/-]{5,}\d' then return 'phone'; end if;
  if v ~ '[^\s@]+@[^\s@]+\.[a-z]{2,}' then return 'mail'; end if;
  if v ~ '(https?:|www\.|\m[a-z0-9-]+\.(se|com|nu|net|org|io|me|app|ly|gg|tv|link|xyz)\M)' then return 'link'; end if;
  if v ~ '(^|[^a-z0-9])@[a-z0-9_.]{2,}' then return 'handle'; end if;
  if v ~ '\m(snapchat|instagram|insta|whatsapp|telegram|kik|onlyfans|swish)\M' then return 'handle'; end if;
  if v ~ '\m(knulla|knull|kuk|fitta|hora|horor|slyna|nudes|nakenbild|nakenbilder|sexa|ligga med|runka|porr|cp)\M' then return 'word'; end if;
  return 'ok';
end $$;

create or replace function public.olnu_oi_hit(p_uid uuid, p_kind text, p_max integer, p_window interval)
returns void language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.oi_hits h where h.user_id = p_uid and h.kind = p_kind and h.at > now() - p_window) >= p_max then
    raise exception 'slow_down';
  end if;
  insert into public.oi_hits (user_id, kind) values (p_uid, p_kind);
end $$;

-- counters for the owner (no user ids)
create or replace function public.olnu_oi_stat(p_col text)
returns void language plpgsql set search_path = public as $$
begin
  if p_col not in ('opens', 'offers', 'accepts', 'reveals', 'meets', 'stops', 'reports') then return; end if;
  insert into public.oi_stats_day (day) values (public.olnu_oi_night()) on conflict (day) do nothing;
  execute format('update public.oi_stats_day set %I = %I + 1 where day = $1', p_col, p_col) using public.olnu_oi_night();
end $$;

-- end a pair for both at once. The reason stays on the server; both phones get only "ended" + the phase.
create or replace function public.olnu_oi_end(p_pair uuid, p_reason text)
returns void language plpgsql set search_path = public as $$
begin
  update public.oi_pair p set state = 'ended', ended_at = now(), end_reason = p_reason,
         phase = case when p.state = 'offered' then 'offer' else 'game' end
   where p.id = p_pair and p.state <> 'ended';
end $$;

-- end every live pair of a person
create or replace function public.olnu_oi_end_mine(p_uid uuid, p_reason text)
returns void language plpgsql set search_path = public as $$
declare r record;
begin
  for r in select p.id from public.oi_pair p
            where (p.user_a = p_uid or p.user_b = p_uid) and p.state <> 'ended' and p.expires_at > now() loop
    perform public.olnu_oi_end(r.id, p_reason);
  end loop;
end $$;

-- the pair if p_uid is in it and it is not expired (any state)
create or replace function public.olnu_oi_mine(p_pair uuid, p_uid uuid)
returns public.oi_pair language plpgsql stable set search_path = public as $$
declare p public.oi_pair;
begin
  select * into p from public.oi_pair x where x.id = p_pair and x.expires_at > now() and (x.user_a = p_uid or x.user_b = p_uid);
  if not found then raise exception 'not_in_pair'; end if;
  return p;
end $$;

-- the alias list: colour + Swedish animal (DESIGN §3.4)
create or replace function public.olnu_oi_aliases()
returns text[] language plpgsql volatile set search_path = public as $$
declare
  v_an text[] := array['räv', 'uggla', 'lo', 'älg', 'utter', 'hare', 'korp', 'säl', 'igelkott', 'mård'];
  v_co text[] := array['Gul', 'Blå', 'Grön', 'Röd', 'Lila', 'Silver'];
  i integer := 1 + floor(random() * 10)::int;
  j integer := 1 + ((i + floor(random() * 9)::int) % 10);
begin
  return array[v_co[1 + floor(random() * 6)::int] || ' ' || v_an[i], v_co[1 + floor(random() * 6)::int] || ' ' || v_an[j]];
end $$;

-- matching for one open person (runs inside oi_state / oi_set_open; one bar at a time through an advisory lock)
create or replace function public.olnu_oi_match(p_uid uuid)
returns uuid language plpgsql set search_path = public as $$
declare
  o public.oi_open;
  c public.oi_open;
  v_n integer;
  v_al text[];
  v_id uuid;
  v_at timestamptz;
begin
  select * into o from public.oi_open x where x.user_id = p_uid and x.expires_at > now();
  if not found or o.offers_left <= 0 or not public.olnu_oi_consent_ok(p_uid) or public.olnu_oi_paused(p_uid) then return null; end if;
  if public.olnu_oi_ci_bar(p_uid) is distinct from o.bar_id then return null; end if;
  perform pg_advisory_xact_lock(hashtext('oi:' || o.bar_id));
  if exists (select 1 from public.oi_pair x where (x.user_a = p_uid or x.user_b = p_uid) and x.state <> 'ended' and x.expires_at > now()) then
    return null;
  end if;
  -- the crowd rule: at least 5 live, proven check-ins at this bar (any people, not only open ones)
  select count(*) into v_n from public.checkins k
   where k.bar_id = o.bar_id and k.expires_at > now() and not coalesce((to_jsonb(k) ->> 'unverified')::boolean, false);
  if v_n < 5 then return null; end if;
  select * into c from public.oi_open x
   where x.bar_id = o.bar_id and x.user_id <> p_uid and x.expires_at > now() and x.offers_left > 0
     and public.olnu_oi_ci_bar(x.user_id) = o.bar_id
     and public.olnu_oi_consent_ok(x.user_id) and not public.olnu_oi_paused(x.user_id)
     and (o.want is null or o.want = 'alla' or o.want = x.i_am)
     and (x.want is null or x.want = 'alla' or x.want = o.i_am)
     and not public.olnu_oi_blocked(p_uid, x.user_id)
     and not exists (select 1 from public.oi_pair y where (y.user_a = x.user_id or y.user_b = x.user_id) and y.state <> 'ended' and y.expires_at > now())
     and not exists (select 1 from public.oi_pair y where y.night = o.night
                       and ((y.user_a = p_uid and y.user_b = x.user_id) or (y.user_a = x.user_id and y.user_b = p_uid)))
     and not ((o.no_groups or x.no_groups) and exists (
           select 1 from public.group_members g1 join public.group_members g2 on g2.group_id = g1.group_id
            where g1.user_id = p_uid and g2.user_id = x.user_id))
   order by random() limit 1;
  if not found then return null; end if;
  v_al := public.olnu_oi_aliases();
  v_at := now() + make_interval(secs => 120 + floor(random() * 361));   -- 2-8 min, the same moment for both
  insert into public.oi_pair (night, bar_id, user_a, user_b, alias_a, alias_b, age_a, age_b, plan, notice_at, offer_until, expires_at)
  values (o.night, o.bar_id, p_uid, c.user_id, v_al[1], v_al[2], o.age_group, c.age_group, public.olnu_oi_plan(),
          v_at, v_at + interval '10 minutes', public.olnu_oi_night_end())
  returning id into v_id;
  update public.oi_open x set offers_left = greatest(0, x.offers_left - 1) where x.user_id in (p_uid, c.user_id);
  perform public.olnu_oi_stat('offers');
  return v_id;
end $$;

-- housekeeping for one person: open row follows the check-in; offers time out; a pair ends when one side left the bar
create or replace function public.olnu_oi_tidy(p_uid uuid)
returns void language plpgsql set search_path = public as $$
declare
  o public.oi_open;
  r record;
begin
  select * into o from public.oi_open x where x.user_id = p_uid and x.expires_at > now();
  if found and (public.olnu_oi_ci_bar(p_uid) is distinct from o.bar_id or not public.olnu_oi_consent_ok(p_uid) or public.olnu_oi_paused(p_uid)) then
    update public.oi_open x set expires_at = now() where x.user_id = p_uid;
  end if;
  for r in select p.* from public.oi_pair p
            where (p.user_a = p_uid or p.user_b = p_uid) and p.state <> 'ended' and p.expires_at > now() loop
    if r.state = 'offered' and r.offer_until <= now() then
      perform public.olnu_oi_end(r.id, 'timeout');
    elsif public.olnu_oi_ci_bar(r.user_a) is distinct from r.bar_id or public.olnu_oi_ci_bar(r.user_b) is distinct from r.bar_id then
      perform public.olnu_oi_end(r.id, 'left');
    elsif public.olnu_oi_paused(r.user_a) or public.olnu_oi_paused(r.user_b) then
      perform public.olnu_oi_end(r.id, 'paused');
    end if;
  end loop;
end $$;

-- is an answer visible to the other side? Both answered that item; the lie of "2 sanningar" only after both guessed.
create or replace function public.olnu_oi_seen(p_pair uuid, p_round smallint, p_item smallint, p_type text)
returns boolean language sql stable set search_path = public as $$
  select (select count(distinct a.user_id) from public.oi_answer a
           where a.pair_id = p_pair and a.round = p_round and a.item = (case when p_type = 'B' and p_item = 1 then 2 else p_item end)) >= 2;
$$;

-- one person's view of one pair. Only revealed fields; never a user id, bar, place, distance or count.
create or replace function public.olnu_oi_view(p_pair uuid, p_uid uuid, p_after bigint)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  p public.oi_pair;
  v_a boolean;
  v_other uuid;
  v_type text;
  v_ans jsonb := '{}'::jsonb;
  v_done jsonb := '[]'::jsonb;
  v_rev jsonb := '{}'::jsonb;
  v_msgs jsonb := '[]'::jsonb;
  v_mine integer;
  v_theirs integer;
  v_my_step smallint;
  v_meet boolean;
  r record;
begin
  select * into p from public.oi_pair x where x.id = p_pair and x.expires_at > now() and (x.user_a = p_uid or x.user_b = p_uid);
  if not found or p.notice_at > now() then return null; end if;
  if p.state = 'ended' then return jsonb_build_object('id', p.id, 'state', 'ended', 'ended', true, 'phase', p.phase); end if;
  v_a := p.user_a = p_uid;
  v_other := case when v_a then p.user_b else p.user_a end;
  if p.state = 'offered' then
    return jsonb_build_object('id', p.id, 'state', 'offered', 'mine', case when v_a then p.ok_a else p.ok_b end,
      'left_s', greatest(0, floor(extract(epoch from (p.offer_until - now())))::int));
  end if;
  v_type := p.plan -> (p.round - 1) ->> 't';
  for r in select a.round, a.item, a.user_id, a.answer from public.oi_answer a where a.pair_id = p.id and a.round <= p.round order by a.round, a.item loop
    if r.user_id = p_uid then
      v_ans := jsonb_set(v_ans, array[r.round || '.' || r.item], coalesce(v_ans -> (r.round || '.' || r.item), '{}'::jsonb) || jsonb_build_object('me', r.answer));
    elsif public.olnu_oi_seen(p.id, r.round, r.item, p.plan -> (r.round - 1) ->> 't') then
      v_ans := jsonb_set(v_ans, array[r.round || '.' || r.item], coalesce(v_ans -> (r.round || '.' || r.item), '{}'::jsonb) || jsonb_build_object('them', r.answer));
    end if;
    if r.user_id <> p_uid and r.round = p.round then v_done := v_done || to_jsonb(r.item); end if;
  end loop;
  select count(*) filter (where a.user_id = p_uid), count(*) filter (where a.user_id = v_other) into v_mine, v_theirs
    from public.oi_answer a where a.pair_id = p.id and a.round = p.round;
  v_my_step := case when v_a then p.step_a else p.step_b end;
  if p.step >= 1 then v_rev := v_rev || jsonb_build_object('age', case when v_a then p.age_b else p.age_a end); end if;
  if p.step >= 2 then v_rev := v_rev || jsonb_build_object('name', nullif(split_part(btrim(coalesce(public.olnu_friend_name(v_other), '')), ' ', 1), '')); end if;
  if p.step >= 3 then v_rev := v_rev || jsonb_build_object('avatar', (select av.spec from public.avatars av where av.user_id = v_other)); end if;
  if p.state = 'chat' then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'me', m.sender = p_uid, 'body', m.body, 'at', m.created_at) order by m.id), '[]'::jsonb)
      into v_msgs
      from (select * from public.oi_msg m where m.pair_id = p.id and m.expires_at > now() and m.id > coalesce(p_after, 0) order by m.id limit 200) m;
  end if;
  v_meet := case when v_a then p.meet_a else p.meet_b end;
  return jsonb_build_object('id', p.id, 'state', p.state,
    'me', case when v_a then p.alias_a else p.alias_b end, 'them', case when v_a then p.alias_b else p.alias_a end,
    'plan', p.plan, 'round', p.round, 'answers', v_ans, 'them_done', v_done,
    'complete', p.state = 'playing' and v_mine >= public.olnu_oi_items(v_type) and v_theirs >= public.olnu_oi_items(v_type),
    'step', p.step, 'my_step', v_my_step, 'reveal', v_rev, 'msgs', v_msgs,
    'meet', jsonb_build_object('me', v_meet, 'code', case when p.meet_a and p.meet_b then p.code_word end));
end $$;

-- ---------- RPCs ----------
-- oi_state(p_after) -> {on, expires_at, consent, age_ok, paused, pair}. pair = null | {id, state, ...} (olnu_oi_view)
-- No offers_left: it drops when a pair is made, so it would show a match before the random delay is over.
-- An ended pair is shown 15 min (only 'ended' + phase), so the other side sees the same neutral text as a timeout.
create or replace function public.oi_state(p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  o public.oi_open;
  v_pair uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_oi_on() then raise exception 'feature_off'; end if;
  perform public.olnu_oi_tidy(v_uid);
  select * into o from public.oi_open x where x.user_id = v_uid and x.expires_at > now();
  if found then perform public.olnu_oi_match(v_uid); end if;
  select p.id into v_pair from public.oi_pair p
   where (p.user_a = v_uid or p.user_b = v_uid) and p.expires_at > now() and p.notice_at <= now()
     and (p.state <> 'ended' or (p.ended_at > now() - interval '15 minutes' and p.ended_at >= p.notice_at))
   order by (p.state <> 'ended') desc, p.created_at desc limit 1;
  return jsonb_build_object('on', o.user_id is not null, 'expires_at', o.expires_at,
    'consent', public.olnu_oi_consent_ok(v_uid),
    'age_ok', coalesce((select s.age_ok from public.user_safety s where s.user_id = v_uid), false),
    'paused', public.olnu_oi_paused(v_uid),
    'pair', case when v_pair is null then null else public.olnu_oi_view(v_pair, v_uid, p_after) end);
end $$;

-- explicit consent (GDPR Art. 9(2)(a)); version 1 = the texts in dating-core.js T.consent*
create or replace function public.oi_give_consent(p_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_oi_on() then raise exception 'feature_off'; end if;
  if p_version is distinct from 1 then raise exception 'bad_version'; end if;
  if not coalesce((select s.age_ok from public.user_safety s where s.user_id = v_uid), false) then raise exception 'need_age'; end if;
  perform public.olnu_oi_hit(v_uid, 'consent', 10, interval '1 day');
  insert into public.oi_consent (user_id, version, given_at, withdrawn_at) values (v_uid, p_version, now(), null)
  on conflict (user_id) do update set version = excluded.version, given_at = now(), withdrawn_at = null;
  return jsonb_build_object('ok', true, 'version', p_version);
end $$;

-- withdraw: off now, every live pair ends (neutral to the other), the night's choices are blanked now
create or replace function public.oi_withdraw()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.oi_consent c set withdrawn_at = now() where c.user_id = v_uid and c.withdrawn_at is null;
  update public.oi_open x set expires_at = least(x.expires_at, now()), i_am = null, want = null, age_group = null where x.user_id = v_uid;
  perform public.olnu_oi_end_mine(v_uid, 'withdraw');
  return jsonb_build_object('ok', true);
end $$;

-- the switch. On needs: consent, 18+ on the server, not paused, a live proven check-in, an exact fix (<= 100 m) within 250 m of
-- that check-in (the position is checked and forgotten: never stored). Answer: {on, expires_at} only. Never a count.
create or replace function public.oi_set_open(p_on boolean, p_age text default null, p_i_am text default null, p_want text default null,
  p_no_groups boolean default true, p_lat double precision default null, p_lng double precision default null, p_acc double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_bar text;
  v_ci public.checkins;
  v_night date := public.olnu_oi_night();
  v_left smallint;
  v_exp timestamptz := public.olnu_oi_night_end();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_oi_on() then raise exception 'feature_off'; end if;
  if not coalesce(p_on, false) then
    update public.oi_open x set expires_at = least(x.expires_at, now()) where x.user_id = v_uid;
    perform public.olnu_oi_end_mine(v_uid, 'off');
    return jsonb_build_object('on', false, 'expires_at', null);
  end if;
  if not public.olnu_oi_consent_ok(v_uid) then raise exception 'no_consent'; end if;
  if not coalesce((select s.age_ok from public.user_safety s where s.user_id = v_uid), false) then raise exception 'need_age'; end if;
  if public.olnu_oi_paused(v_uid) then raise exception 'paused'; end if;
  if p_age is null or p_age not in ('18-24', '25-34', '35-44', '45+') then raise exception 'invalid_value'; end if;
  if p_i_am is not null and p_i_am not in ('k', 'm', 'a') then raise exception 'invalid_value'; end if;
  if p_want is not null and p_want not in ('k', 'm', 'alla') then raise exception 'invalid_value'; end if;
  v_bar := public.olnu_oi_ci_bar(v_uid);
  if v_bar is null then raise exception 'no_checkin'; end if;
  select * into v_ci from public.checkins c where c.user_id = v_uid;
  if p_acc is null or p_acc > 100 or p_acc < 0 or p_lat is null or p_lng is null
     or public.olnu_dist_m(p_lat, p_lng, v_ci.lat, v_ci.lng) > 250 then
    raise exception 'not_exact';
  end if;
  perform public.olnu_oi_hit(v_uid, 'set', 20, interval '1 hour');
  select x.offers_left into v_left from public.oi_open x where x.user_id = v_uid and x.night = v_night;
  insert into public.oi_open as x (user_id, bar_id, night, age_group, i_am, want, no_groups, offers_left, opened_at, expires_at)
  values (v_uid, v_bar, v_night, p_age, p_i_am, p_want, coalesce(p_no_groups, true), coalesce(v_left, 3), now(), v_exp)
  on conflict (user_id) do update set bar_id = excluded.bar_id, night = excluded.night, age_group = excluded.age_group,
    i_am = excluded.i_am, want = excluded.want, no_groups = excluded.no_groups, offers_left = excluded.offers_left,
    opened_at = now(), expires_at = excluded.expires_at;
  perform public.olnu_oi_stat('opens');
  perform public.olnu_oi_match(v_uid);
  return jsonb_build_object('on', true, 'expires_at', v_exp);
end $$;

-- "Kör!" / "Inte ikväll". A no ends it; the other side sees the same text as a timeout.
create or replace function public.oi_offer(p_pair uuid, p_yes boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.oi_pair;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_oi_on() then raise exception 'feature_off'; end if;
  perform public.olnu_oi_tidy(v_uid);
  p := public.olnu_oi_mine(p_pair, v_uid);
  if p.state <> 'offered' or p.notice_at > now() or p.offer_until <= now() then raise exception 'wrong_state'; end if;
  if not coalesce(p_yes, false) then
    perform public.olnu_oi_end(p.id, 'no');
  else
    update public.oi_pair x set ok_a = case when x.user_a = v_uid then true else x.ok_a end,
                                ok_b = case when x.user_b = v_uid then true else x.ok_b end
     where x.id = p.id returning * into p;
    if p.ok_a and p.ok_b then
      update public.oi_pair x set state = 'playing', phase = 'game' where x.id = p.id;
      insert into public.oi_recent (user_id, pair_id, other_id, alias, night, expires_at)
      values (p.user_a, p.id, p.user_b, p.alias_b, p.night, now() + interval '7 days'),
             (p.user_b, p.id, p.user_a, p.alias_a, p.night, now() + interval '7 days')
      on conflict (user_id, pair_id) do nothing;
      perform public.olnu_oi_stat('accepts');
    end if;
  end if;
  return public.olnu_oi_view(p.id, v_uid, 0);
end $$;

-- one answer of the current round (an answer cannot change). Free text goes through the filter.
create or replace function public.oi_answer(p_pair uuid, p_round integer, p_item integer, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.oi_pair;
  v_t text;
  v text := btrim(coalesce(p_answer, ''));
  v_other uuid;
  v_f text;
  v_line text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_oi_on() then raise exception 'feature_off'; end if;
  perform public.olnu_oi_tidy(v_uid);
  p := public.olnu_oi_mine(p_pair, v_uid);
  if p.state <> 'playing' then raise exception 'wrong_state'; end if;
  if p_round is distinct from p.round::integer then raise exception 'wrong_round'; end if;
  v_t := p.plan -> (p.round - 1) ->> 't';
  if p_item is null or p_item < 0 or p_item >= public.olnu_oi_items(v_t) then raise exception 'bad_answer'; end if;
  v_other := case when p.user_a = v_uid then p.user_b else p.user_a end;
  if v_t in ('A', 'D') then
    if v not in ('a', 'b', 's') then raise exception 'bad_answer'; end if;
  elsif v_t = 'E' then
    if v !~ '^[jn][jn]$' and v <> 's' then raise exception 'bad_answer'; end if;
  elsif v_t = 'B' and p_item = 0 then
    if array_length(string_to_array(v, E'\n'), 1) is distinct from 3 then raise exception 'bad_answer'; end if;
    foreach v_line in array string_to_array(v, E'\n') loop
      if char_length(btrim(v_line)) not between 2 and 80 then raise exception 'bad_answer'; end if;
    end loop;
    v_f := public.olnu_oi_filter(v); if v_f <> 'ok' then raise exception 'filtered_%', v_f; end if;
  elsif v_t = 'B' then
    if v not in ('0', '1', '2') then raise exception 'bad_answer'; end if;
    if p_item = 1 and not exists (select 1 from public.oi_answer a where a.pair_id = p.id and a.round = p.round and a.item = 0 and a.user_id = v_uid) then
      raise exception 'bad_answer';
    end if;
    if p_item = 2 and not exists (select 1 from public.oi_answer a where a.pair_id = p.id and a.round = p.round and a.item = 0 and a.user_id = v_other) then
      raise exception 'wait_other';
    end if;
  elsif v_t = 'C' and p_item < 2 then
    if v not in ('0', '1', '2', '3', '4', '5') then raise exception 'bad_answer'; end if;
  else
    if v <> 's' then
      if char_length(v) not between 1 and 80 then raise exception 'bad_answer'; end if;
      v_f := public.olnu_oi_filter(v); if v_f <> 'ok' then raise exception 'filtered_%', v_f; end if;
    end if;
  end if;
  insert into public.oi_answer (pair_id, round, item, user_id, answer, expires_at)
  values (p.id, p.round, p_item, v_uid, v, p.expires_at)
  on conflict (pair_id, round, item, user_id) do nothing;
  return public.olnu_oi_view(p.id, v_uid, 0);
end $$;

-- the reveal after each round: 1 age group, 2 first name, 3 avatar. Both must say yes; one no ends the game.
create or replace function public.oi_step(p_pair uuid, p_yes boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.oi_pair;
  v_t text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_oi_on() then raise exception 'feature_off'; end if;
  perform public.olnu_oi_tidy(v_uid);
  p := public.olnu_oi_mine(p_pair, v_uid);
  if p.state <> 'playing' then raise exception 'wrong_state'; end if;
  v_t := p.plan -> (p.round - 1) ->> 't';
  if (select count(*) from public.oi_answer a where a.pair_id = p.id and a.round = p.round) < 2 * public.olnu_oi_items(v_t) then
    raise exception 'not_complete';
  end if;
  if not coalesce(p_yes, false) then
    perform public.olnu_oi_end(p.id, 'no');
    return public.olnu_oi_view(p.id, v_uid, 0);
  end if;
  update public.oi_pair x set step_a = case when x.user_a = v_uid then greatest(x.step_a, x.round) else x.step_a end,
                              step_b = case when x.user_b = v_uid then greatest(x.step_b, x.round) else x.step_b end
   where x.id = p.id returning * into p;
  if p.step_a >= p.round and p.step_b >= p.round and p.step < p.round then
    update public.oi_pair x set step = x.round,
           round = least(3, x.round + 1),
           state = case when x.round >= 3 then 'chat' else 'playing' end
     where x.id = p.id returning * into p;
    if p.step = 2 then
      update public.oi_recent r set name = nullif(split_part(btrim(coalesce(public.olnu_friend_name(r.other_id), '')), ' ', 1), '')
       where r.pair_id = p.id;
    end if;
    if p.step = 3 then perform public.olnu_oi_stat('reveals'); end if;
  end if;
  return public.olnu_oi_view(p.id, v_uid, 0);
end $$;

-- chat: text only, <= 300, filters, 1 message per 2 s, 150 per pair. A filter hit is not sent: {ok:false, filtered:kind}.
create or replace function public.oi_send(p_pair uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.oi_pair;
  v text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x09\x0B-\x1F\x7F]', ' ', 'g'));
  v_f text;
  v_id bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_oi_on() then raise exception 'feature_off'; end if;
  perform public.olnu_oi_tidy(v_uid);
  p := public.olnu_oi_mine(p_pair, v_uid);
  if p.state <> 'chat' then raise exception 'wrong_state'; end if;
  if char_length(v) < 1 or char_length(v) > 300 then raise exception 'bad_text'; end if;
  v_f := public.olnu_oi_filter(v);
  if v_f <> 'ok' then return jsonb_build_object('ok', false, 'filtered', v_f); end if;
  if exists (select 1 from public.oi_msg m where m.pair_id = p.id and m.sender = v_uid and m.created_at > now() - interval '2 seconds') then
    raise exception 'slow_down';
  end if;
  if (select count(*) from public.oi_msg m where m.pair_id = p.id) >= 150 then raise exception 'limit'; end if;
  insert into public.oi_msg (pair_id, sender, body, expires_at) values (p.id, v_uid, v, p.expires_at) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- "Jag vill ses": when both tapped, both get the same code word. No place is ever shared.
create or replace function public.oi_meet(p_pair uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.oi_pair;
  v_words text[] := array['Hjortron', 'Kanelbulle', 'Raggmunk', 'Älgkalv', 'Tomtebloss', 'Pepparkaka', 'Snöskoter', 'Lingon',
    'Fjällräv', 'Midsommar', 'Kantarell', 'Vasaloppet', 'Dalahäst', 'Ostkaka', 'Morakniv', 'Isbad'];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_oi_on() then raise exception 'feature_off'; end if;
  perform public.olnu_oi_tidy(v_uid);
  p := public.olnu_oi_mine(p_pair, v_uid);
  if p.state <> 'chat' then raise exception 'wrong_state'; end if;
  update public.oi_pair x set meet_a = x.meet_a or x.user_a = v_uid, meet_b = x.meet_b or x.user_b = v_uid
   where x.id = p.id returning * into p;
  if p.meet_a and p.meet_b and p.code_word is null then
    update public.oi_pair x set code_word = v_words[1 + floor(random() * 16)::int] where x.id = p.id;
    perform public.olnu_oi_stat('meets');
  end if;
  return public.olnu_oi_view(p.id, v_uid, 0);
end $$;

-- Stopp: ends it for both at once
create or replace function public.oi_stop(p_pair uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.oi_pair;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  p := public.olnu_oi_mine(p_pair, v_uid);
  if p.state <> 'ended' then
    perform public.olnu_oi_end(p.id, 'stop');
    perform public.olnu_oi_stat('stops');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- the other person of a pair I was in: a live pair, or my recent list (7 days)
create or replace function public.olnu_oi_other(p_pair uuid, p_uid uuid)
returns uuid language sql stable set search_path = public as $$
  select coalesce(
    (select case when x.user_a = p_uid then x.user_b else x.user_a end from public.oi_pair x
      where x.id = p_pair and x.expires_at > now() and x.notice_at <= now() and (x.user_a = p_uid or x.user_b = p_uid)),
    (select r.other_id from public.oi_recent r where r.user_id = p_uid and r.pair_id = p_pair and r.expires_at > now()));
$$;

-- Blockera: the two are never matched again (all nights); the pair ends for both
create or replace function public.oi_block(p_pair uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_other := public.olnu_oi_other(p_pair, v_uid);
  if v_other is null then raise exception 'not_in_pair'; end if;
  insert into public.oi_block (blocker, blocked) values (v_uid, v_other) on conflict (blocker, blocked) do nothing;
  perform public.olnu_oi_end(p_pair, 'block');
  return jsonb_build_object('ok', true);
end $$;

-- Anmäl: anonymous to the other. A copy of the pair's game + chat goes with it (it survives the night purge). Auto-pause:
-- 2 reports from different people in 30 days, or one "under 18" report = the reported person cannot turn this on until the owner looks.
create or replace function public.oi_report(p_pair uuid, p_reason text, p_note text default null, p_block boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid;
  p public.oi_pair;
  v_snap jsonb := '{}'::jsonb;
  v_n integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_reason is null or p_reason not in ('hot', 'sex', 'minor', 'fake', 'meet', 'other') then raise exception 'invalid_reason'; end if;
  v_other := public.olnu_oi_other(p_pair, v_uid);
  if v_other is null then raise exception 'not_in_pair'; end if;
  perform public.olnu_oi_hit(v_uid, 'report', 5, interval '1 day');
  select * into p from public.oi_pair x where x.id = p_pair;
  if found then
    v_snap := jsonb_build_object('night', p.night, 'state', p.state, 'step', p.step,
      'alias_reporter', case when p.user_a = v_uid then p.alias_a else p.alias_b end,
      'alias_reported', case when p.user_a = v_uid then p.alias_b else p.alias_a end,
      'answers', coalesce((select jsonb_agg(jsonb_build_object('r', a.round, 'i', a.item, 'by', case when a.user_id = v_uid then 'reporter' else 'reported' end, 'a', a.answer) order by a.round, a.item, a.created_at)
                             from public.oi_answer a where a.pair_id = p.id), '[]'::jsonb),
      'msgs', coalesce((select jsonb_agg(jsonb_build_object('by', case when m.sender = v_uid then 'reporter' else 'reported' end, 'body', m.body, 'at', m.created_at) order by m.id)
                          from public.oi_msg m where m.pair_id = p.id), '[]'::jsonb));
  end if;
  insert into public.oi_report (reporter, reported, pair_id, reason, note, snapshot)
  values (v_uid, v_other, p_pair, p_reason, nullif(left(btrim(coalesce(p_note, '')), 300), ''), v_snap)
  on conflict (reporter, pair_id) do nothing;
  if coalesce(p_block, true) then
    insert into public.oi_block (blocker, blocked) values (v_uid, v_other) on conflict (blocker, blocked) do nothing;
  end if;
  perform public.olnu_oi_end(p_pair, 'report');
  select count(distinct r.reporter) into v_n from public.oi_report r where r.reported = v_other and r.created_at > now() - interval '30 days';
  if p_reason = 'minor' or v_n >= 2 then
    insert into public.oi_pause (user_id, until, reason) values (v_other, 'infinity', case when p_reason = 'minor' then 'minor' else 'reports' end)
    on conflict (user_id) do update set until = 'infinity', reason = excluded.reason, created_at = now();
    update public.oi_open x set expires_at = least(x.expires_at, now()) where x.user_id = v_other;
    perform public.olnu_oi_end_mine(v_other, 'paused');
  end if;
  perform public.olnu_oi_stat('reports');
  return jsonb_build_object('ok', true);
end $$;

-- my recent games (7 days) for "Anmäl nån från Öppen ikväll": alias, first name if it was revealed, night. No ids of people.
create or replace function public.oi_recent()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('ref', r.pair_id, 'alias', r.alias, 'name', r.name, 'night', r.night,
                     'reported', exists (select 1 from public.oi_report x where x.reporter = v_uid and x.pair_id = r.pair_id)) order by r.created_at desc)
                     from (select * from public.oi_recent r where r.user_id = v_uid and r.expires_at > now() order by r.created_at desc limit 20) r), '[]'::jsonb);
end $$;

-- ---------- owner queue (owner key) ----------
create or replace function public.owner_oi_reports(p_key text, p_status text default 'new')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_wd_owner_ok(p_key) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'note', r.note, 'status', r.status,
                     'created_at', r.created_at, 'handled_at', r.handled_at, 'snapshot', r.snapshot,
                     'reports_30d', (select count(distinct x.reporter) from public.oi_report x where x.reported = r.reported and x.created_at > now() - interval '30 days'),
                     'paused', public.olnu_oi_paused(r.reported)) order by r.created_at desc)
                     from public.oi_report r where r.status = coalesce(p_status, 'new')), '[]'::jsonb);
end $$;

-- dismiss (no action) | pause (cannot use Öppen ikväll) | unpause | handled (actioned, nothing more)
create or replace function public.owner_oi_act(p_key text, p_id bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_who uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_wd_owner_ok(p_key) then raise exception 'forbidden'; end if;
  if p_action is null or p_action not in ('dismiss', 'pause', 'unpause', 'handled') then raise exception 'invalid_action'; end if;
  select r.reported into v_who from public.oi_report r where r.id = p_id;
  if v_who is null then raise exception 'not_found'; end if;
  if p_action = 'pause' then
    insert into public.oi_pause (user_id, until, reason) values (v_who, 'infinity', 'owner')
    on conflict (user_id) do update set until = 'infinity', reason = 'owner', created_at = now();
    perform public.olnu_oi_end_mine(v_who, 'paused');
  elsif p_action = 'unpause' then
    update public.oi_pause x set until = now() where x.user_id = v_who;
  end if;
  update public.oi_report r set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end, handled_at = now()
   where r.id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- grants: RPCs for signed-in users only; helpers for nobody ----------
do $$
declare
  f text;
  v_rpcs text[] := array['public.oi_state(bigint)', 'public.oi_give_consent(integer)', 'public.oi_withdraw()',
    'public.oi_set_open(boolean, text, text, text, boolean, double precision, double precision, double precision)',
    'public.oi_offer(uuid, boolean)', 'public.oi_answer(uuid, integer, integer, text)', 'public.oi_step(uuid, boolean)',
    'public.oi_send(uuid, text)', 'public.oi_meet(uuid)', 'public.oi_stop(uuid)', 'public.oi_block(uuid)',
    'public.oi_report(uuid, text, text, boolean)', 'public.oi_recent()',
    'public.owner_oi_reports(text, text)', 'public.owner_oi_act(text, bigint, text)'];
  v_help text[] := array['public.olnu_oi_on()', 'public.olnu_oi_night_end()', 'public.olnu_oi_night()', 'public.olnu_oi_ci_bar(uuid)',
    'public.olnu_oi_consent_ok(uuid)', 'public.olnu_oi_paused(uuid)', 'public.olnu_oi_blocked(uuid, uuid)', 'public.olnu_oi_items(text)',
    'public.olnu_oi_pick(integer, integer)', 'public.olnu_oi_plan()', 'public.olnu_oi_filter(text)',
    'public.olnu_oi_hit(uuid, text, integer, interval)', 'public.olnu_oi_stat(text)', 'public.olnu_oi_end(uuid, text)',
    'public.olnu_oi_end_mine(uuid, text)', 'public.olnu_oi_mine(uuid, uuid)', 'public.olnu_oi_aliases()', 'public.olnu_oi_match(uuid)',
    'public.olnu_oi_tidy(uuid)', 'public.olnu_oi_seen(uuid, smallint, smallint, text)', 'public.olnu_oi_view(uuid, uuid, bigint)',
    'public.olnu_oi_other(uuid, uuid)'];
begin
  foreach f in array v_rpcs loop
    execute 'revoke all on function ' || f || ' from public';
    execute 'revoke all on function ' || f || ' from anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array v_help loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;

select public.olnu_strip_cr();
