-- 0205 STORE-SAFE · flags, age gate (age_ok only, never the birth year), Regler (terms) acceptance.
-- Additive. Nothing changes for live users: every store-only rule checks olnu_store_on(), and the flag row is 'off'.
-- Release day:  update public.app_store_flags set value = 'on', updated_at = now() where key = 'store_mode';
-- Roll back:    update public.app_store_flags set value = 'off', updated_at = now() where key = 'store_mode';
-- (app_public_flags has a CHECK that allows only the key 'visning'; changing it would need a DROP, so the
--  store flags live in their own small table.)
-- No row-removing or object-removing statement in this file.

create table if not exists public.app_store_flags (
  key        text primary key check (key in ('store_mode', 'retention')),
  value      text not null check (value in ('on', 'off')),
  updated_at timestamptz not null default now()
);
alter table public.app_store_flags enable row level security;
revoke all on public.app_store_flags from anon, authenticated;
insert into public.app_store_flags (key, value) values ('store_mode', 'off'), ('retention', 'off') on conflict (key) do nothing;

create or replace function public.olnu_store_on()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select f.value = 'on' from public.app_store_flags f where f.key = 'store_mode'), false)
      or coalesce(current_setting('olnu.store_test', true), '') = '1';
$$;
revoke all on function public.olnu_store_on() from public, anon, authenticated;

-- public_config v3: + store_mode, + support address. A missing visning row now means OFF (owner decision 7).
create or replace function public.public_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'v', 3,
    'mapbox_token', (select c.value from public.app_public_config c where c.key = 'mapbox_token' and c.value like 'pk.%'),
    'visning', coalesce((select f.value from public.app_public_flags f where f.key = 'visning'), 'off'),
    'store_mode', coalesce((select f.value from public.app_store_flags f where f.key = 'store_mode'), 'off'),
    'support', 'support@pintsnow.com',
    'terms_ver', 1
  );
$$;

-- One row per account. RLS on, no policies: RPCs only.
create table if not exists public.user_safety (
  user_id        uuid primary key,
  age_ok         boolean,
  age_checked_at timestamptz,
  terms_ver      int,
  terms_at       timestamptz,
  updated_at     timestamptz not null default now()
);
alter table public.user_safety enable row level security;
revoke all on public.user_safety from anon, authenticated;

-- set_age_ok: the birth year is used for the check and then thrown away (only age_ok + the date are kept).
-- Same calendar year as the 18th birthday → p_had_birthday must say if the birthday has passed.
create or replace function public.set_age_ok(p_birth_year int, p_had_birthday boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_year int := extract(year from (now() at time zone 'Europe/Stockholm'))::int;
  v_d int;
  v_ok boolean;
  s public.user_safety;
begin
  if p_birth_year is null or p_birth_year < 1900 or p_birth_year > v_year then raise exception 'invalid_year'; end if;
  v_d := v_year - p_birth_year;
  if v_d = 18 and p_had_birthday is null then raise exception 'need_birthday'; end if;
  v_ok := v_d > 18 or (v_d = 18 and p_had_birthday);
  select * into s from public.user_safety x where x.user_id = v_uid;
  -- A "no" cannot be turned into a "yes" by trying again the same day.
  if v_ok and s.age_ok is false and s.age_checked_at > now() - interval '24 hours' then raise exception 'age_locked'; end if;
  insert into public.user_safety as u (user_id, age_ok, age_checked_at, updated_at)
  values (v_uid, v_ok, now(), now())
  on conflict (user_id) do update set age_ok = excluded.age_ok, age_checked_at = now(), updated_at = now();
  return jsonb_build_object('age_ok', v_ok, 'age_checked_at', now());
end; $$;

create or replace function public.accept_terms(p_ver int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v int := greatest(1, least(coalesce(p_ver, 1), 99));
begin
  insert into public.user_safety as u (user_id, terms_ver, terms_at, updated_at)
  values (v_uid, v, now(), now())
  on conflict (user_id) do update set terms_ver = greatest(coalesce(u.terms_ver, 0), v), terms_at = now(), updated_at = now();
  return jsonb_build_object('terms_ver', v, 'terms_at', now());
end; $$;

revoke all on function public.set_age_ok(int, boolean) from public, anon;
revoke all on function public.accept_terms(int) from public, anon;
grant execute on function public.set_age_ok(int, boolean) to authenticated;
grant execute on function public.accept_terms(int) to authenticated;
grant execute on function public.public_config() to anon, authenticated;
