-- 0294 — "Nytt" badge dates for the games in the game hub (js/spel-ui.js), from the server instead of the client.
-- Additive only: 1 new table, 1 new read RPC, seed rows. Nothing old changes.
--   game_launch_dates() → {v: 1, games: {<game id>: "YYYY-MM-DD"}}   (anon + authenticated)
-- The client shows "Nytt" on a game for 14 days after its date, until the game is opened on that phone.
-- The client keeps the seed dates below as its offline fallback and caches the last answer (localStorage olnu.spLaunch).
-- New game or new date:
--   insert into public.pn_game_launch (game_id, launched_on) values ('<id>', '<date>')
--   on conflict (game_id) do update set launched_on = excluded.launched_on, updated_at = now();
-- Access: RLS on, no policies, no grants on the table: only the SECURITY DEFINER function reads it.

create table if not exists public.pn_game_launch (
  game_id text primary key check (game_id ~ '^[a-z][a-z0-9_]{0,23}$'),
  launched_on date not null,
  updated_at timestamptz not null default now()
);
alter table public.pn_game_launch enable row level security;
revoke all on public.pn_game_launch from public, anon, authenticated;

insert into public.pn_game_launch (game_id, launched_on) values
  ('kort', '2026-11-07'), ('vem', '2026-11-07'), ('aldrig', '2026-11-07'),
  ('hellre', '2026-11-07'), ('quiz', '2026-11-07'), ('kung', '2026-11-07')
on conflict (game_id) do nothing;

create or replace function public.game_launch_dates()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('v', 1, 'games',
    coalesce((select jsonb_object_agg(g.game_id, to_char(g.launched_on, 'YYYY-MM-DD')) from public.pn_game_launch g), '{}'::jsonb)) $$;
revoke all on function public.game_launch_dates() from public;
grant execute on function public.game_launch_dates() to anon, authenticated;
