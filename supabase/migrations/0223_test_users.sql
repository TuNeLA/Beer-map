-- 0223 🧪 TEST USERS (owner 2026-11-07; additive, owner_stats itself is NOT changed).
-- The test scripts tag their own fresh anonymous users, and the owner page counts real people only.
-- A user is a test user when ANY of:
--   * auth user_metadata {"test": true}  (scripts: client.auth.updateUser({ data: { test: true } }) right after signInAnonymously)
--   * a row in olnu_test_users            (scripts: rpc("mark_me_test") — same effect, for clients that cannot set metadata)
--   * the old rule olnu_is_test_user()    (a pin / check-in / push location in the test zone, lat 68.25–68.45, lng 18.60–19.00)
-- user_metadata is writable by the user: a person can only hide HIMSELF from the owner's counts, nothing else changes for him.
-- owner_stats2(p_key) = owner_stats(p_key) with the "users" block counted without test users, plus users.test_users.
-- stats.html asks owner_stats2 first and falls back to owner_stats (old server).

create table if not exists public.olnu_test_users (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table public.olnu_test_users enable row level security;
revoke all on table public.olnu_test_users from public, anon, authenticated;

create or replace function public.olnu_is_test_uid(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_uid is not null and (
    exists (select 1 from auth.users u where u.id = p_uid and coalesce(u.raw_user_meta_data ->> 'test', '') in ('true', '1'))
    or exists (select 1 from public.olnu_test_users t where t.user_id = p_uid)
    or public.olnu_is_test_user(p_uid));
$$;
revoke all on function public.olnu_is_test_uid(uuid) from public, anon, authenticated;

create or replace function public.mark_me_test()
returns json language plpgsql volatile security definer set search_path to 'public' as $$
declare v uuid := public.olnu_uid();
begin
  insert into public.olnu_test_users (user_id) values (v) on conflict do nothing;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.mark_me_test() from public, anon;
grant execute on function public.mark_me_test() to authenticated;

create or replace function public.owner_stats2(p_key text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v       jsonb := public.owner_stats(p_key);   -- does the key check, rate limit and fail log
  v_now   timestamptz := now();
  v_next  timestamptz := public.olnu_next_expiry();
  v_today timestamptz := date_trunc('day', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm';
  v_users jsonb;
begin
  if v is null or v ? 'code' or not (v ? 'users') then return v; end if;   -- forbidden / rate limited
  create temporary table if not exists olnu_tmp_real on commit drop as
    select u.id, u.created_at from auth.users u where not public.olnu_is_test_uid(u.id);
  v_users := (v -> 'users') || jsonb_build_object(
    'total', (select count(*) from olnu_tmp_real),
    'named', (select count(distinct g.user_id) from public.group_members g join olnu_tmp_real r on r.id = g.user_id),
    'new_today', (select count(*) from olnu_tmp_real where created_at >= v_today),
    'new_7d', (select count(*) from olnu_tmp_real where created_at > v_now - interval '7 days'),
    'new_30d', (select count(*) from olnu_tmp_real where created_at > v_now - interval '30 days'),
    'active_tonight', (select count(distinct a.uid) from (
        select b.user_id uid from public.beers b
         where b.expires_at = v_next and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) + coalesce(b.shot_count, 0)) > 0
        union all
        select c.user_id from public.checkins c where c.expires_at = v_next) a join olnu_tmp_real r on r.id = a.uid),
    'out_now', (select count(*) from public.beers b join olnu_tmp_real r on r.id = b.user_id
                 where b.expires_at > v_now and not coalesce(b.stopped, false)),
    'opened_7d', (select count(distinct s.user_id) from auth.sessions s join olnu_tmp_real r on r.id = s.user_id
                   where s.updated_at > v_now - interval '7 days'),
    'push', (select count(distinct p.user_id) from public.push_subscriptions p join olnu_tmp_real r on r.id = p.user_id),
    'test_users', (select count(*) from auth.users) - (select count(*) from olnu_tmp_real),
    'empty_anon', (select count(*) from olnu_tmp_real r
                    where not exists (select 1 from public.group_members g where g.user_id = r.id)
                      and not exists (select 1 from public.beers b where b.user_id = r.id)
                      and not exists (select 1 from public.checkins c where c.user_id = r.id)),
    'real_only', true);
  return jsonb_set(v, '{users}', v_users);
end;
$$;
revoke all on function public.owner_stats2(text) from public;
grant execute on function public.owner_stats2(text) to anon, authenticated;
