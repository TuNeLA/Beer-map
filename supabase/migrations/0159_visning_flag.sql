-- Öl Nu — 🎞️ VISNINGSLÄGE kill switch (CONTRACT "VISNINGSLÄGE"). docs/js/demo.js simulates a big night (client side only).
-- The owner turns it on / off for every phone without a deploy:
--   update public.app_public_flags set value = 'off', updated_at = now() where key = 'visning';   -- off
--   update public.app_public_flags set value = 'on',  updated_at = now() where key = 'visning';   -- on
-- ⚠️ Turn it OFF before any public launch or Play Store release.
-- Additive: one new table (own allow list, so app_public_config keeps its pk.* rule) and public_config() gets one more field.
-- Old clients ignore the new field. Missing row = 'on' (the default the owner chose).

create table if not exists public.app_public_flags (
  key        text primary key check (key in ('visning')),
  value      text not null check (value in ('on', 'off')),
  updated_at timestamptz not null default now()
);
alter table public.app_public_flags enable row level security;
revoke all on public.app_public_flags from anon, authenticated;
grant all on public.app_public_flags to service_role;

insert into public.app_public_flags (key, value) values ('visning', 'on') on conflict (key) do nothing;

create or replace function public.public_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'v', 2,
    'mapbox_token', (select c.value from public.app_public_config c where c.key = 'mapbox_token' and c.value like 'pk.%'),
    'visning', coalesce((select f.value from public.app_public_flags f where f.key = 'visning'), 'on')
  );
$$;
revoke all on function public.public_config() from public;
grant execute on function public.public_config() to anon, authenticated;
