-- Öl Nu v12: KROGARNA (omgång 1). Additive. Safe to run again.
-- 1. Kö-rapport: "Ingen kö / Kort kö / Lång kö" (+ optional entry price) per bar. A report lives 30 min.
-- 2. Kvällens erbjudande: short offer text per bar for tonight (until 05:00), 👍 / 👎 votes.
--    Legal (Alkohollagen 7 kap.): offers are user-written and passive. They are only returned by
--    bar_status() for the bar popup: no push, no ticker, no medal for offers.
-- 3. Ölsorter: optional beer type for the caller's latest beer tonight + anonymous type stats.
-- 4. Ta över krogen: the group with most people at a bar tonight "owns" it. Group name is public
--    only when the group opted in (group_flags.show_on_map, default off).
-- 5. Krogtips: "📣 Anton tipsar: Kom till Pitchers!" as a group chat message (+ push by notify-group).
-- 6. Four new medals (olnu_medal_eval_bars, merged into olnu_medal_store; same return type).
-- No old RPC, parameter or returned field changes. Old rows are never removed: every read filters on
-- time (expires_at / night). This file has no remove-type statements on purpose (create-or-replace,
-- "if not exists", "on conflict" only).
-- Needs 0001-0013 first. Postgres 14+.

-- ---------------------------------------------------------------------------
-- 1. Tables (RLS on, no policies; only SECURITY DEFINER functions and the service role use them)
-- ---------------------------------------------------------------------------

-- Queue reports. bar_lat/bar_lng = the bar position the client sent (bars.json).
create table if not exists public.bar_queue (
  id         bigserial primary key,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  user_id    uuid not null,
  queue      text not null check (queue in ('none', 'short', 'long')),
  entry      text check (entry in ('free', 'low', 'high')),
  bar_lat    float8 not null,
  bar_lng    float8 not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);
create index if not exists bar_queue_bar_idx on public.bar_queue (bar_id, expires_at);
create index if not exists bar_queue_exp_idx on public.bar_queue (expires_at);
create index if not exists bar_queue_user_idx on public.bar_queue (user_id, bar_id, created_at);

-- Tonight's offers. night = the 05:00 expiry.
create table if not exists public.bar_offers (
  id         bigserial primary key,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  bar_name   text not null check (char_length(bar_name) between 1 and 60),
  user_id    uuid not null,
  body       text not null check (char_length(body) between 1 and 60),
  bar_lat    float8 not null,
  bar_lng    float8 not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default public.olnu_next_expiry()
);
create index if not exists bar_offers_bar_idx on public.bar_offers (bar_id, expires_at);
create index if not exists bar_offers_exp_idx on public.bar_offers (expires_at);
create index if not exists bar_offers_user_idx on public.bar_offers (user_id, expires_at);

-- Votes on offers: 1 = "👍 stämmer", -1 = "👎 stämmer inte", 0 = taken back.
create table if not exists public.bar_offer_votes (
  offer_id   bigint not null,
  user_id    uuid not null,
  vote       smallint not null check (vote in (-1, 0, 1)),
  updated_at timestamptz not null default now(),
  primary key (offer_id, user_id)
);

-- Beer type per beer (n = beer number tonight). lat/lng rounded to 0.01 (~1 km), only for town stats.
create table if not exists public.beer_types (
  user_id    uuid not null,
  night      timestamptz not null,
  n          int not null,
  type       text not null check (type in ('lager', 'pilsner', 'ipa', 'apa', 'stout', 'vete', 'ale', 'sour', 'alkfri', 'annan')),
  lat        float8,
  lng        float8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, night, n)
);
create index if not exists beer_types_night_idx on public.beer_types (night);
create index if not exists beer_types_created_idx on public.beer_types (created_at);

