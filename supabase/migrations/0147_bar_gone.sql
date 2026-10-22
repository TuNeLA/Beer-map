-- Öl Nu — 🚫 STÄNGT FÖR GOTT: users report a place that no longer exists (CONTRACT "🚫 STÄNGT FÖR GOTT").
-- Additive: two new tables (RLS on, no policies, no client access). Rows are never removed: a report can be withdrawn
-- (withdrawn_at), a hidden place can be undone by the owner (status 'undone'), and after an undo only newer reports count.
create table if not exists public.bar_gone_reports (
  id           bigserial primary key,
  bar_id       text not null check (char_length(bar_id) between 1 and 80),
  user_id      uuid not null,
  name         text check (name is null or char_length(name) <= 60),
  bar_lat      double precision not null,
  bar_lng      double precision not null,
  trusted      boolean not null default false,          -- the owner's trusted phone (bar_area_trusted)
  created_at   timestamptz not null default now(),
  withdrawn_at timestamptz
);
create unique index if not exists bar_gone_reports_one_idx on public.bar_gone_reports (bar_id, user_id) where withdrawn_at is null;
create index if not exists bar_gone_reports_bar_idx on public.bar_gone_reports (bar_id, created_at desc);
create index if not exists bar_gone_reports_user_idx on public.bar_gone_reports (user_id, created_at desc);
alter table public.bar_gone_reports enable row level security;
revoke all on public.bar_gone_reports from anon, authenticated;
revoke all on sequence public.bar_gone_reports_id_seq from anon, authenticated;
grant all on public.bar_gone_reports to service_role;

-- One row per place that was hidden at some point. status: hidden (crowd / trusted phone) → confirmed (owner) | undone (owner).
create table if not exists public.bar_gone (
  bar_id     text primary key check (char_length(bar_id) between 1 and 80),
  name       text,
  bar_lat    double precision not null,
  bar_lng    double precision not null,
  status     text not null default 'hidden' check (status in ('hidden', 'confirmed', 'undone')),
  reason     text not null default 'crowd' check (reason in ('crowd', 'trusted', 'owner')),
  reports    int not null default 0,
  hidden_at  timestamptz not null default now(),
  status_at  timestamptz not null default now()
);
create index if not exists bar_gone_status_idx on public.bar_gone (status);
alter table public.bar_gone enable row level security;
revoke all on public.bar_gone from anon, authenticated;
grant all on public.bar_gone to service_role;
