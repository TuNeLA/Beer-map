-- 0116 RUNDAN (💸 Kvällens nota + Swisha tillbaka, 🎲 Vem bjuder?, 🚕 Dela taxin). Client: docs/js/rundan.js + docs/rundan.css.
-- Tables + internal helpers. Additive only. Rows are never removed: cancel / reject flags instead.
-- RLS on, no policies, no client access. Every user column is a uuid, so "Radera allt om mig" (0016 sweep) moves them.
-- Safe to run again.

-- My own Swish number, set once, shown only to people in my groups (through rnd_group).
create table if not exists public.rnd_swish (
  user_id     uuid primary key,
  number      text null,
  changes     int not null default 0,
  day         date not null default (now() at time zone 'Europe/Stockholm')::date,
  day_changes int not null default 0,
  updated_at  timestamptz not null default now()
);

-- One expense ("Anton bjöd på 4 öl", "Taxin hem"). payer = who paid; total includes the payer's own part.
create table if not exists public.rnd_expenses (
  id           bigserial primary key,
  group_id     uuid not null,
  created_by   uuid not null,
  payer        uuid not null,
  kind         text not null check (kind in ('round', 'taxi', 'other')),
  what         text not null check (char_length(what) between 1 and 40),
  items        int not null default 0 check (items between 0 and 99),
  total        int not null check (total between 1 and 50000),
  equal_share  int null,
  msg_id       bigint null,
  night        timestamptz not null,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz null,
  cancelled_by uuid null
);
create index if not exists rnd_expenses_group_idx on public.rnd_expenses (group_id, id desc);
create index if not exists rnd_expenses_user_idx on public.rnd_expenses (created_by, created_at desc);
create index if not exists rnd_expenses_msg_idx on public.rnd_expenses (msg_id);

-- What each other person owes the payer for one expense (the payer has no row).
create table if not exists public.rnd_shares (
  expense_id bigint not null,
  user_id    uuid not null,
  amount     int not null check (amount between 1 and 50000),
  primary key (expense_id, user_id)
);

-- A payment between two members ("Swishat", or cash the receiver writes down). Counts at once;
-- the receiver can confirm it (✅ Fått) or reject it (❌ Fick inget); the sender can take it back within 24 h.
create table if not exists public.rnd_payments (
  id           bigserial primary key,
  group_id     uuid not null,
  from_user    uuid not null,
  to_user      uuid not null,
  amount       int not null check (amount between 1 and 50000),
  expense_id   bigint null,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz null,
  rejected_at  timestamptz null,
  cancelled_at timestamptz null
);
create index if not exists rnd_payments_group_idx on public.rnd_payments (group_id, id desc);
create index if not exists rnd_payments_exp_idx on public.rnd_payments (expense_id);
create index if not exists rnd_payments_user_idx on public.rnd_payments (created_by, created_at desc);

-- 🎲 Vem bjuder? spins (the result is also a chat message).
create table if not exists public.rnd_spins (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  members    uuid[] not null,
  winner     uuid not null,
  fair       boolean not null default false,
  msg_id     bigint null,
  night      timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists rnd_spins_group_idx on public.rnd_spins (group_id, id desc);
create index if not exists rnd_spins_user_idx on public.rnd_spins (user_id, created_at desc);

alter table public.rnd_swish    enable row level security;
alter table public.rnd_expenses enable row level security;
alter table public.rnd_shares   enable row level security;
alter table public.rnd_payments enable row level security;
alter table public.rnd_spins    enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------
-- Opaque member key (never a user id).
create or replace function public.olnu_rnd_k(p_group uuid, p_uid uuid)
returns text language sql immutable set search_path = public as $$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-rnd'), 1, 12);
$$;

create or replace function public.olnu_rnd_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$$;

create or replace function public.olnu_rnd_uid_of(p_group uuid, p_k text)
returns uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.group_members m
   where m.group_id = p_group and public.olnu_rnd_k(p_group, m.user_id) = p_k limit 1;
$$;

create or replace function public.olnu_rnd_name(p_group uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid), '?');
$$;

