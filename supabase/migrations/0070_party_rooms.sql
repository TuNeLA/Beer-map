-- 0070 PARTYSPEL (🎲 live party rooms, Jackbox-style): tables + helpers. Client: docs/js/party.js (+ lazy party-ui.js,
-- party-content.js, party.css). Every phone plays on its own screen; the host phone is the shared "TV" screen.
-- The game state machine lives in SQL (0071), so a phone can never read a secret role, word, target or vote early.
-- Rooms: 4-letter code, live 3 h from creation, then every read ignores them (rows stay, reads filter on time).
-- RLS on, no policies, no client access to the tables; RPCs only (0072). Additive. Safe to run again.

create table if not exists public.party_rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^[A-Z]{4}$'),
  host        uuid not null,
  group_id    uuid,
  game        text not null default 'imposter' check (game in ('imposter', 'survivor', 'hatten', 'flocken', 'vagen')),
  phase       text not null default 'lobby',
  round       int not null default 0,
  step        int not null default 0,
  game_no     int not null default 0,
  opts        jsonb not null default '{}'::jsonb,
  pub         jsonb not null default '{}'::jsonb,   -- public game state (everyone in the room sees it)
  sec         jsonb not null default '{}'::jsonb,   -- secret game state (server only, never returned whole)
  v           int not null default 1,               -- bumped on every change; clients poll with their last v
  started_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '3 hours',
  closed      boolean not null default false
);
create index if not exists party_rooms_code on public.party_rooms (code, expires_at) where not closed;
create index if not exists party_rooms_group on public.party_rooms (group_id, expires_at) where group_id is not null;
create index if not exists party_rooms_host on public.party_rooms (host, created_at);

-- status: in = playing · out = voted out this game (jury / waiting screen) · wait = joined mid-game (in from the next
-- game) · tv = the host phone is only the screen · left = left or was removed (can come back with the code)
create table if not exists public.party_players (
  room_id    uuid not null references public.party_rooms (id),
  user_id    uuid not null,
  k          text not null,
  name       text not null,
  is_host    boolean not null default false,
  status     text not null default 'in' check (status in ('in', 'out', 'wait', 'tv', 'left')),
  in_game    boolean not null default false,
  ord        int not null default 0,
  score      int not null default 0,
  wins       int not null default 0,
  out_round  int,
  joined_at  timestamptz not null default now(),
  seen_at    timestamptz not null default now(),
  primary key (room_id, user_id)
);
create unique index if not exists party_players_k on public.party_players (room_id, k);
create index if not exists party_players_user on public.party_players (user_id, joined_at);

-- One input per player per input step (rk = 'vote:2', 'ans:3', ...). Changed by upsert until the step closes.
create table if not exists public.party_inputs (
  room_id    uuid not null,
  game_no    int not null,
  rk         text not null,
  user_id    uuid not null,
  val        text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, game_no, rk, user_id)
);

-- One row per player per finished game (the meriter event, 0072 trigger).
create table if not exists public.party_results (
  room_id    uuid not null,
  game_no    int not null,
  user_id    uuid not null,
  game       text not null,
  won        boolean not null default false,
  night      timestamptz not null,
  players    int not null default 0,
  created_at timestamptz not null default now(),
  primary key (room_id, game_no, user_id)
);

create table if not exists public.party_limits (
  user_id    uuid not null,
  kind       text not null,
  win_start  timestamptz not null default now(),
  n          int not null default 0,
  primary key (user_id, kind)
);

alter table public.party_rooms   enable row level security;
alter table public.party_players enable row level security;
alter table public.party_inputs  enable row level security;
alter table public.party_results enable row level security;
alter table public.party_limits  enable row level security;
revoke all on public.party_rooms, public.party_players, public.party_inputs, public.party_results, public.party_limits from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.party_rooms, public.party_players, public.party_inputs, public.party_results, public.party_limits from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.party_rooms, public.party_players, public.party_inputs, public.party_results, public.party_limits to service_role';
  end if;
end $$;

/* ---------- helpers (internal; not callable by clients) ---------- */

create or replace function public.olnu_party_k(p_room uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5('olnu-party:' || p_room::text || ':' || p_uid::text), 1, 12);
$$;

-- A display name: no control chars or < >, spaces squeezed, 1–20 chars. Null when empty.
create or replace function public.olnu_party_name(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\u0000-\u001f<>]', '', 'g'), '\s+', ' ', 'g')), 20), '');
$$;

-- Free text from a phone: like a name but up to p_max chars.
create or replace function public.olnu_party_text(p text, p_max int)
returns text language sql immutable set search_path = public as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\u0000-\u001f<>]', '', 'g'), '\s+', ' ', 'g')), p_max), '');
$$;

-- Compare words: lower case, letters and digits only (åäö kept).
create or replace function public.olnu_party_norm(p text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9åäöéèüæøß]', '', 'g');
$$;

