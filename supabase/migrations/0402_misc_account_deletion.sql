-- 0402 MISC · RADERA KONTOT MED 7 DAGARS ÅNGERTID (X4, Apple 5.1.1(v), Google Play). OWNER-RUN at release.
-- Additive only: one new table, new functions, one pg_cron job. No row-removing or object-removing statement here.
-- The real removal is the EXISTING function delete_my_data_v2() (0209; the owner adds the meriter_carry line to it at
-- release). This file only decides WHEN it runs:
--   request_account_deletion()   Inställningar → Radera mitt konto → confirm. Due in 7 days. Asking again = same row.
--   cancel_account_deletion()    "Ångra" during the 7 days.
--   my_account_deletion()        for the app: { pending, due_at, days_left }.
--   olnu_run_due_deletions(max)  pg_cron, every night 02:41 UTC (03:41 Stockholm winter time): runs delete_my_data_v2() AS each due
--                                user (request.jwt.claims set per user, one sub-transaction each, reset after),
--                                3 tries, then status 'failed' (the owner sees it in the table).
-- account_deletions.subject is TEXT on purpose: the 0209 sweep rewrites every uuid column, so a uuid here would be
-- anonymised half-way and a retry could not find the user. When the run is done, subject is set to null.
-- During the 7 days the app works as normal (owner question 2; default).

create table if not exists public.account_deletions (
  id           bigserial primary key,
  subject      text,
  status       text not null default 'pending' check (status in ('pending', 'cancelled', 'done', 'failed')),
  requested_at timestamptz not null default now(),
  due_at       timestamptz not null,
  cancelled_at timestamptz,
  done_at      timestamptz,
  tries        int not null default 0,
  result       jsonb
);
alter table public.account_deletions enable row level security;
revoke all on table public.account_deletions from public, anon, authenticated;
create unique index if not exists account_deletions_one_pending on public.account_deletions (subject) where status = 'pending';
create index if not exists account_deletions_due on public.account_deletions (due_at) where status = 'pending';
create index if not exists account_deletions_subject on public.account_deletions (subject, requested_at desc);

create or replace function public.olnu_deletion_json(p_uid uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce((select jsonb_build_object('v', 1, 'pending', true, 'requested_at', d.requested_at, 'due_at', d.due_at,
                     'days_left', greatest(0, ceil(extract(epoch from (d.due_at - now())) / 86400.0))::int, 'now', now())
                     from public.account_deletions d where d.subject = p_uid::text and d.status = 'pending' limit 1),
                  jsonb_build_object('v', 1, 'pending', false, 'now', now()));
$$;

create or replace function public.my_account_deletion()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  return public.olnu_deletion_json(public.olnu_uid());
end; $$;

create or replace function public.request_account_deletion()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid();
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_acct_del:' || v_uid::text, 0));
  if not exists (select 1 from public.account_deletions d where d.subject = v_uid::text and d.status = 'pending') then
    if (select count(*) from public.account_deletions d where d.subject = v_uid::text and d.requested_at > now() - interval '1 day') >= 5 then
      raise exception 'slow_down';
    end if;
    insert into public.account_deletions (subject, due_at) values (v_uid::text, now() + interval '7 days');
  end if;
  return public.olnu_deletion_json(v_uid);
end; $$;

create or replace function public.cancel_account_deletion()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_n int;
begin
  update public.account_deletions d set status = 'cancelled', cancelled_at = now()
   where d.subject = v_uid::text and d.status = 'pending';
  get diagnostics v_n = row_count;
  return public.olnu_deletion_json(v_uid) || jsonb_build_object('cancelled', v_n > 0);
end; $$;

-- The nightly runner. Not callable by app users (only the owner / pg_cron as postgres).
create or replace function public.olnu_run_due_deletions(p_max int default 25)
returns jsonb language plpgsql security definer set search_path to 'public', 'auth' as $$
declare
  r record;
  v_res jsonb;
  v_ok boolean;
  v_done int := 0;
  v_fail int := 0;
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_sub text := coalesce(current_setting('request.jwt.claim.sub', true), '');
begin
  for r in
    select d.id, d.subject, d.tries from public.account_deletions d
     where d.status = 'pending' and d.due_at <= now()
     order by d.due_at, d.id
     limit greatest(1, least(coalesce(p_max, 25), 200))
     for update skip locked
  loop
    if r.subject is null or r.subject !~ '^[0-9a-f-]{36}$' or not exists (select 1 from auth.users u where u.id = r.subject::uuid) then
      -- the account is already gone (for example "Radera direkt" during the 7 days)
      update public.account_deletions d set status = 'done', done_at = now(), subject = null,
             result = jsonb_build_object('ok', true, 'already_gone', true) where d.id = r.id;
      v_done := v_done + 1;
      continue;
    end if;
    begin
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', json_build_object('sub', r.subject, 'role', 'authenticated')::text, true);
      v_res := public.delete_my_data_v2();
      v_ok := coalesce((v_res ->> 'ok')::boolean, false);
    exception when others then
      v_res := jsonb_build_object('ok', false, 'error', sqlerrm);
      v_ok := false;
    end;
    perform set_config('request.jwt.claims', v_claims, true);
    perform set_config('request.jwt.claim.sub', v_sub, true);
    if v_ok then
      update public.account_deletions d set status = 'done', done_at = now(), subject = null, tries = d.tries + 1,
             result = jsonb_build_object('ok', true, 'auth_deleted', v_res -> 'auth_deleted', 'deleted_rows', v_res -> 'deleted_rows',
                                         'anonymised_rows', v_res -> 'anonymised_rows')
       where d.id = r.id;
      v_done := v_done + 1;
    else
      update public.account_deletions d set tries = d.tries + 1, result = v_res,
             status = case when d.tries + 1 >= 3 then 'failed' else 'pending' end
       where d.id = r.id;
      v_fail := v_fail + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'done', v_done, 'failed', v_fail, 'at', now());
end; $$;

revoke all on function public.olnu_deletion_json(uuid) from public, anon, authenticated;
revoke all on function public.olnu_run_due_deletions(int) from public, anon, authenticated;
revoke all on function public.my_account_deletion() from public, anon;
revoke all on function public.request_account_deletion() from public, anon;
revoke all on function public.cancel_account_deletion() from public, anon;
grant execute on function public.my_account_deletion() to authenticated;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;

-- Nightly job (pg_cron is on live: 1.6.4). Same name again = the job is updated, not doubled.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('olnu-account-deletions', '41 2 * * *', 'select public.olnu_run_due_deletions(50)');
  end if;
end $$;
