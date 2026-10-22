-- Öl Nu — 🔐 SPARA KONTOT (CONTRACT "KONTO"): feature flags for e-mail / Google login, read before sign-in.
-- The client (docs/js/account.js) shows "Spara ditt konto" / "Logga in med e-post" only when email_login is on,
-- and the Google button only when google_login is on. Both start OFF: the owner turns them on by hand AFTER
-- custom SMTP (and, for Google, the OAuth provider) is set up in the Supabase dashboard:
--   update public.app_account_flags set enabled = true, updated_at = now() where key = 'email_login';
--   update public.app_account_flags set enabled = true, updated_at = now() where key = 'google_login';
-- Additive: one new table, one new function. anon may call it (the home-screen app asks before it has a session).

create table if not exists public.app_account_flags (
  key        text primary key check (key in ('email_login', 'google_login')),
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.app_account_flags enable row level security;
revoke all on public.app_account_flags from anon, authenticated;
grant all on public.app_account_flags to service_role;

insert into public.app_account_flags (key, enabled) values ('email_login', false), ('google_login', false)
  on conflict (key) do nothing;

create or replace function public.account_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'v', 1,
    'email', coalesce((select f.enabled from public.app_account_flags f where f.key = 'email_login'), false),
    'google', coalesce((select f.enabled from public.app_account_flags f where f.key = 'google_login'), false)
  );
$$;
revoke all on function public.account_config() from public;
grant execute on function public.account_config() to anon, authenticated;
