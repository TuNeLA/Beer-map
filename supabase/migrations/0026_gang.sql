-- 0026 v19 GÄNGET (group fun pack). Client: docs/js/gang.js + docs/js/gang-content.js + docs/gang.css.
-- 1 Citatboken (quote book, revealed 10:00 the next day)   2 Mest troligt (vote a member)
-- 3 Vart ska vi? (bar poll -> call-out via create_rally)    4 Bakisbrunchen (morning brunch call)
-- 5 Kebabtoppen (late-night food ratings, monthly per town) 6 Skuldboken (who owes whom + Swish number)
-- 7 Morgontidningen (facts of the group's last night for a fake tabloid page, drawn by the client)
-- Additive only. Needs 0001-0025 (groups, group_msgs, rallies + create_rally, medal_nights, medal_checkins,
-- after_nights, bars_lite, olnu_towns, etas, bar_takeovers). Rows are never removed; reads filter on time.
-- RLS on, no policies. All RPCs: SECURITY DEFINER, search_path public, olnu_uid(), authenticated only.
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.gang_quotes (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,                       -- who saved it
  who         text not null check (char_length(who) between 1 and 30),
  body        text not null check (char_length(body) between 1 and 140),
  msg_id      bigint null,
  night       timestamptz not null,
  reveal_at   timestamptz not null,
  created_at  timestamptz not null default now(),
  hidden      boolean not null default false,
  hidden_by   uuid null,
  hidden_at   timestamptz null
);
create index if not exists gang_quotes_group_idx on public.gang_quotes (group_id, id desc);
create index if not exists gang_quotes_user_idx on public.gang_quotes (user_id, created_at desc);

create table if not exists public.gang_mt_rounds (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,                       -- who started it
  q           int not null check (q between 0 and 9999),
  night       timestamptz not null,
  created_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  closed_at   timestamptz null
);
create index if not exists gang_mt_rounds_group_idx on public.gang_mt_rounds (group_id, night, id desc);
create index if not exists gang_mt_rounds_user_idx on public.gang_mt_rounds (user_id, created_at desc);

create table if not exists public.gang_mt_votes (
  round_id    bigint not null,
  voter       uuid not null,
  target      uuid not null,
  updated_at  timestamptz not null default now(),
  primary key (round_id, voter)
);

create table if not exists public.gang_polls (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,
  night       timestamptz not null,
  options     jsonb not null,                      -- [{id, name, lat, lng}] 2-4
  created_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  ended_at    timestamptz null,
  ended_by    uuid null,
  winner      int null,
  rally_id    bigint null,
  rally_error text null
);
create index if not exists gang_polls_group_idx on public.gang_polls (group_id, id desc);
create index if not exists gang_polls_user_idx on public.gang_polls (user_id, created_at desc);

create table if not exists public.gang_poll_votes (
  poll_id     bigint not null,
  user_id     uuid not null,
  opt         int not null check (opt between 0 and 3),
  updated_at  timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table if not exists public.gang_brunches (
  id          bigserial primary key,
  group_id    uuid not null,
  user_id     uuid not null,
  place       text not null check (char_length(place) between 1 and 60),
  place_id    text null,
  lat         float8 null,
  lng         float8 null,
  at_time     text null,                           -- 'HH:MM' or null (= nu)
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  closed      boolean not null default false
);
create index if not exists gang_brunches_group_idx on public.gang_brunches (group_id, id desc);
create index if not exists gang_brunches_user_idx on public.gang_brunches (user_id, created_at desc);

create table if not exists public.gang_brunch_answers (
  brunch_id   bigint not null,
  user_id     uuid not null,
  answer      text not null check (answer in ('ja', 'kanske', 'nej')),
  updated_at  timestamptz not null default now(),
  primary key (brunch_id, user_id)
);

create table if not exists public.kebab_ratings (
  id          bigserial primary key,
  user_id     uuid not null,
  place_id    text not null check (char_length(place_id) between 1 and 80),
  place_name  text not null check (char_length(place_name) between 1 and 60),
  lat         float8 not null,
  lng         float8 not null,
  town        text not null,
  stars       int not null check (stars between 1 and 5),
  tag         text null,
  night       timestamptz not null,
  month       date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, place_id, night)
);
create index if not exists kebab_ratings_town_idx on public.kebab_ratings (town, month);
create index if not exists kebab_ratings_place_idx on public.kebab_ratings (place_id, month);
create index if not exists kebab_ratings_user_idx on public.kebab_ratings (user_id, updated_at desc);

create table if not exists public.gang_debts (
  id           bigserial primary key,
  group_id     uuid not null,
  created_by   uuid not null,
  debtor       uuid not null,
  creditor     uuid not null,
  amount       int not null check (amount between 1 and 50000),
  what         text not null check (char_length(what) between 1 and 40),
  created_at   timestamptz not null default now(),
  paid_at      timestamptz null,
  paid_by      uuid null,
  cancelled_at timestamptz null,
  cancelled_by uuid null
);
create index if not exists gang_debts_group_idx on public.gang_debts (group_id, id desc);
create index if not exists gang_debts_user_idx on public.gang_debts (created_by, created_at desc);

create table if not exists public.gang_swish (
  group_id    uuid not null,
  user_id     uuid not null,
  number      text null,
  changes     int not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.gang_quotes         enable row level security;
alter table public.gang_mt_rounds      enable row level security;
alter table public.gang_mt_votes       enable row level security;
alter table public.gang_polls          enable row level security;
alter table public.gang_poll_votes     enable row level security;
alter table public.gang_brunches       enable row level security;
alter table public.gang_brunch_answers enable row level security;
alter table public.kebab_ratings       enable row level security;
alter table public.gang_debts          enable row level security;
alter table public.gang_swish          enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
-- One line, no control chars, spaces squeezed, trimmed. Empty -> ''.
create or replace function public.olnu_gang_clean(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- Opaque member key (never a user id).
create or replace function public.olnu_gang_k(p_group uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-gang'), 1, 12);
$$;

create or replace function public.olnu_gang_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$$;

-- Member user id from key, or null.
create or replace function public.olnu_gang_uid_of(p_group uuid, p_k text)
returns uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.group_members m
   where m.group_id = p_group and public.olnu_gang_k(p_group, m.user_id) = p_k limit 1;
$$;

create or replace function public.olnu_gang_name(p_group uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid;
$$;

-- The night that ended last (the 05:00 boundary at or before now), DST-correct.
create or replace function public.olnu_gang_last_night()
returns timestamptz language sql stable set search_path = public as $$
  select ((public.olnu_night_of(now()) at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$$;

-- 10:00 Europe/Stockholm on the day the night ends.
create or replace function public.olnu_gang_reveal(p_night timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select (((p_night at time zone 'Europe/Stockholm')::date + time '10:00') at time zone 'Europe/Stockholm');
$$;

create or replace function public.olnu_gang_hour()
returns int language sql stable set search_path = public as $$
  select extract(hour from (now() at time zone 'Europe/Stockholm'))::int;
$$;

-- Town key for kebab lists: the nearest known town (~30 km), else a ~50 km cell.
create or replace function public.olnu_gang_town(p_lat float8, p_lng float8)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(public.olnu_town_of(p_lat, p_lng),
                  '~' || (round(p_lat::numeric * 2) / 2)::text || ':' || (round(p_lng::numeric))::text);
$$;

create or replace function public.olnu_gang_rl(p_key text)
returns void language sql set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('olnu_gang:' || p_key, 0));
$$;

-- Mest troligt: a round is open while not closed, not past ends_at, and not everyone (current members) voted.
create or replace function public.olnu_gang_mt_done(r public.gang_mt_rounds)
returns boolean language sql stable security definer set search_path = public as $$
  select r.closed_at is not null or r.ends_at <= now()
      or (select count(*) from public.gang_mt_votes v
            join public.group_members m on m.group_id = r.group_id and m.user_id = v.voter
           where v.round_id = r.id)
         >= greatest(2, (select count(*) from public.group_members m where m.group_id = r.group_id));
$$;

create or replace function public.olnu_gang_mt_json(r public.gang_mt_rounds, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with votes as (
    select v.voter, v.target from public.gang_mt_votes v
      join public.group_members m on m.group_id = r.group_id and m.user_id = v.voter
      join public.group_members t on t.group_id = r.group_id and t.user_id = v.target
     where v.round_id = r.id
  ), res as (
    select v.target, count(*)::int as n from votes v group by v.target
  )
  select jsonb_build_object(
    'id', r.id, 'q', r.q, 'created_at', r.created_at, 'ends_at', r.ends_at,
    'by', public.olnu_gang_name(r.group_id, r.user_id), 'by_me', r.user_id = p_uid,
    'votes', (select count(*) from votes)::int,
    'needed', greatest(2, (select count(*) from public.group_members m where m.group_id = r.group_id))::int,
    'my_vote', (select public.olnu_gang_k(r.group_id, v.target) from votes v where v.voter = p_uid),
    'done', public.olnu_gang_mt_done(r),
    'results', case when public.olnu_gang_mt_done(r) then coalesce((
        select jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(r.group_id, x.target),
                                            'name', public.olnu_gang_name(r.group_id, x.target),
                                            'is_me', x.target = p_uid, 'n', x.n) order by x.n desc, public.olnu_gang_name(r.group_id, x.target))
          from res x), '[]'::jsonb) else null end);
$$;

create or replace function public.olnu_gang_poll_json(p public.gang_polls, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with votes as (
    select v.user_id, v.opt, v.updated_at from public.gang_poll_votes v
      join public.group_members m on m.group_id = p.group_id and m.user_id = v.user_id
     where v.poll_id = p.id
  )
  select jsonb_build_object(
    'id', p.id, 'by', public.olnu_gang_name(p.group_id, p.user_id), 'by_me', p.user_id = p_uid,
    'created_at', p.created_at, 'ends_at', p.ends_at,
    'ended', p.ended_at is not null or p.ends_at <= now(), 'ended_at', coalesce(p.ended_at, case when p.ends_at <= now() then p.ends_at end),
    'winner', p.winner, 'rally_id', p.rally_id, 'rally_error', p.rally_error,
    'rally_mine', exists (select 1 from public.rallies r where r.id = p.rally_id and r.user_id = p_uid),
    'my_vote', (select v.opt from votes v where v.user_id = p_uid),
    'votes', (select count(*) from votes)::int,
    'options', coalesce((
      select jsonb_agg(o.value || jsonb_build_object(
               'i', (o.ord - 1)::int,
               'n', (select count(*) from votes v where v.opt = o.ord - 1)::int,
               'names', coalesce((select jsonb_agg(public.olnu_gang_name(p.group_id, v.user_id) order by v.updated_at)
                                    from votes v where v.opt = o.ord - 1), '[]'::jsonb)) order by o.ord)
        from jsonb_array_elements(p.options) with ordinality o(value, ord)), '[]'::jsonb));
$$;

-- Winner of a poll: most votes (current members); tie -> the option that reached that count first
-- (earliest last vote among tied); no votes -> null.
create or replace function public.olnu_gang_poll_winner(p public.gang_polls)
returns int language sql stable security definer set search_path = public as $$
  select v.opt from public.gang_poll_votes v
    join public.group_members m on m.group_id = p.group_id and m.user_id = v.user_id
   where v.poll_id = p.id
   group by v.opt
   order by count(*) desc, max(v.updated_at), v.opt
   limit 1;
$$;

-- End a poll (lock held by caller). Picks the winner and makes the call-out with create_rally as the caller.
create or replace function public.olnu_gang_poll_finish(p_id bigint, p_uid uuid)
returns public.gang_polls language plpgsql security definer set search_path = public as $$
declare
  p public.gang_polls;
  w int;
  o jsonb;
  r json;
  v_rally bigint := null;
  v_err text := null;
begin
  select * into p from public.gang_polls x where x.id = p_id for update;
  if p.ended_at is not null then return p; end if;
  w := public.olnu_gang_poll_winner(p);
  if w is not null then
    o := p.options -> w;
    begin
      r := public.create_rally(p.group_id, left('🗳️ Gänget har röstat: ' || (o ->> 'name') || '!', 100),
                               left(o ->> 'name', 60), (o ->> 'lat')::float8, (o ->> 'lng')::float8);
      v_rally := (r ->> 'id')::bigint;
    exception when others then
      v_err := left(sqlerrm, 40);   -- e.g. slow_down: the result still shows, the app offers the call-out button
    end;
  end if;
  update public.gang_polls x
     set ended_at = now(), ended_by = p_uid, winner = w, rally_id = v_rally, rally_error = v_err
   where x.id = p_id
  returning * into p;
  return p;
end; $$;

create or replace function public.olnu_gang_brunch_json(b public.gang_brunches, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with a as (
    select x.user_id, x.answer, x.updated_at from public.gang_brunch_answers x
      join public.group_members m on m.group_id = b.group_id and m.user_id = x.user_id
     where x.brunch_id = b.id
  )
  select jsonb_build_object(
    'id', b.id, 'by', public.olnu_gang_name(b.group_id, b.user_id), 'by_me', b.user_id = p_uid,
    'place', b.place, 'place_id', b.place_id, 'lat', b.lat, 'lng', b.lng, 'at_time', b.at_time,
    'created_at', b.created_at, 'expires_at', b.expires_at,
    'mine', (select a.answer from a where a.user_id = p_uid),
    'ja', coalesce((select jsonb_agg(public.olnu_gang_name(b.group_id, a.user_id) order by a.user_id <> b.user_id, a.updated_at) from a where a.answer = 'ja'), '[]'::jsonb),
    'kanske', coalesce((select jsonb_agg(public.olnu_gang_name(b.group_id, a.user_id) order by a.updated_at) from a where a.answer = 'kanske'), '[]'::jsonb),
    'nej', coalesce((select jsonb_agg(public.olnu_gang_name(b.group_id, a.user_id) order by a.updated_at) from a where a.answer = 'nej'), '[]'::jsonb));
$$;

-- Open debts between current members only. Net per member: + = gets money, - = owes.
create or replace function public.olnu_gang_debts_json(p_group uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with mem as (select m.user_id, m.display_name from public.group_members m where m.group_id = p_group),
  open as (
    select d.* from public.gang_debts d
     where d.group_id = p_group and d.paid_at is null and d.cancelled_at is null
       and d.debtor in (select user_id from mem) and d.creditor in (select user_id from mem)
  ),
  paid as (
    select d.* from public.gang_debts d
     where d.group_id = p_group and d.paid_at is not null and d.cancelled_at is null and d.paid_at > now() - interval '14 days'
     order by d.paid_at desc limit 10
  ),
  net as (
    select u.user_id, sum(u.amt)::int as net from (
      select o.creditor as user_id, o.amount as amt from open o
      union all select o.debtor, -o.amount from open o) u group by u.user_id
  )
  select jsonb_build_object(
    'open', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'amount', o.amount, 'what', o.what, 'created_at', o.created_at,
        'debtor', public.olnu_gang_k(p_group, o.debtor), 'debtor_name', public.olnu_gang_name(p_group, o.debtor),
        'creditor', public.olnu_gang_k(p_group, o.creditor), 'creditor_name', public.olnu_gang_name(p_group, o.creditor),
        'by', public.olnu_gang_name(p_group, o.created_by),
        'i_owe', o.debtor = p_uid, 'owed_me', o.creditor = p_uid,
        'can_cancel', o.created_by = p_uid or o.creditor = p_uid) order by o.id desc) from open o), '[]'::jsonb),
    'paid', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'amount', o.amount, 'what', o.what, 'paid_at', o.paid_at,
        'debtor_name', public.olnu_gang_name(p_group, o.debtor), 'creditor_name', public.olnu_gang_name(p_group, o.creditor),
        'can_undo', (o.debtor = p_uid or o.creditor = p_uid or o.created_by = p_uid) and o.paid_at > now() - interval '1 day')
        order by o.paid_at desc) from paid o), '[]'::jsonb),
    'net', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group, n.user_id),
        'name', public.olnu_gang_name(p_group, n.user_id), 'is_me', n.user_id = p_uid, 'net', n.net) order by n.net desc)
        from net n where n.net <> 0), '[]'::jsonb),
    'swish', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group, s.user_id),
        'name', public.olnu_gang_name(p_group, s.user_id), 'is_me', s.user_id = p_uid, 'number', s.number))
        from public.gang_swish s where s.group_id = p_group and s.number is not null
         and s.user_id in (select user_id from mem)), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- 1. Citatboken