-- Group settings. show_on_map: the group name may be shown to everyone on a bar it owns.
create table if not exists public.group_flags (
  group_id    uuid primary key,
  show_on_map boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Takeover log (one row per group per bar per night). Used for the push and the "Erövraren" medal.
create table if not exists public.bar_takeovers (
  id         bigserial primary key,
  group_id   uuid not null,
  bar_id     text not null,
  bar_name   text,
  night      timestamptz not null,
  n          int not null default 0,
  created_at timestamptz not null default now(),
  notified   boolean not null default false,
  unique (group_id, bar_id, night)
);
create index if not exists bar_takeovers_group_idx on public.bar_takeovers (group_id, created_at);

-- Bar tips sent to a group (the chat row is in group_msgs).
create table if not exists public.bar_tips (
  id         bigserial primary key,
  user_id    uuid not null,
  group_id   uuid not null,
  bar_id     text not null check (char_length(bar_id) between 1 and 80),
  bar_name   text not null check (char_length(bar_name) between 1 and 60),
  body       text,
  msg_id     bigint,
  created_at timestamptz not null default now(),
  notified   boolean not null default false
);
create index if not exists bar_tips_user_idx on public.bar_tips (user_id, created_at);

alter table public.bar_queue       enable row level security;
alter table public.bar_offers      enable row level security;
alter table public.bar_offer_votes enable row level security;
alter table public.beer_types      enable row level security;
alter table public.group_flags     enable row level security;
alter table public.bar_takeovers   enable row level security;
alter table public.bar_tips        enable row level security;

revoke all on table public.bar_queue, public.bar_offers, public.bar_offer_votes, public.beer_types,
  public.group_flags, public.bar_takeovers, public.bar_tips from public;
revoke all on sequence public.bar_queue_id_seq, public.bar_offers_id_seq, public.bar_takeovers_id_seq,
  public.bar_tips_id_seq from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.bar_queue, public.bar_offers, public.bar_offer_votes, public.beer_types, public.group_flags, public.bar_takeovers, public.bar_tips from anon';
    execute 'revoke all on sequence public.bar_queue_id_seq, public.bar_offers_id_seq, public.bar_takeovers_id_seq, public.bar_tips_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.bar_queue, public.bar_offers, public.bar_offer_votes, public.beer_types, public.group_flags, public.bar_takeovers, public.bar_tips from authenticated';
    execute 'revoke all on sequence public.bar_queue_id_seq, public.bar_offers_id_seq, public.bar_takeovers_id_seq, public.bar_tips_id_seq from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.bar_queue, public.bar_offers, public.bar_offer_votes, public.beer_types, public.group_flags, public.bar_takeovers, public.bar_tips to service_role';
    execute 'grant all on sequence public.bar_queue_id_seq, public.bar_offers_id_seq, public.bar_takeovers_id_seq, public.bar_tips_id_seq to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers (internal, not callable by clients)
-- ---------------------------------------------------------------------------

-- Control chars -> space, runs of spaces -> one, trimmed.
create or replace function public.olnu_bp_clean(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- true when (lat, lng) is a real point inside the Sweden bbox.
create or replace function public.olnu_bp_in_sweden(p_lat float8, p_lng float8)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between 55.0 and 69.1 and p_lng between 10.9 and 24.2;
$$;

-- Checks a bar + the caller's position. Raises invalid_bar, outside_sweden or too_far (> 300 m).
create or replace function public.olnu_bp_check(p_bar_id text, p_bar_name text, p_bar_lat float8, p_bar_lng float8,
                                                p_lat float8, p_lng float8)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_id   text := public.olnu_bp_clean(p_bar_id);
  v_name text := public.olnu_bp_clean(p_bar_name);
begin
  if char_length(v_id) < 1 or char_length(v_id) > 80 or char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'invalid_bar';
  end if;
  if not public.olnu_bp_in_sweden(p_bar_lat, p_bar_lng) or not public.olnu_bp_in_sweden(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if public.olnu_dist_m(p_bar_lat, p_bar_lng, p_lat, p_lng) > 300 then
    raise exception 'too_far';
  end if;
end;
$$;

-- true when a short public text has a link, an e-mail, a phone number or a bad word.
create or replace function public.olnu_bp_blocked(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p, '') ~* '(https?:|www\.|://|@|\.(se|com|nu|net|org|io|app|info|biz|ly|me|co|eu)(\M|/))'
      or regexp_replace(coalesce(p, ''), '[\s().+–-]', '', 'g') ~ '[0-9]{7,}'
      or coalesce(p, '') ~* '\m(hora|horor|horan|fitta|fittor|fittan|kuk|kukar|kuken|knulla|knullar|neger|negrer|nigger|niggers|nigga|blatte|blattar|svartskalle|zigge|bögjävel|retard|mongo|cunt|whore|faggot|nazi|sieg heil|våldta|våldtäkt|rape|kill yourself)\M';
$$;

-- Bar ids from tonight's check-ins and "Kung av baren" taps, with the bar position.
-- Precise live beers within 75 m of the nearest such bar count as "at the bar".
-- olnu_takeovers() -> (bar_id, bar_name, group_id, n, since): the owner group of each bar tonight.
-- Owner = the group with most different members at the bar (at least 2); a member is at one bar only
-- (the newest of his check-in and his precise beer). Tie: the group that got there first keeps it.
create or replace function public.olnu_takeovers()
returns table (bar_id text, bar_name text, group_id uuid, n int, since timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz := public.olnu_next_expiry() - interval '24 hours';
begin
  return query
  with cand as (
    select distinct on (x.bid) x.bid, x.bname, x.blat, x.blng from (
      select c.bar_id as bid, c.bar_name as bname, c.lat as blat, c.lng as blng, c.created_at as at
        from public.checkins c where c.expires_at > now()
      union all
      select t.bar_id, t.bar_name, t.lat, t.lng, t.last_at
        from public.bar_taps t
       where t.last_at >= v_start and t.lat is not null and t.lng is not null
         and t.week >= public.olnu_week_start(now()) - 7
    ) x
    order by x.bid, x.at desc
  ),
  pres as (
    select c.user_id as uid, c.bar_id as bid, c.created_at as at
      from public.checkins c
     where c.expires_at > now()
    union all
    select b.user_id, nb.bid, coalesce(b.beer_at, b.updated_at)
      from public.beers b
      cross join lateral (
        select cb.bid from cand cb
         where abs(cb.blat - b.lat) < 0.001 and abs(cb.blng - b.lng) < 0.002
           and public.olnu_dist_m(cb.blat, cb.blng, b.lat, b.lng) <= 75
         order by public.olnu_dist_m(cb.blat, cb.blng, b.lat, b.lng)
         limit 1
      ) nb
     where b.expires_at > now() and not b.stopped and b.precise and b.beer_count >= 1
  ),
  one as (
    select distinct on (p.uid) p.uid, p.bid, p.at from pres p order by p.uid, p.at desc
  ),
  gp as (
    select o.bid, gm.group_id as gid, count(distinct o.uid)::int as cnt, min(o.at) as first_at
      from one o
      join public.group_members gm on gm.user_id = o.uid
     group by o.bid, gm.group_id
    having count(distinct o.uid) >= 2
  ),
  ranked as (
    select gp.*, row_number() over (partition by gp.bid order by gp.cnt desc, gp.first_at asc, gp.gid) as rn
      from gp
  )
  select r.bid, cand.bname, r.gid, r.cnt, r.first_at
    from ranked r
    left join cand on cand.bid = r.bid
   where r.rn = 1;
end;
$$;

-- Can the user change this group's settings? The creator; if the creator left: the oldest member.
create or replace function public.olnu_group_admin(p_group_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = p_uid)
     and (
       exists (select 1 from public.groups g where g.id = p_group_id and g.created_by = p_uid)
       or (
         not exists (select 1 from public.groups g join public.group_members m on m.group_id = g.id and m.user_id = g.created_by
                      where g.id = p_group_id)
         and p_uid = (select m.user_id from public.group_members m where m.group_id = p_group_id
                       order by m.joined_at, m.user_id limit 1)
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- report_queue(bar, bar position, caller position, queue, entry) -> jsonb {ok, wait_seconds, queue, entry, reports}
-- queue: none | short | long (else invalid_queue). entry: null/'' | free | low (< 100 kr) | high (100+ kr)
-- (else invalid_entry). Caller within 300 m of the bar (else too_far). 1 report per user per bar per 10 min:
-- ok=false + wait_seconds. A report lives 30 min. Returns the bar's current queue after the call.
create or replace function public.report_queue(p_bar_id text, p_bar_name text, p_bar_lat float8, p_bar_lng float8,
                                               p_lat float8, p_lng float8, p_queue text, p_entry text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_id    text := public.olnu_bp_clean(p_bar_id);
  v_q     text := lower(btrim(coalesce(p_queue, '')));
  v_e     text := nullif(lower(btrim(coalesce(p_entry, ''))), '');
  v_last  timestamptz;
  v_ok    boolean := true;
  v_wait  int := 0;
  v_res   record;
begin
  if v_q not in ('none', 'short', 'long') then raise exception 'invalid_queue'; end if;
  if v_e is not null and v_e not in ('free', 'low', 'high') then raise exception 'invalid_entry'; end if;
  perform public.olnu_bp_check(p_bar_id, p_bar_name, p_bar_lat, p_bar_lng, p_lat, p_lng);

  perform pg_advisory_xact_lock(hashtextextended('olnu_queue:' || v_uid::text, 0));
  select max(q.created_at) into v_last from public.bar_queue q
   where q.user_id = v_uid and q.bar_id = v_id and q.created_at > now() - interval '10 minutes';
  if v_last is not null then
    v_ok := false;
    v_wait := greatest(1, ceil(extract(epoch from (v_last + interval '10 minutes' - now())))::int);
  else
    insert into public.bar_queue (bar_id, user_id, queue, entry, bar_lat, bar_lng)
    values (v_id, v_uid, v_q, v_e, round(p_bar_lat::numeric, 5)::float8, round(p_bar_lng::numeric, 5)::float8);
  end if;

  select * into v_res from public.olnu_bar_queue_now(v_id);
  return jsonb_build_object('ok', v_ok, 'wait_seconds', v_wait, 'queue', v_res.queue, 'entry', v_res.entry,
                            'reports', coalesce(v_res.reports, 0));
end;
$$;

-- Current queue of one bar: the answer with most live reports; tie -> the newest report wins.
create or replace function public.olnu_bar_queue_now(p_bar_id text)
returns table (queue text, entry text, reports int, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select q.queue, q.entry, q.created_at from public.bar_queue q
     where q.bar_id = p_bar_id and q.expires_at > now()
  )
  select (select l.queue from live l group by l.queue order by count(*) desc, max(l.created_at) desc limit 1),
         (select l.entry from live l where l.entry is not null group by l.entry order by count(*) desc, max(l.created_at) desc limit 1),
         (select count(*)::int from live),
         (select max(l.created_at) from live l);
$$;

-- add_offer(bar, bar position, caller position, body) -> jsonb {ok, id}
-- Body cleaned, 3-60 chars (else invalid_offer). Links, e-mails, phone numbers, bad words -> offer_blocked.
-- Caller within 300 m (else too_far). Max 2 new offers per user per night -> slow_down.
-- The same text twice at the same bar tonight -> the old offer id comes back (ok=true).
create or replace function public.add_offer(p_bar_id text, p_bar_name text, p_bar_lat float8, p_bar_lng float8,
                                            p_lat float8, p_lng float8, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := public.olnu_bp_clean(p_bar_id);
  v_name text := public.olnu_bp_clean(p_bar_name);
  v_body text := public.olnu_bp_clean(p_body);
  v_n    int;
  v_old  bigint;
  v_new  bigint;
begin
  if char_length(v_body) < 3 or char_length(v_body) > 60 then raise exception 'invalid_offer'; end if;
  if public.olnu_bp_blocked(v_body) then raise exception 'offer_blocked'; end if;
  perform public.olnu_bp_check(p_bar_id, p_bar_name, p_bar_lat, p_bar_lng, p_lat, p_lng);

  perform pg_advisory_xact_lock(hashtextextended('olnu_offer:' || v_uid::text, 0));
  select o.id into v_old from public.bar_offers o
   where o.bar_id = v_id and o.expires_at > now() and lower(o.body) = lower(v_body)
   order by o.id limit 1;
  if v_old is not null then
    return jsonb_build_object('ok', true, 'id', v_old, 'is_new', false);
  end if;
  select count(*) into v_n from public.bar_offers o where o.user_id = v_uid and o.expires_at > now();
  if v_n >= 2 then raise exception 'slow_down'; end if;

  insert into public.bar_offers (bar_id, bar_name, user_id, body, bar_lat, bar_lng, expires_at)
  values (v_id, v_name, v_uid, v_body, round(p_bar_lat::numeric, 5)::float8, round(p_bar_lng::numeric, 5)::float8,
          public.olnu_next_expiry())
  returning id into v_new;
  return jsonb_build_object('ok', true, 'id', v_new, 'is_new', true);
end;
$$;

-- vote_offer(p_offer_id, p_vote) -> jsonb {up, down, mine, hidden}
-- p_vote: 1 (👍), -1 (👎), 0 (take back); else invalid_vote. Offer must be live (else offer_not_found).
-- Own offer -> own_offer. hidden = 3 or more 👎 than 👍.
create or replace function public.vote_offer(p_offer_id bigint, p_vote int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_o   public.bar_offers%rowtype;
  v_up  int; v_dn int; v_me int;
begin
  if p_vote is null or p_vote not in (-1, 0, 1) then raise exception 'invalid_vote'; end if;
  select * into v_o from public.bar_offers o where o.id = p_offer_id and o.expires_at > now();
  if not found then raise exception 'offer_not_found'; end if;
  if v_o.user_id = v_uid then raise exception 'own_offer'; end if;
  insert into public.bar_offer_votes as v (offer_id, user_id, vote, updated_at)
  values (p_offer_id, v_uid, p_vote, now())
  on conflict (offer_id, user_id) do update set vote = excluded.vote, updated_at = now();
  select count(*) filter (where v.vote = 1), count(*) filter (where v.vote = -1)
    into v_up, v_dn from public.bar_offer_votes v where v.offer_id = p_offer_id;
  v_me := p_vote;
  return jsonb_build_object('up', v_up, 'down', v_dn, 'mine', v_me, 'hidden', (v_dn - v_up) >= 3);
end;
$$;

-- bar_status() -> setof (bar_id, queue, queue_at, queue_n, entry, offers jsonb, owner_name, owner_n,
--                       owner_mine, owner_named)
-- One row per bar with live queue reports, live (not hidden) offers or an owner group tonight. Max 2000.
-- offers: up to 3, best first: [{id, body, up, down, my_vote, is_mine, at}]. Hidden offers (3+ more 👎
-- than 👍) are left out. owner_name: the group name when the group opted in (group_flags.show_on_map)
-- or the caller is a member; else null ("En grupp"). owner_named = the group opted in.
create or replace function public.bar_status()
returns table (bar_id text, queue text, queue_at timestamptz, queue_n int, entry text, offers jsonb,
               owner_name text, owner_n int, owner_mine bool, owner_named bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with q as (
    select x.bar_id as bid,
           (select l.queue from public.bar_queue l where l.bar_id = x.bar_id and l.expires_at > now()
             group by l.queue order by count(*) desc, max(l.created_at) desc limit 1) as qv,
           (select l.entry from public.bar_queue l where l.bar_id = x.bar_id and l.expires_at > now() and l.entry is not null
             group by l.entry order by count(*) desc, max(l.created_at) desc limit 1) as ev,
           max(x.created_at) as qat, count(*)::int as qn
      from public.bar_queue x
     where x.expires_at > now()
     group by x.bar_id
  ),
  ov as (
    select o.id, o.bar_id as bid, o.body, o.user_id, o.created_at,
           coalesce(sum(case when v.vote = 1 then 1 else 0 end), 0)::int as up,
           coalesce(sum(case when v.vote = -1 then 1 else 0 end), 0)::int as dn,
           coalesce(max(case when v.user_id = v_uid then v.vote end), 0)::int as mv
      from public.bar_offers o
      left join public.bar_offer_votes v on v.offer_id = o.id
     where o.expires_at > now()
     group by o.id
  ),
  ovr as (
    select ov.*, row_number() over (partition by ov.bid order by (ov.up - ov.dn) desc, ov.created_at desc, ov.id) as rn
      from ov where (ov.dn - ov.up) < 3
  ),
  oj as (
    select ovr.bid, jsonb_agg(jsonb_build_object('id', ovr.id, 'body', ovr.body, 'up', ovr.up, 'down', ovr.dn,
             'my_vote', ovr.mv, 'is_mine', ovr.user_id = v_uid, 'at', ovr.created_at) order by ovr.rn) as js
      from ovr where ovr.rn <= 3 group by ovr.bid
  ),
  tk as (
    select t.bar_id as bid, t.group_id as gid, t.n as cnt,
           coalesce(f.show_on_map, false) as named,
           exists (select 1 from public.group_members m where m.group_id = t.group_id and m.user_id = v_uid) as mine
      from public.olnu_takeovers() t
      left join public.group_flags f on f.group_id = t.group_id
  ),
  ids as (select q.bid from q union select oj.bid from oj union select tk.bid from tk)
  select ids.bid, q.qv, q.qat, coalesce(q.qn, 0), q.ev, coalesce(oj.js, '[]'::jsonb),
         case when tk.gid is not null and (tk.named or tk.mine) then (select g.name from public.groups g where g.id = tk.gid) end,
         coalesce(tk.cnt, 0), coalesce(tk.mine, false), coalesce(tk.named, false)
    from ids
    left join q on q.bid = ids.bid
    left join oj on oj.bid = ids.bid
    left join tk on tk.bid = ids.bid
   order by ids.bid
   limit 2000;
end;
$$;

-- note_takeover(p_bar_id) -> jsonb {ok, is_new}
-- The client calls this when bar_status says the caller's group owns a bar. ok = one of the caller's
-- groups owns it now. is_new = first time tonight for that group and bar (then call notify-group
-- {event:"takeover", bar_id}).
create or replace function public.note_takeover(p_bar_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_id  text := public.olnu_bp_clean(p_bar_id);
  v_t   record;
  v_new int := 0;
begin
  select t.* into v_t from public.olnu_takeovers() t
   where t.bar_id = v_id
     and exists (select 1 from public.group_members m where m.group_id = t.group_id and m.user_id = v_uid);
  if not found then
    return jsonb_build_object('ok', false, 'is_new', false);
  end if;
  insert into public.bar_takeovers (group_id, bar_id, bar_name, night, n)
  values (v_t.group_id, v_id, left(v_t.bar_name, 60), public.olnu_next_expiry(), v_t.n)
  on conflict (group_id, bar_id, night) do update set n = greatest(public.bar_takeovers.n, excluded.n)
  returning (xmax = 0)::int into v_new;
  return jsonb_build_object('ok', true, 'is_new', coalesce(v_new, 0) = 1);
end;
$$;

-- set_beer_type(p_type) -> jsonb {ok, type, n}
-- Sets the type of the caller's latest beer tonight (beer number n = beer_count of tonight's row).
-- Types: lager pilsner ipa apa stout vete ale sour alkfri annan (else invalid_type).
-- No beer tonight -> no_beer. Changing it again is fine (upsert). Works in ghost mode too.
create or replace function public.set_beer_type(p_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_t   text := lower(btrim(coalesce(p_type, '')));
  v_b   public.beers%rowtype;
begin
  if v_t not in ('lager', 'pilsner', 'ipa', 'apa', 'stout', 'vete', 'ale', 'sour', 'alkfri', 'annan') then
    raise exception 'invalid_type';
  end if;
  select * into v_b from public.beers b where b.user_id = v_uid and b.expires_at > now() and b.beer_count >= 1;
  if not found then raise exception 'no_beer'; end if;
  insert into public.beer_types as bt (user_id, night, n, type, lat, lng, created_at, updated_at)
  values (v_uid, v_b.expires_at, v_b.beer_count, v_t,
          round(v_b.lat::numeric, 2)::float8, round(v_b.lng::numeric, 2)::float8, now(), now())
  on conflict (user_id, night, n) do update set type = excluded.type, updated_at = now();
  return jsonb_build_object('ok', true, 'type', v_t, 'n', v_b.beer_count);
end;
$$;

-- beer_type_stats(p_lat, p_lng) -> setof (scope, period, type, n)
-- scope: 'sweden' | 'town' (within 20 km of p_lat/p_lng; only when both are given and inside Sweden).
-- period: 'night' (tonight) | 'week' (Monday 00:00 Europe/Stockholm -> now). Anonymous counts only.
create or replace function public.beer_type_stats(p_lat float8 default null, p_lng float8 default null)
returns table (scope text, period text, type text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_next_expiry();
  v_week  timestamptz := (public.olnu_week_start(now())::timestamp) at time zone 'Europe/Stockholm';
  v_town  boolean := public.olnu_bp_in_sweden(p_lat, p_lng);
begin
  return query
  with w as (
    select bt.type as ty, bt.night as nt, bt.created_at as ca, bt.lat as la, bt.lng as ln
      from public.beer_types bt
     where bt.created_at >= least(v_week, v_night - interval '24 hours')
  )
  select 'sweden'::text, 'night'::text, w.ty, count(*)::int from w where w.nt = v_night group by w.ty
  union all
  select 'sweden', 'week', w.ty, count(*)::int from w
   where w.ca >= v_week group by w.ty
  union all
  select 'town', 'night', w.ty, count(*)::int from w
   where v_town and w.nt = v_night and w.la is not null
     and abs(w.la - p_lat) < 0.2 and abs(w.ln - p_lng) < 0.4
     and public.olnu_dist_m(w.la, w.ln, p_lat, p_lng) <= 20000
   group by w.ty
  union all
  select 'town', 'week', w.ty, count(*)::int from w
   where v_town and w.ca >= v_week and w.la is not null
     and abs(w.la - p_lat) < 0.2 and abs(w.ln - p_lng) < 0.4
     and public.olnu_dist_m(w.la, w.ln, p_lat, p_lng) <= 20000
   group by w.ty;
end;
$$;

-- my_group_flags() -> setof (group_id, show_on_map, can_edit) for all the caller's groups.
create or replace function public.my_group_flags()
returns table (group_id uuid, show_on_map bool, can_edit bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select m.group_id, coalesce(f.show_on_map, false), public.olnu_group_admin(m.group_id, v_uid)
    from public.group_members m
    left join public.group_flags f on f.group_id = m.group_id
   where m.user_id = v_uid
   order by m.joined_at;
end;
$$;

-- set_group_show(p_group_id, p_on) -> jsonb {show_on_map}
-- "Visa vår grupp på kartan". Only the group creator (or the oldest member when the creator left).
-- Errors: not_member, not_admin.
create or replace function public.set_group_show(p_group_id uuid, p_on bool)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if not public.olnu_group_admin(p_group_id, v_uid) then raise exception 'not_admin'; end if;
  insert into public.group_flags as f (group_id, show_on_map, updated_at, updated_by)
  values (p_group_id, coalesce(p_on, false), now(), v_uid)
  on conflict (group_id) do update set show_on_map = excluded.show_on_map, updated_at = now(), updated_by = v_uid;
  return jsonb_build_object('show_on_map', coalesce(p_on, false));
end;
$$;

-- send_tip(p_group_id, p_bar_id, p_bar_name, p_body default null) -> jsonb {ok, wait_seconds, id, msg_id}
-- Posts "📣 <name> tipsar: Kom till <bar>! <body>" in the group chat. Caller must be a member (not_member).
-- Bar: invalid_bar. Body: optional, cleaned, max 40 chars, no links/phone numbers/bad words (invalid_msg).
-- 1 tip per 5 min per user (all groups): ok=false + wait_seconds. After ok: notify-group {event:"tip", tip_id}.
create or replace function public.send_tip(p_group_id uuid, p_bar_id text, p_bar_name text, p_body text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := public.olnu_bp_clean(p_bar_id);
  v_bar  text := public.olnu_bp_clean(p_bar_name);
  v_body text := nullif(public.olnu_bp_clean(p_body), '');
  v_name text;
  v_last timestamptz;
  v_msg  text;
  v_mid  bigint;
  v_tid  bigint;
begin
  select m.display_name into v_name from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid;
  if not found then raise exception 'not_member'; end if;
  if char_length(v_id) < 1 or char_length(v_id) > 80 or char_length(v_bar) < 1 or char_length(v_bar) > 60 then
    raise exception 'invalid_bar';
  end if;
  if v_body is not null and (char_length(v_body) > 40 or public.olnu_bp_blocked(v_body)) then
    raise exception 'invalid_msg';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_tip:' || v_uid::text, 0));
  select max(t.created_at) into v_last from public.bar_tips t
   where t.user_id = v_uid and t.created_at > now() - interval '5 minutes';
  if v_last is not null then
    return jsonb_build_object('ok', false, 'id', null, 'msg_id', null,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_last + interval '5 minutes' - now())))::int));
  end if;

  v_msg := left('📣 ' || coalesce(v_name, 'Någon') || ' tipsar: Kom till ' || v_bar || '!' ||
                coalesce(' ' || v_body, ''), 140);
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_msg, public.olnu_next_expiry())
  returning id into v_mid;
  insert into public.bar_tips (user_id, group_id, bar_id, bar_name, body, msg_id)
  values (v_uid, p_group_id, v_id, v_bar, v_body, v_mid)
  returning id into v_tid;
  return jsonb_build_object('ok', true, 'wait_seconds', 0, 'id', v_tid, 'msg_id', v_mid);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Medals (ids are stable; names and texts live in docs/js/medals.js)
--    kospanare  Köspanaren         5 queue reports
--    (no medal for offers on purpose: Alkohollagen 7 kap. -- offers stay passive and user-written)
--    sommelier  Ölsommelieren      5 different beer types (not "annan")
--    erovrare   Erövraren          your group took over a bar (stacks per bar and night, after you joined)
--    tipsare    Kunskapsspridaren  3 bar tips sent
-- ---------------------------------------------------------------------------
create or replace function public.olnu_medal_eval_bars(p_uid uuid)
returns table (medal text, n int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q int := 0; v_s int := 0; v_e int := 0; v_t int := 0;
begin
  begin
    select count(*) into v_q from public.bar_queue q where q.user_id = p_uid;
    select count(distinct bt.type) into v_s from public.beer_types bt where bt.user_id = p_uid and bt.type <> 'annan';
    select count(*) into v_e from public.bar_takeovers t
      join public.group_members m on m.group_id = t.group_id and m.user_id = p_uid
     where t.created_at >= m.joined_at;
    select count(*) into v_t from public.bar_tips t where t.user_id = p_uid;
  exception when others then
    return;
  end;
  return query
  select v.medal, v.n from (values
    ('kospanare', case when v_q >= 5 then 1 else 0 end),
    ('sommelier', case when v_s >= 5 then 1 else 0 end),
    ('erovrare', v_e),
    ('tipsare', case when v_t >= 3 then 1 else 0 end)
  ) as v(medal, n);
end;
$$;

-- Same name and return type as 0012; now also stores the v12 medals. Counts never go down.
create or replace function public.olnu_medal_store(p_uid uuid)
returns table (medal text, count int, is_new bool, earned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with ev as (
    select x.medal as m, x.n from public.olnu_medal_eval(p_uid) x
    union all
    select y.medal, y.n from public.olnu_medal_eval_bars(p_uid) y
  ),
  e as (
    select ev.m, max(ev.n)::int as n from ev where ev.n >= 1 group by ev.m
  ),
  up as (
    insert into public.user_medals as um (user_id, medal, count, earned_at, updated_at)
    select p_uid, e.m, e.n, now(), now() from e
    on conflict on constraint user_medals_pkey do update
       set count = greatest(um.count, excluded.count), updated_at = now()
     where excluded.count > um.count
    returning um.medal, um.count, (um.earned_at = now()) as fresh, um.earned_at
  )
  select up.medal, up.count, up.fresh, up.earned_at from up;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  fns text[] := array[
    'public.report_queue(text, text, double precision, double precision, double precision, double precision, text, text)',
    'public.add_offer(text, text, double precision, double precision, double precision, double precision, text)',
    'public.vote_offer(bigint, integer)',
    'public.bar_status()',
    'public.note_takeover(text)',
    'public.set_beer_type(text)',
    'public.beer_type_stats(double precision, double precision)',
    'public.my_group_flags()',
    'public.set_group_show(uuid, boolean)',
    'public.send_tip(uuid, text, text, text)'
  ];
  internal text[] := array[
    'public.olnu_bp_clean(text)',
    'public.olnu_bp_in_sweden(double precision, double precision)',
    'public.olnu_bp_check(text, text, double precision, double precision, double precision, double precision)',
    'public.olnu_bp_blocked(text)',
    'public.olnu_takeovers()',
    'public.olnu_group_admin(uuid, uuid)',
    'public.olnu_bar_queue_now(text)',
    'public.olnu_medal_eval_bars(uuid)',
    'public.olnu_medal_store(uuid)'
  ];
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
  foreach f in array internal loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
  end loop;
end $$;
