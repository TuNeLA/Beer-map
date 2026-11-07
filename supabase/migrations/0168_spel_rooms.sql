-- 0168 🎉 SPEL: one game room per group (also event groups), every player on their own phone.
-- Games: kort (Skämskort: a rotating judge picks the best answer card), vem (Vem i gänget?), aldrig (Jag har aldrig),
-- hellre (Hellre eller?). The state machine is in 0169. Client: docs/js/spel.js (+ lazy spel-ui.js, spel-cards.js, spel.css).
-- RLS on, no policies, no client access to the tables; RPCs only. Rows are never removed; reads filter on expires_at.
-- Additive. Safe to run again. Needs 0001 (olnu_uid, group_members) and 0070 (olnu_party_lim, olnu_party_name).

create table if not exists public.spel_rooms (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null,
  game        text not null default 'kort',            -- checked in the functions (new games need no table change)
  phase       text not null default 'lobby',           -- lobby | pick | judge | vote | result | end
  round       int not null default 0,
  goal        int not null default 5,                  -- kort: points to win; poll games: number of rounds
  game_no     int not null default 0,
  pub         jsonb not null default '{}'::jsonb,      -- public state
  sec         jsonb not null default '{}'::jsonb,      -- secret state (decks, who wrote which answer); never returned
  v           int not null default 1,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '3 hours',
  closed      boolean not null default false
);
create index if not exists spel_rooms_group on public.spel_rooms (group_id, expires_at) where not closed;

create table if not exists public.spel_players (
  room_id    uuid not null references public.spel_rooms (id),
  user_id    uuid not null,
  k          text not null,
  name       text not null,
  status     text not null default 'in' check (status in ('in', 'left')),
  ord        int not null default 0,
  score      int not null default 0,
  hand       int[] not null default '{}'::int[],     -- kort: own card ids (only the owner sees them)
  joined_at  timestamptz not null default now(),
  seen_at    timestamptz not null default now(),
  primary key (room_id, user_id)
);
create unique index if not exists spel_players_k on public.spel_players (room_id, k);
create index if not exists spel_players_user on public.spel_players (user_id, seen_at);

-- One input per player per round (changed by upsert until the round closes).
create table if not exists public.spel_inputs (
  room_id    uuid not null,
  game_no    int not null,
  round      int not null,
  user_id    uuid not null,
  val        jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, game_no, round, user_id)
);

alter table public.spel_rooms   enable row level security;
alter table public.spel_players enable row level security;
alter table public.spel_inputs  enable row level security;
revoke all on public.spel_rooms, public.spel_players, public.spel_inputs from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.spel_rooms, public.spel_players, public.spel_inputs from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.spel_rooms, public.spel_players, public.spel_inputs to service_role';
  end if;
end $$;

/* ---------- helpers (internal) ---------- */
create or replace function public.olnu_spel_k(p_room uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5('olnu-spel:' || p_room::text || ':' || p_uid::text), 1, 12);
$$;

-- shuffled 0..n-1 minus the ids in p_not
create or replace function public.olnu_spel_deck(p_n int, p_not int[] default '{}'::int[])
returns int[] language sql volatile set search_path = public as $$
  select coalesce(array(select x from generate_series(0, greatest(p_n, 1) - 1) x where not (x = any (coalesce(p_not, '{}'::int[])))
                        order by random()), '{}'::int[]);
$$;

-- players in the room who are playing and were seen lately (poll every 1.5 s, seen written max every 10 s)
create or replace function public.olnu_spel_active(p_room uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array(select p.user_id from public.spel_players p
                         where p.room_id = p_room and p.status = 'in' and p.seen_at > now() - interval '75 seconds'
                         order by p.ord), '{}'::uuid[]);
$$;

create or replace function public.olnu_spel_board(p_room uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name, 'score', p.score) order by p.score desc, p.ord), '[]'::jsonb)
    from public.spel_players p where p.room_id = p_room and (p.status = 'in' or p.score > 0);
$$;

do $$
declare f text;
begin
  foreach f in array array['olnu_spel_k(uuid, uuid)', 'olnu_spel_deck(integer, integer[])', 'olnu_spel_active(uuid)', 'olnu_spel_board(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.' || f || ' from anon, authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function public.' || f || ' to service_role';
    end if;
  end loop;
end $$;