-- ---------------------------------------------------------------------------
-- add_quote(group, who, body, msg_id?) -> {id, reveal_at, who, body}
-- With a msg_id of a live message in this group: who = sender's name, body = the message (client values ignored).
create or replace function public.add_quote(p_group_id uuid, p_who text, p_body text, p_msg_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_who text := public.olnu_gang_clean(p_who);
  v_body text := public.olnu_gang_clean(p_body);
  v_night timestamptz := public.olnu_night_of(now());
  m public.group_msgs;
  v_id bigint;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_msg_id is not null then
    select * into m from public.group_msgs x where x.id = p_msg_id and x.group_id = p_group_id;
    if found then
      v_body := public.olnu_gang_clean(m.body);
      v_who := coalesce(public.olnu_gang_name(p_group_id, m.user_id), v_who);
    end if;
  end if;
  v_body := btrim(v_body, ' "”“');
  if v_who = '' or char_length(v_who) > 30 or v_body = '' or char_length(v_body) > 140 then raise exception 'invalid_quote'; end if;
  perform public.olnu_gang_rl('q:' || v_uid::text);
  if exists (select 1 from public.gang_quotes q where q.user_id = v_uid and q.created_at > now() - interval '8 seconds') then
    raise exception 'slow_down';
  end if;
  if (select count(*) from public.gang_quotes q where q.user_id = v_uid and q.night = v_night) >= 40 then
    raise exception 'slow_down';
  end if;
  -- Same quote twice tonight in this group -> the old row.
  select q.id into v_id from public.gang_quotes q
   where q.group_id = p_group_id and q.night = v_night and lower(q.body) = lower(v_body) and lower(q.who) = lower(v_who) and not q.hidden
   limit 1;
  if v_id is null then
    insert into public.gang_quotes (group_id, user_id, who, body, msg_id, night, reveal_at)
    values (p_group_id, v_uid, v_who, v_body, case when m.id is not null then m.id end, v_night, public.olnu_gang_reveal(v_night))
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'reveal_at', public.olnu_gang_reveal(v_night), 'who', v_who, 'body', v_body);
end; $$;

