-- Öl Nu — public client config (CONTRACT "KARTSTIL 2"): browser-safe values the static site needs but that may not
-- live in git (GitHub push protection flags the Mapbox PUBLIC token pk.* as a secret, a false positive).
-- The value is set by hand with execute_sql (never in this file):
--   insert into public.app_public_config (key, value) values ('mapbox_token', 'pk.…')
--     on conflict (key) do update set value = excluded.value, updated_at = now();
-- Only keys in the allow list are returned, and mapbox_token must be a public pk.* token (never an sk.* secret).
-- Additive: one new table, one new function. anon may call it (basemap.js asks before sign-in).

create table if not exists public.app_public_config (
  key        text primary key check (key in ('mapbox_token')),
  value      text not null check (char_length(value) between 1 and 400),
  updated_at timestamptz not null default now(),
  constraint app_public_config_pk_only check (key <> 'mapbox_token' or value like 'pk.%')
);
alter table public.app_public_config enable row level security;
revoke all on public.app_public_config from anon, authenticated;
grant all on public.app_public_config to service_role;

create or replace function public.public_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'v', 1,
    'mapbox_token', (select c.value from public.app_public_config c where c.key = 'mapbox_token' and c.value like 'pk.%')
  );
$$;
revoke all on function public.public_config() from public;
grant execute on function public.public_config() to anon, authenticated;