-- One line, no control chars, spaces squeezed, trimmed.
create or replace function public.olnu_rnd_clean(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- Swedish mobile 07xxxxxxxx from free text ('' -> '', bad -> null).
create or replace function public.olnu_rnd_swish_norm(p text)
returns text language plpgsql immutable set search_path = public as $$
declare v text := regexp_replace(coalesce(p, ''), '[\s\-().]', '', 'g');
begin
  if v like '+46%' then v := '0' || substr(v, 4); elsif v like '0046%' then v := '0' || substr(v, 5); end if;
  if v = '' then return ''; end if;
  if v !~ '^07[0-9]{8}$' then return null; end if;
  return v;
end; $$;

-- The Swish number a member shows in this group: own number (rnd_swish), else the Skuldboken number of the group.
create or replace function public.olnu_rnd_swish_of(p_group uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select s.number from public.rnd_swish s where s.user_id = p_uid and s.number is not null),
                  (select g.number from public.gang_swish g where g.group_id = p_group and g.user_id = p_uid and g.number is not null));
$$;

-- Net balance of a member in a group, kr (+ = gets money back, - = owes). All time, open rows only.
create or replace function public.olnu_rnd_net(p_group uuid, p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
      coalesce((select sum(s.amount) from public.rnd_shares s join public.rnd_expenses e on e.id = s.expense_id
                 where e.group_id = p_group and e.cancelled_at is null and e.payer = p_uid and s.user_id <> p_uid), 0)
    - coalesce((select sum(s.amount) from public.rnd_shares s join public.rnd_expenses e on e.id = s.expense_id
                 where e.group_id = p_group and e.cancelled_at is null and s.user_id = p_uid and e.payer <> p_uid), 0)
    + coalesce((select sum(p.amount) from public.rnd_payments p
                 where p.group_id = p_group and p.from_user = p_uid and p.cancelled_at is null and p.rejected_at is null), 0)
    - coalesce((select sum(p.amount) from public.rnd_payments p
                 where p.group_id = p_group and p.to_user = p_uid and p.cancelled_at is null and p.rejected_at is null), 0)
  )::int;
$$;

-- Rounds a member paid in this group lately (for the fair 🎲 mode).
create or replace function public.olnu_rnd_paid_n(p_group uuid, p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.rnd_expenses e
   where e.group_id = p_group and e.payer = p_uid and e.kind = 'round' and e.cancelled_at is null
     and e.created_at > now() - interval '60 days';
$$;

-- One expense as json for the caller.
create or replace function public.olnu_rnd_exp_json(e public.rnd_expenses, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'msg_id', e.msg_id, 'kind', e.kind, 'what', e.what, 'items', e.items, 'total', e.total,
    'equal_share', e.equal_share, 'created_at', e.created_at, 'night', e.night,
    'cancelled', e.cancelled_at is not null,
    'payer', public.olnu_rnd_k(e.group_id, e.payer), 'payer_name', public.olnu_rnd_name(e.group_id, e.payer),
    'payer_me', e.payer = p_uid, 'by_me', e.created_by = p_uid,
    'can_cancel', e.cancelled_at is null and (e.created_by = p_uid or e.payer = p_uid),
    'payer_swish', public.olnu_rnd_swish_of(e.group_id, e.payer),
    'shares', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_rnd_k(e.group_id, s.user_id), 'name', public.olnu_rnd_name(e.group_id, s.user_id),
        'is_me', s.user_id = p_uid, 'amount', s.amount,
        'paid', coalesce((select sum(p.amount) from public.rnd_payments p
                           where p.expense_id = e.id and p.from_user = s.user_id and p.to_user = e.payer
                             and p.cancelled_at is null and p.rejected_at is null), 0) >= s.amount,
        'confirmed', exists (select 1 from public.rnd_payments p
                              where p.expense_id = e.id and p.from_user = s.user_id and p.to_user = e.payer
                                and p.cancelled_at is null and p.rejected_at is null and p.confirmed_at is not null),
        'pay_id', (select max(p.id) from public.rnd_payments p
                    where p.expense_id = e.id and p.from_user = s.user_id and p.to_user = e.payer
                      and p.cancelled_at is null and p.rejected_at is null))
      order by s.amount desc, public.olnu_rnd_name(e.group_id, s.user_id))
      from public.rnd_shares s where s.expense_id = e.id), '[]'::jsonb));
$$;