-- hide_quote(id): the saver, or a member whose display name equals "who" (the quoted person). Not undone.
create or replace function public.hide_quote(p_quote_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  q public.gang_quotes;
begin
  select * into q from public.gang_quotes x where x.id = p_quote_id;
  if not found or not public.olnu_gang_member(q.group_id, v_uid) then raise exception 'quote_not_found'; end if;
  if q.user_id <> v_uid and lower(coalesce(public.olnu_gang_name(q.group_id, v_uid), '')) <> lower(q.who) then
    raise exception 'not_yours';
  end if;
  update public.gang_quotes x set hidden = true, hidden_by = v_uid, hidden_at = now() where x.id = q.id;
  return jsonb_build_object('ok', true);
end; $$;

-- gang_quotes(group, before_id?) -> setof rows, newest first, max 30: revealed quotes + the caller's own pending ones.
create or replace function public.gang_quotes(p_group_id uuid, p_before_id bigint default null)
returns table (id bigint, who text, body text, by_name text, by_me boolean, created_at timestamptz, night timestamptz,
               reveal_at timestamptz, revealed boolean, can_hide boolean)
language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_me text;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  v_me := lower(coalesce(public.olnu_gang_name(p_group_id, v_uid), ''));
  return query
  select q.id, q.who, q.body, public.olnu_gang_name(q.group_id, q.user_id), q.user_id = v_uid, q.created_at, q.night,
         q.reveal_at, q.reveal_at <= now(), q.user_id = v_uid or lower(q.who) = v_me
    from public.gang_quotes q
   where q.group_id = p_group_id and not q.hidden
     and (q.reveal_at <= now() or q.user_id = v_uid)
     and (p_before_id is null or q.id < p_before_id)
   order by q.id desc
   limit 30;
end; $$;

-- ---------------------------------------------------------------------------
-- 2. Mest troligt
-- ---------------------------------------------------------------------------
-- mt_start(group, n = number of questions in the client list) -> {id, q}
-- One open round per group (round_open). Needs 2+ members (not_enough). 1 start per 15 s per user.
-- q = random index < n, not used by the group in the last 30 days when possible.
create or replace function public.mt_start(p_group_id uuid, p_n int default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_n int := least(greatest(coalesce(p_n, 120), 1), 10000);
  r public.gang_mt_rounds;
  v_q int;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if (select count(*) from public.group_members m where m.group_id = p_group_id) < 2 then raise exception 'not_enough'; end if;
  perform public.olnu_gang_rl('mt:' || p_group_id::text);
  for r in select * from public.gang_mt_rounds x where x.group_id = p_group_id and x.closed_at is null and x.ends_at > now() loop
    if not public.olnu_gang_mt_done(r) then raise exception 'round_open'; end if;
  end loop;
  if exists (select 1 from public.gang_mt_rounds x where x.user_id = v_uid and x.created_at > now() - interval '15 seconds') then
    raise exception 'slow_down';
  end if;
  select g.i into v_q from generate_series(0, v_n - 1) g(i)
   where g.i not in (select x.q from public.gang_mt_rounds x where x.group_id = p_group_id and x.created_at > now() - interval '30 days')
   order by random() limit 1;
  if v_q is null then v_q := floor(random() * v_n)::int; end if;
  insert into public.gang_mt_rounds (group_id, user_id, q, night, ends_at)
  values (p_group_id, v_uid, v_q, public.olnu_night_of(now()), now() + interval '10 minutes')
  returning * into r;
  return jsonb_build_object('id', r.id, 'q', r.q);
end; $$;

-- mt_vote(round, member key) -> round json. Change allowed until the round is done.
create or replace function public.mt_vote(p_round_id bigint, p_member text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r public.gang_mt_rounds;
  v_t uuid;
begin
  select * into r from public.gang_mt_rounds x where x.id = p_round_id;
  if not found or not public.olnu_gang_member(r.group_id, v_uid) then raise exception 'round_not_found'; end if;
  if public.olnu_gang_mt_done(r) then raise exception 'round_done'; end if;
  v_t := public.olnu_gang_uid_of(r.group_id, p_member);
  if v_t is null then raise exception 'invalid_member'; end if;
  insert into public.gang_mt_votes (round_id, voter, target) values (r.id, v_uid, v_t)
  on conflict (round_id, voter) do update set target = excluded.target, updated_at = now();
  return public.olnu_gang_mt_json(r, v_uid);
end; $$;

-- mt_close(round): the starter ends it now (results show).
create or replace function public.mt_close(p_round_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  r public.gang_mt_rounds;
begin
  update public.gang_mt_rounds x set closed_at = coalesce(x.closed_at, now())
   where x.id = p_round_id and x.user_id = v_uid
  returning * into r;
  if not found then raise exception 'round_not_found'; end if;
  return public.olnu_gang_mt_json(r, v_uid);
end; $$;

-- ---------------------------------------------------------------------------
-- 3. Vart ska vi?
-- ---------------------------------------------------------------------------
-- create_bar_poll(group, options jsonb [{id, name, lat, lng}] 2-4 distinct) -> {id, ends_at}
create or replace function public.create_bar_poll(p_group_id uuid, p_options jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_opts jsonb := '[]'::jsonb;
  o jsonb;
  v_id text; v_name text; v_lat float8; v_lng float8;
  p public.gang_polls;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 2 and 4 then
    raise exception 'invalid_poll';
  end if;
  for o in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(o) <> 'object' then raise exception 'invalid_poll'; end if;
    v_id := public.olnu_gang_clean(o ->> 'id');
    v_name := public.olnu_gang_clean(o ->> 'name');
    begin
      v_lat := (o ->> 'lat')::float8; v_lng := (o ->> 'lng')::float8;
    exception when others then raise exception 'invalid_poll';
    end;
    if v_id = '' or char_length(v_id) > 80 or v_name = '' or char_length(v_name) > 60 or not public.olnu_world_ok(v_lat, v_lng) then
      raise exception 'invalid_poll';
    end if;
    if exists (select 1 from jsonb_array_elements(v_opts) e where e.value ->> 'id' = v_id) then raise exception 'invalid_poll'; end if;
    v_opts := v_opts || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name,
                'lat', round(v_lat::numeric, 5)::float8, 'lng', round(v_lng::numeric, 5)::float8));
  end loop;
  perform public.olnu_gang_rl('poll:' || p_group_id::text);
  -- An open poll past its 15 min is finished first (its winner becomes the call-out).
  for p in select * from public.gang_polls x where x.group_id = p_group_id and x.ended_at is null loop
    if p.ends_at > now() then raise exception 'poll_open'; end if;
    perform public.olnu_gang_poll_finish(p.id, v_uid);
  end loop;
  if exists (select 1 from public.gang_polls x where x.user_id = v_uid and x.created_at > now() - interval '2 minutes') then
    raise exception 'slow_down';
  end if;
  insert into public.gang_polls (group_id, user_id, night, options, ends_at)
  values (p_group_id, v_uid, public.olnu_night_of(now()), v_opts, now() + interval '15 minutes')
  returning * into p;
  -- The creator votes like everyone else (no automatic vote).
  return jsonb_build_object('id', p.id, 'ends_at', p.ends_at);
end; $$;

-- vote_bar_poll(poll, option 0-3) -> poll json. Change allowed until the end.
create or replace function public.vote_bar_poll(p_poll_id bigint, p_option int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  p public.gang_polls;
begin
  select * into p from public.gang_polls x where x.id = p_poll_id;
  if not found or not public.olnu_gang_member(p.group_id, v_uid) then raise exception 'poll_not_found'; end if;
  if p.ended_at is not null or p.ends_at <= now() then raise exception 'poll_ended'; end if;
  if p_option is null or p_option < 0 or p_option >= jsonb_array_length(p.options) then raise exception 'invalid_option'; end if;
  insert into public.gang_poll_votes (poll_id, user_id, opt) values (p.id, v_uid, p_option)
  on conflict (poll_id, user_id) do update set opt = excluded.opt, updated_at = now();
  return public.olnu_gang_poll_json(p, v_uid);
end; $$;

-- end_bar_poll(poll): the creator any time; any member after the 15 min. Idempotent.
-- Winner -> create_rally (as the caller): body "🗳️ Gänget har röstat: <bar>!", place + position of the bar.
-- -> poll json (+ fields winner, rally_id, rally_error).
create or replace function public.end_bar_poll(p_poll_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  p public.gang_polls;
begin
  select * into p from public.gang_polls x where x.id = p_poll_id;
  if not found or not public.olnu_gang_member(p.group_id, v_uid) then raise exception 'poll_not_found'; end if;
  if p.ended_at is null then
    if p.user_id <> v_uid and p.ends_at > now() then raise exception 'not_yours'; end if;
    perform public.olnu_gang_rl('poll:' || p.group_id::text);
    p := public.olnu_gang_poll_finish(p.id, v_uid);
  end if;
  return public.olnu_gang_poll_json(p, v_uid);
end; $$;

-- ---------------------------------------------------------------------------
-- 4. Bakisbrunchen
-- ---------------------------------------------------------------------------
-- create_brunch(group, place, place_id?, lat?, lng?, at 'HH:MM'?) -> {id}
-- Only 06:00-13:59 Europe/Stockholm (not_morning). Lives until 16:00 today (at least 2 h). One open brunch per group:
-- the caller's own older one is replaced; someone else's -> brunch_open. 1 new per 2 min per user.
create or replace function public.create_brunch(p_group_id uuid, p_place text, p_place_id text default null,
                                                p_lat float8 default null, p_lng float8 default null, p_at text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_place text := public.olnu_gang_clean(p_place);
  v_pid text := nullif(public.olnu_gang_clean(p_place_id), '');
  v_at text := nullif(public.olnu_gang_clean(p_at), '');
  v_h int := public.olnu_gang_hour();
  v_lat float8; v_lng float8;
  v_id bigint;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_h < 6 or v_h >= 14 then raise exception 'not_morning'; end if;
  if v_place = '' or char_length(v_place) > 60 or (v_pid is not null and char_length(v_pid) > 80)
     or (v_at is not null and v_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'invalid_brunch';
  end if;
  if public.olnu_world_ok(p_lat, p_lng) then v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8; end if;
  perform public.olnu_gang_rl('brunch:' || p_group_id::text);
  if exists (select 1 from public.gang_brunches b where b.user_id = v_uid and b.created_at > now() - interval '2 minutes') then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from public.gang_brunches b where b.group_id = p_group_id and not b.closed and b.expires_at > now() and b.user_id <> v_uid) then
    raise exception 'brunch_open';
  end if;
  update public.gang_brunches b set closed = true where b.group_id = p_group_id and b.user_id = v_uid and not b.closed;
  insert into public.gang_brunches (group_id, user_id, place, place_id, lat, lng, at_time, expires_at)
  values (p_group_id, v_uid, v_place, v_pid, v_lat, v_lng, v_at,
          greatest((((now() at time zone 'Europe/Stockholm')::date + time '16:00') at time zone 'Europe/Stockholm'),
                   now() + interval '2 hours'))
  returning id into v_id;
  insert into public.gang_brunch_answers (brunch_id, user_id, answer) values (v_id, v_uid, 'ja');
  return jsonb_build_object('id', v_id);
end; $$;

-- answer_brunch(brunch, 'ja'|'kanske'|'nej') -> brunch json
create or replace function public.answer_brunch(p_brunch_id bigint, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_answer, '')));
  b public.gang_brunches;
begin
  if v_a not in ('ja', 'kanske', 'nej') then raise exception 'invalid_answer'; end if;
  select * into b from public.gang_brunches x where x.id = p_brunch_id and not x.closed and x.expires_at > now();
  if not found or not public.olnu_gang_member(b.group_id, v_uid) then raise exception 'brunch_not_found'; end if;
  insert into public.gang_brunch_answers (brunch_id, user_id, answer) values (b.id, v_uid, v_a)
  on conflict (brunch_id, user_id) do update set answer = excluded.answer, updated_at = now();
  return public.olnu_gang_brunch_json(b, v_uid);
end; $$;

-- close_brunch(brunch): the creator ends it.
create or replace function public.close_brunch(p_brunch_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_id bigint;
begin
  update public.gang_brunches x set closed = true where x.id = p_brunch_id and x.user_id = v_uid returning x.id into v_id;
  if v_id is null then raise exception 'brunch_not_found'; end if;
  return jsonb_build_object('ok', true);
end; $$;

-- ---------------------------------------------------------------------------
-- 5. Kebabtoppen (food only)
-- ---------------------------------------------------------------------------
-- rate_kebab(place id, name, place lat/lng, stars 1-5, tag?, my lat/lng) -> {ok, is_new, avg, n, town}
-- Place: a bars_lite row of type fast_food/restaurant, or a "pl_" place id (places tiles). Bars/pubs -> not_food.
-- Caller within 2 km of the place (too_far). One rating per place per night (a second call changes it).
-- 1 call per 5 s per user (slow_down). Tags: whitelist below.
create or replace function public.rate_kebab(p_place_id text, p_name text, p_lat float8, p_lng float8, p_stars int,
                                             p_tag text default null, p_my_lat float8 default null, p_my_lng float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_pid text := public.olnu_gang_clean(p_place_id);
  v_name text := public.olnu_gang_clean(p_name);
  v_tag text := nullif(lower(public.olnu_gang_clean(p_tag)), '');
  v_night timestamptz := public.olnu_night_of(now());
  v_month date := date_trunc('month', now() at time zone 'Europe/Stockholm')::date;
  bl public.bars_lite;
  v_town text;
  v_new boolean;
  v_avg numeric; v_n int;
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'invalid_stars'; end if;
  if v_tag is not null and v_tag not in ('sas', 'storst', 'snabbast', 'krispigast', 'trevligast', 'prisvard', 'starkast', 'raddare') then
    raise exception 'invalid_tag';
  end if;
  if v_pid = '' or char_length(v_pid) > 80 then raise exception 'invalid_place'; end if;
  select * into bl from public.bars_lite b where b.id = v_pid;
  if found then
    if coalesce(bl.type, '') not in ('fast_food', 'restaurant') then raise exception 'not_food'; end if;
    p_lat := bl.lat; p_lng := bl.lng;
    v_name := coalesce(nullif(public.olnu_gang_clean(bl.name), ''), v_name);
  elsif v_pid !~ '^pl_-?[0-9]+_-?[0-9]+$' then
    raise exception 'not_food';
  end if;
  v_name := left(v_name, 60);
  if v_name = '' or not public.olnu_world_ok(p_lat, p_lng) then raise exception 'invalid_place'; end if;
  if not public.olnu_world_ok(p_my_lat, p_my_lng) or public.olnu_dist_m(p_lat, p_lng, p_my_lat, p_my_lng) > 2000 then
    raise exception 'too_far';
  end if;
  perform public.olnu_gang_rl('kebab:' || v_uid::text);
  if exists (select 1 from public.kebab_ratings k where k.user_id = v_uid and k.updated_at > now() - interval '5 seconds') then
    raise exception 'slow_down';
  end if;
  v_town := public.olnu_gang_town(p_lat, p_lng);
  v_new := not exists (select 1 from public.kebab_ratings k where k.user_id = v_uid and k.place_id = v_pid and k.night = v_night);
  insert into public.kebab_ratings (user_id, place_id, place_name, lat, lng, town, stars, tag, night, month)
  values (v_uid, v_pid, v_name, round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8, v_town, p_stars, v_tag, v_night, v_month)
  on conflict (user_id, place_id, night) do update set stars = excluded.stars, tag = excluded.tag, updated_at = now();
  select round(avg(x.stars)::numeric, 2), count(*)::int into v_avg, v_n
    from (select distinct on (k.user_id) k.stars from public.kebab_ratings k
           where k.place_id = v_pid and k.month = v_month order by k.user_id, k.updated_at desc) x;
  return jsonb_build_object('ok', true, 'is_new', v_new, 'avg', v_avg, 'n', v_n,
                            'town', case when left(v_town, 1) = '~' then null else v_town end);
end; $$;

-- kebab_top(lat, lng, month_offset 0|1) -> {town, month, list:[{rank, place_id, name, lat, lng, avg, n, tag, my_stars}]}
-- Town of the given point; this month (or last month). One vote per user per place per month (the latest).
-- Rank: avg desc, n desc, first rating. Top 10.
create or replace function public.kebab_top(p_lat float8, p_lng float8, p_month_offset int default 0)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_town text;
  v_month date := (date_trunc('month', now() at time zone 'Europe/Stockholm')
                   - make_interval(months => least(greatest(coalesce(p_month_offset, 0), 0), 12)))::date;
  v_list jsonb;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  v_town := public.olnu_gang_town(p_lat, p_lng);
  with latest as (
    select distinct on (k.user_id, k.place_id) k.* from public.kebab_ratings k
     where k.town = v_town and k.month = v_month
     order by k.user_id, k.place_id, k.updated_at desc
  ), agg as (
    select l.place_id, max(l.place_name) as name, avg(l.lat) as lat, avg(l.lng) as lng,
           round(avg(l.stars)::numeric, 2) as avg, count(*)::int as n, min(l.created_at) as first_at,
           (select l2.tag from latest l2 where l2.place_id = l.place_id and l2.tag is not null
             group by l2.tag order by count(*) desc, l2.tag limit 1) as tag,
           max(case when l.user_id = v_uid then l.stars end) as my_stars
      from latest l group by l.place_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', x.rk, 'place_id', x.place_id, 'name', x.name, 'lat', x.lat, 'lng', x.lng,
           'avg', x.avg, 'n', x.n, 'tag', x.tag, 'my_stars', x.my_stars) order by x.rk), '[]'::jsonb)
    into v_list
    from (select a.*, row_number() over (order by a.avg desc, a.n desc, a.first_at)::int as rk from agg a) x
   where x.rk <= 10;
  return jsonb_build_object('town', case when left(v_town, 1) = '~' then null else v_town end,
                            'month', v_month, 'list', v_list);
end; $$;

-- kebab_place(place id) -> {avg, n, my_stars, my_tag, rated_tonight, tags:[{tag, n}]} (this month)
create or replace function public.kebab_place(p_place_id text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_month date := date_trunc('month', now() at time zone 'Europe/Stockholm')::date;
  v_night timestamptz := public.olnu_night_of(now());
  r jsonb;
begin
  with latest as (
    select distinct on (k.user_id) k.* from public.kebab_ratings k
     where k.place_id = p_place_id and k.month = v_month order by k.user_id, k.updated_at desc
  )
  select jsonb_build_object(
    'avg', (select round(avg(l.stars)::numeric, 2) from latest l),
    'n', (select count(*) from latest l)::int,
    'my_stars', (select l.stars from latest l where l.user_id = v_uid),
    'my_tag', (select l.tag from latest l where l.user_id = v_uid),
    'rated_tonight', exists (select 1 from public.kebab_ratings k where k.user_id = v_uid and k.place_id = p_place_id and k.night = v_night),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('tag', t.tag, 'n', t.n) order by t.n desc)
                       from (select l.tag, count(*)::int n from latest l where l.tag is not null group by l.tag) t), '[]'::jsonb))
    into r;
  return r;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. Skuldboken
-- ---------------------------------------------------------------------------
-- add_debt(group, debtor key, creditor key, amount kr 1-50000, what 1-40) -> {id}
create or replace function public.add_debt(p_group_id uuid, p_debtor text, p_creditor text, p_amount int, p_what text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_d uuid; v_c uuid;
  v_what text := left(public.olnu_gang_clean(p_what), 40);
  v_id bigint;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  v_d := public.olnu_gang_uid_of(p_group_id, p_debtor);
  v_c := public.olnu_gang_uid_of(p_group_id, p_creditor);
  if v_d is null or v_c is null or v_d = v_c or p_amount is null or p_amount < 1 or p_amount > 50000 or v_what = '' then
    raise exception 'invalid_debt';
  end if;
  perform public.olnu_gang_rl('debt:' || v_uid::text);
  if exists (select 1 from public.gang_debts d where d.created_by = v_uid and d.created_at > now() - interval '3 seconds')
     or (select count(*) from public.gang_debts d where d.created_by = v_uid and d.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'slow_down';
  end if;
  insert into public.gang_debts (group_id, created_by, debtor, creditor, amount, what)
  values (p_group_id, v_uid, v_d, v_c, p_amount, v_what) returning id into v_id;
  return jsonb_build_object('id', v_id);
end; $$;

-- settle_debt(id, 'paid'|'unpaid'|'cancel') -> {ok}
-- paid: debtor, creditor or the writer. unpaid (undo within 24 h): same people. cancel: the writer or the creditor.
create or replace function public.settle_debt(p_debt_id bigint, p_action text default 'paid')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_action, '')));
  d public.gang_debts;
begin
  if v_a not in ('paid', 'unpaid', 'cancel') then raise exception 'invalid_action'; end if;
  select * into d from public.gang_debts x where x.id = p_debt_id and x.cancelled_at is null;
  if not found or not public.olnu_gang_member(d.group_id, v_uid) then raise exception 'debt_not_found'; end if;
  if v_a = 'cancel' then
    if v_uid not in (d.created_by, d.creditor) then raise exception 'not_yours'; end if;
    update public.gang_debts x set cancelled_at = now(), cancelled_by = v_uid where x.id = d.id;
  elsif v_a = 'paid' then
    if v_uid not in (d.created_by, d.creditor, d.debtor) then raise exception 'not_yours'; end if;
    update public.gang_debts x set paid_at = coalesce(x.paid_at, now()), paid_by = coalesce(x.paid_by, v_uid) where x.id = d.id;
  else
    if v_uid not in (d.created_by, d.creditor, d.debtor) then raise exception 'not_yours'; end if;
    if d.paid_at is null or d.paid_at < now() - interval '1 day' then raise exception 'too_late'; end if;
    update public.gang_debts x set paid_at = null, paid_by = null where x.id = d.id;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- set_swish(group, number) -> {number}. Swedish mobile only: 07xxxxxxxx (spaces, dashes and +46/0046 accepted).
-- '' or null clears it. Visible to the members of THIS group only. 20 changes per group per user.
create or replace function public.set_swish(p_group_id uuid, p_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v text := regexp_replace(coalesce(p_number, ''), '[\s\-().]', '', 'g');
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v like '+46%' then v := '0' || substr(v, 4); elsif v like '0046%' then v := '0' || substr(v, 5); end if;
  if v = '' then v := null;
  elsif v !~ '^07[0-9]{8}$' then raise exception 'invalid_swish';
  end if;
  if (select s.changes from public.gang_swish s where s.group_id = p_group_id and s.user_id = v_uid) >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.gang_swish (group_id, user_id, number, changes) values (p_group_id, v_uid, v, 1)
  on conflict (group_id, user_id) do update set number = excluded.number, changes = public.gang_swish.changes + 1, updated_at = now();
  return jsonb_build_object('number', v);
end; $$;

-- ---------------------------------------------------------------------------
-- 7. Morgontidningen: facts of the group's last night (no drink counts per person)
-- ---------------------------------------------------------------------------
-- gang_paper(group, p_night default null = the night that ended last) -> jsonb
-- {night, evening, group_name, town, out_n, members:[{k, name, is_me, out, bars, bar_names[], first_at, home_at,
--   skal, eta_max, rallies, mt_wins, quotes, kebab}], quotes:[{who, body}] (after 10:00), mt:[{q, names[]}],
--   takeovers:[bar names], crawl_done bool, ready bool}
create or replace function public.gang_paper(p_group_id uuid, p_night timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := coalesce(p_night, public.olnu_gang_last_night());
  v_mem jsonb; v_q jsonb; v_mt jsonb; v_take jsonb; v_town text; v_out int; v_crawl boolean := false;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_night > public.olnu_gang_last_night() then v_night := public.olnu_gang_last_night(); end if;
  with mem as (
    select m.user_id, m.display_name from public.group_members m where m.group_id = p_group_id
  ), mn as (
    select n.user_id, (n.beers + n.others) > 0 as out, n.first_at, n.home from public.medal_nights n
     where n.night = v_night and n.user_id in (select user_id from mem)
  ), an as (
    select a.user_id, a.out, a.town, a.home_at, a.skal_given from public.after_nights a
     where a.night = v_night and a.user_id in (select user_id from mem)
  ), bars as (
    select c.user_id, count(distinct c.bar_id)::int as n,
           (select jsonb_agg(distinct b.name) from public.medal_checkins c2 join public.bars_lite b on b.id = c2.bar_id
             where c2.user_id = c.user_id and c2.night = v_night and b.name is not null) as names
      from public.medal_checkins c
     where c.night = v_night and c.user_id in (select user_id from mem) group by c.user_id
  ), eta as (
    select e.user_id, max(e.minutes)::int as mx from public.etas e
     where e.user_id in (select user_id from mem) and public.olnu_night_of(e.created_at) = v_night and e.cancelled_at is null
     group by e.user_id
  ), ral as (
    select r.user_id, count(*)::int as n from public.rallies r
     where r.group_id = p_group_id and public.olnu_night_of(r.created_at) = v_night group by r.user_id
  ), rounds as (
    select r.* from public.gang_mt_rounds r where r.group_id = p_group_id and r.night = v_night
  ), mtw as (
    select w.target as user_id, count(*)::int as n from (
      select distinct on (v.round_id) v.round_id, v.target, count(*) over (partition by v.round_id, v.target) as c
        from public.gang_mt_votes v where v.round_id in (select id from rounds)
       order by v.round_id, c desc, v.target) w group by w.target
  ), kb as (
    select distinct on (k.user_id) k.user_id, k.place_name from public.kebab_ratings k
     where k.night = v_night and k.user_id in (select user_id from mem) order by k.user_id, k.stars desc, k.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_gang_k(p_group_id, m.user_id), 'name', m.display_name, 'is_me', m.user_id = v_uid,
           'out', coalesce(mn.out, false) or coalesce(an.out, false) or coalesce(b.n, 0) > 0,
           'bars', coalesce(b.n, 0), 'bar_names', coalesce(b.names, '[]'::jsonb),
           'first_at', mn.first_at,
           'home_at', coalesce(an.home_at, case when mn.home then v_night end),
           'skal', coalesce(an.skal_given, 0), 'eta_max', e.mx, 'rallies', coalesce(r.n, 0),
           'mt_wins', coalesce(w.n, 0),
           'quotes', (select count(*) from public.gang_quotes q where q.group_id = p_group_id and q.night = v_night
                       and not q.hidden and lower(q.who) = lower(m.display_name))::int,
           'kebab', kb.place_name) order by m.display_name), '[]'::jsonb),
         (select a.town from an a where a.town is not null group by a.town order by count(*) desc, a.town limit 1)
    into v_mem, v_town
    from mem m
    left join mn on mn.user_id = m.user_id left join an on an.user_id = m.user_id
    left join bars b on b.user_id = m.user_id left join eta e on e.user_id = m.user_id
    left join ral r on r.user_id = m.user_id left join mtw w on w.user_id = m.user_id
    left join kb on kb.user_id = m.user_id;

  select count(*)::int into v_out from jsonb_array_elements(v_mem) x where (x.value ->> 'out')::boolean;

  select coalesce(jsonb_agg(jsonb_build_object('who', q.who, 'body', q.body) order by q.id), '[]'::jsonb) into v_q
    from (select * from public.gang_quotes q where q.group_id = p_group_id and q.night = v_night and not q.hidden
            and q.reveal_at <= now() order by q.id limit 8) q;

  select coalesce(jsonb_agg(jsonb_build_object('q', r.q, 'names', (
           select coalesce(jsonb_agg(public.olnu_gang_name(p_group_id, x.target) order by x.target), '[]'::jsonb) from (
             select v.target, count(*) c, max(count(*)) over () mx from public.gang_mt_votes v
              where v.round_id = r.id group by v.target) x where x.c = x.mx)) order by r.id), '[]'::jsonb)
    into v_mt
    from public.gang_mt_rounds r where r.group_id = p_group_id and r.night = v_night
     and exists (select 1 from public.gang_mt_votes v where v.round_id = r.id);

  begin
    select coalesce(jsonb_agg(distinct t.bar_name), '[]'::jsonb) into v_take
      from public.bar_takeovers t where t.group_id = p_group_id and t.night = v_night and t.bar_name is not null;
  exception when others then v_take := '[]'::jsonb;
  end;
  begin
    select exists (select 1 from public.game_crawls c where c.group_id = p_group_id and c.night = v_night and c.done_at is not null)
      into v_crawl;
  exception when others then v_crawl := false;
  end;

  return jsonb_build_object('night', v_night, 'evening', public.olnu_evening(v_night),
    'group_name', (select g.name from public.groups g where g.id = p_group_id),
    'town', v_town, 'out_n', v_out, 'members', v_mem, 'quotes', v_q, 'mt', v_mt,
    'takeovers', coalesce(v_take, '[]'::jsonb), 'crawl_done', coalesce(v_crawl, false), 'ready', v_out > 0);
end; $$;

-- ---------------------------------------------------------------------------
-- Group state + light poll
-- ---------------------------------------------------------------------------
-- gang_group(group) -> {server_time, night, hour, members:[{k, name, is_me}], mt:{round, history[]},
--   poll (newest of tonight, open or ended < 60 min) | null, brunch (open) | null,
--   quotes:{pending (tonight, group, hidden until reveal), mine_pending, next_reveal, yesterday:[...]}, debts}
-- An open poll past its 15 min is finished here (winner -> call-out).
create or replace function public.gang_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_last timestamptz := public.olnu_gang_last_night();
  p public.gang_polls;
  r public.gang_mt_rounds;
  b public.gang_brunches;
  v_round jsonb := null; v_hist jsonb; v_poll jsonb := null; v_brunch jsonb := null;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  for p in select * from public.gang_polls x where x.group_id = p_group_id and x.ended_at is null and x.ends_at <= now() loop
    perform public.olnu_gang_rl('poll:' || p_group_id::text);
    perform public.olnu_gang_poll_finish(p.id, v_uid);
  end loop;
  select * into r from public.gang_mt_rounds x where x.group_id = p_group_id and x.night = v_night order by x.id desc limit 1;
  if found then v_round := public.olnu_gang_mt_json(r, v_uid); end if;
  select coalesce(jsonb_agg(public.olnu_gang_mt_json(x, v_uid) order by x.id desc), '[]'::jsonb) into v_hist
    from (select * from public.gang_mt_rounds y where y.group_id = p_group_id and y.night = v_night order by y.id desc limit 20) x;
  select * into p from public.gang_polls x
   where x.group_id = p_group_id and (x.ended_at is null or x.ended_at > now() - interval '60 minutes')
   order by x.id desc limit 1;
  if found then v_poll := public.olnu_gang_poll_json(p, v_uid); end if;
  select * into b from public.gang_brunches x where x.group_id = p_group_id and not x.closed and x.expires_at > now()
   order by x.id desc limit 1;
  if found then v_brunch := public.olnu_gang_brunch_json(b, v_uid); end if;
  return jsonb_build_object(
    'server_time', now(), 'night', v_night, 'last_night', v_last, 'hour', public.olnu_gang_hour(),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group_id, m.user_id),
                  'name', m.display_name, 'is_me', m.user_id = v_uid) order by m.user_id <> v_uid, m.display_name), '[]'::jsonb)
                  from public.group_members m where m.group_id = p_group_id),
    'mt', jsonb_build_object('round', v_round, 'history', v_hist),
    'poll', v_poll, 'brunch', v_brunch,
    'quotes', jsonb_build_object(
      'pending', (select count(*) from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.reveal_at > now())::int,
      'next_reveal', (select min(q.reveal_at) from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.reveal_at > now()),
      'yesterday', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'who', q.who, 'body', q.body, 'at', q.created_at) order by q.id), '[]'::jsonb)
                      from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.night = v_last and q.reveal_at <= now())),
    'debts', public.olnu_gang_debts_json(p_group_id, v_uid));