-- Small Levenshtein distance (strings are max 40 chars here).
create or replace function public.olnu_party_lev(a text, b text)
returns int language plpgsql immutable set search_path = public as $$
declare
  la int := length(a); lb int := length(b);
  prev int[]; cur int[]; i int; j int; c int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  if la > 60 or lb > 60 then return greatest(la, lb); end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      c := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur := cur || least(cur[j] + 1, prev[j + 1] + 1, prev[j] + c);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end; $$;

-- Is the imposter's guess the word? Exact after norm, or 1 typo (2 for long words).
create or replace function public.olnu_party_same_word(p_guess text, p_word text)
returns boolean language plpgsql immutable set search_path = public as $$
declare g text := public.olnu_party_norm(p_guess); w text := public.olnu_party_norm(p_word); d int;
begin
  if g = '' or w = '' then return false; end if;
  if g = w then return true; end if;
  if length(w) < 4 then return false; end if;
  d := public.olnu_party_lev(g, w);
  return d <= case when length(w) >= 9 then 2 else 1 end;
end; $$;

-- Rate limit: true = allowed. Counts p_kind per user in a sliding-ish window.
create or replace function public.olnu_party_lim(p_uid uuid, p_kind text, p_max int, p_win interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into public.party_limits as l (user_id, kind, win_start, n) values (p_uid, p_kind, now(), 1)
  on conflict (user_id, kind) do update
    set n = case when l.win_start < now() - p_win then 1 else l.n + 1 end,
        win_start = case when l.win_start < now() - p_win then now() else l.win_start end
  returning n into v_n;
  return v_n <= p_max;
end; $$;

create or replace function public.olnu_party_shuffle(p uuid[])
returns uuid[] language sql volatile set search_path = public as $$
  select coalesce(array(select x from unnest(p) x order by random()), '{}'::uuid[]);
$$;

-- user ids of players with this status, in turn order
create or replace function public.olnu_party_ids(p_room uuid, p_status text)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array(select p.user_id from public.party_players p
                         where p.room_id = p_room and p.status = p_status order by p.ord, p.joined_at), '{}'::uuid[]);
$$;

create or replace function public.olnu_party_uid(p_room uuid, p_k text)
returns uuid language sql stable security definer set search_path = public as $$
  select p.user_id from public.party_players p where p.room_id = p_room and p.k = p_k and p.status <> 'left';
$$;

create or replace function public.olnu_party_pname(p_room uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select p.name from public.party_players p where p.room_id = p_room and p.user_id = p_uid;
$$;

-- [{k, name}] for a list of user ids (same order)
create or replace function public.olnu_party_people(p_room uuid, p_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name) order by x.i), '[]'::jsonb)
    from unnest(p_ids) with ordinality as x(id, i) join public.party_players p on p.room_id = p_room and p.user_id = x.id;
$$;

-- Vote tally of one input step. Votes are target keys k; only votes from p_voters for keys of p_targets count.
-- {votes:[name, ...] shuffled (one per vote, for the slow reveal), counts:[{k,name,n}] most first, top:[k...], n}
create or replace function public.olnu_party_tally(p_room uuid, p_game int, p_rk text, p_voters uuid[], p_targets uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  with t as (
    select p.k, p.name, p.user_id from public.party_players p where p.room_id = p_room and p.user_id = any (p_targets)
  ), v as (
    select t.k, t.name from public.party_inputs i join t on t.k = i.val
     where i.room_id = p_room and i.game_no = p_game and i.rk = p_rk and i.user_id = any (p_voters) and i.user_id <> t.user_id
  ), c as (
    select t.k, t.name, (select count(*) from v where v.k = t.k)::int as n from t
  )
  select jsonb_build_object(
    'votes', coalesce((select jsonb_agg(jsonb_build_object('k', v.k, 'name', v.name) order by random()) from v), '[]'::jsonb),
    'counts', coalesce((select jsonb_agg(jsonb_build_object('k', c.k, 'name', c.name, 'n', c.n) order by c.n desc, c.name) from c), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(c.k) from c where c.n > 0 and c.n = (select max(n) from c)), '[]'::jsonb),
    'n', (select count(*) from v)::int);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'olnu_party_k(uuid, uuid)', 'olnu_party_name(text)', 'olnu_party_text(text, integer)', 'olnu_party_norm(text)',
    'olnu_party_lev(text, text)', 'olnu_party_same_word(text, text)', 'olnu_party_lim(uuid, text, integer, interval)',
    'olnu_party_shuffle(uuid[])', 'olnu_party_ids(uuid, text)', 'olnu_party_uid(uuid, text)', 'olnu_party_pname(uuid, uuid)',
    'olnu_party_people(uuid, uuid[])', 'olnu_party_tally(uuid, integer, text, uuid[], uuid[])']
  loop
    execute 'revoke all on function public.' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.' || f || ' from anon, authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function public.' || f || ' to service_role';
    end if;
  end loop;
end $$;