end; $$;

-- gang_poll() -> {v, server_time, night, last_night, hour, groups:[{id, name, mt_open, mt_voted, mt_last, poll_open, poll_id,
--   poll_voted, poll_winner (bar name, ended < 60 min), poll_due, brunch:{id, by, place, at_time, mine}|null, quotes_pending, quotes_yday, paper, debt_net}]} (max 20 groups)
create or replace function public.gang_poll()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_last timestamptz := public.olnu_gang_last_night();
  v_groups jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.joined), '[]'::jsonb) into v_groups from (
    select gm.joined_at as joined, jsonb_build_object(
      'id', g.id, 'name', g.name,
      'mt_open', exists (select 1 from public.gang_mt_rounds r where r.group_id = g.id and r.night = v_night and not public.olnu_gang_mt_done(r)),
      'mt_voted', exists (select 1 from public.gang_mt_rounds r join public.gang_mt_votes v on v.round_id = r.id and v.voter = v_uid
                           where r.group_id = g.id and r.night = v_night and not public.olnu_gang_mt_done(r)),
      'mt_last', (select r.id from public.gang_mt_rounds r where r.group_id = g.id and r.night = v_night order by r.id desc limit 1),
      'poll_open', exists (select 1 from public.gang_polls p where p.group_id = g.id and p.ended_at is null and p.ends_at > now()),
      'poll_id', (select p.id from public.gang_polls p where p.group_id = g.id and (p.ended_at is null or p.ended_at > now() - interval '60 minutes') order by p.id desc limit 1),
      'poll_voted', exists (select 1 from public.gang_polls p join public.gang_poll_votes v on v.poll_id = p.id and v.user_id = v_uid
                             where p.group_id = g.id and p.ended_at is null and p.ends_at > now()),
      'poll_winner', (select p.options -> p.winner ->> 'name' from public.gang_polls p
                       where p.group_id = g.id and p.ended_at > now() - interval '60 minutes' and p.winner is not null
                       order by p.id desc limit 1),
      'poll_due', exists (select 1 from public.gang_polls p where p.group_id = g.id and p.ended_at is null and p.ends_at <= now()),
      'brunch', (select jsonb_build_object('id', b.id, 'by', public.olnu_gang_name(g.id, b.user_id), 'by_me', b.user_id = v_uid,
                   'place', b.place, 'at_time', b.at_time,
                   'mine', (select a.answer from public.gang_brunch_answers a where a.brunch_id = b.id and a.user_id = v_uid),
                   'ja', (select count(*) from public.gang_brunch_answers a join public.group_members m2 on m2.group_id = g.id and m2.user_id = a.user_id
                           where a.brunch_id = b.id and a.answer = 'ja')::int)
                   from public.gang_brunches b where b.group_id = g.id and not b.closed and b.expires_at > now() order by b.id desc limit 1),
      'quotes_pending', (select count(*) from public.gang_quotes q where q.group_id = g.id and not q.hidden and q.reveal_at > now())::int,
      'quotes_yday', (select count(*) from public.gang_quotes q where q.group_id = g.id and not q.hidden and q.night = v_last and q.reveal_at <= now())::int,
      'paper', exists (select 1 from public.group_members m3
                        where m3.group_id = g.id and (
                          exists (select 1 from public.medal_nights n where n.user_id = m3.user_id and n.night = v_last and n.beers + n.others > 0)
                          or exists (select 1 from public.medal_checkins c where c.user_id = m3.user_id and c.night = v_last))),
      'debt_net', (select coalesce(sum(case when d.creditor = v_uid then d.amount else -d.amount end), 0)::int
                     from public.gang_debts d where d.group_id = g.id and d.paid_at is null and d.cancelled_at is null
                      and (d.creditor = v_uid or d.debtor = v_uid)
                      and d.debtor in (select m4.user_id from public.group_members m4 where m4.group_id = g.id)
                      and d.creditor in (select m4.user_id from public.group_members m4 where m4.group_id = g.id))
    ) as j
    from public.group_members gm join public.groups g on g.id = gm.group_id
   where gm.user_id = v_uid
   order by gm.joined_at limit 20) x;
  return jsonb_build_object('v', 1, 'server_time', now(), 'night', v_night, 'last_night', v_last,
                            'hour', public.olnu_gang_hour(), 'groups', v_groups);
end; $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  internal text[] := array[
    'public.olnu_gang_clean(text)', 'public.olnu_gang_k(uuid, uuid)', 'public.olnu_gang_member(uuid, uuid)',
    'public.olnu_gang_uid_of(uuid, text)', 'public.olnu_gang_name(uuid, uuid)', 'public.olnu_gang_last_night()',
    'public.olnu_gang_reveal(timestamptz)', 'public.olnu_gang_hour()', 'public.olnu_gang_town(float8, float8)',
    'public.olnu_gang_rl(text)', 'public.olnu_gang_mt_done(public.gang_mt_rounds)',
    'public.olnu_gang_mt_json(public.gang_mt_rounds, uuid)', 'public.olnu_gang_poll_json(public.gang_polls, uuid)',
    'public.olnu_gang_poll_winner(public.gang_polls)', 'public.olnu_gang_poll_finish(bigint, uuid)',
    'public.olnu_gang_brunch_json(public.gang_brunches, uuid)', 'public.olnu_gang_debts_json(uuid, uuid)'];
  rpcs text[] := array[
    'public.add_quote(uuid, text, text, bigint)', 'public.hide_quote(bigint)', 'public.gang_quotes(uuid, bigint)',
    'public.mt_start(uuid, int)', 'public.mt_vote(bigint, text)', 'public.mt_close(bigint)',
    'public.create_bar_poll(uuid, jsonb)', 'public.vote_bar_poll(bigint, int)', 'public.end_bar_poll(bigint)',
    'public.create_brunch(uuid, text, text, float8, float8, text)', 'public.answer_brunch(bigint, text)', 'public.close_brunch(bigint)',
    'public.rate_kebab(text, text, float8, float8, int, text, float8, float8)', 'public.kebab_top(float8, float8, int)',
    'public.kebab_place(text)',
    'public.add_debt(uuid, text, text, int, text)', 'public.settle_debt(bigint, text)', 'public.set_swish(uuid, text)',
    'public.gang_paper(uuid, timestamptz)', 'public.gang_group(uuid)', 'public.gang_poll()'];
begin
  foreach f in array internal || rpcs loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach f in array rpcs loop
      execute format('grant execute on function %s to authenticated', f);
    end loop;
  end if;
end $$;
