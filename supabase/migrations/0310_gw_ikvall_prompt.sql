-- 0310 🍺 "UTE IKVÄLL?" – a fixed weekend moment (competitor research idea 1, BeReal / Locket). Additive only.
-- Friday and Saturday ~20:00 (Europe/Stockholm) ONE push "Ute ikväll?" to users who opted in (default OFF).
-- The Ikväll? sheet (0215 ikvall_set / ikvall_status) does the rest ("answer to see" is in the client).
--   ikvall_prompt_get()            → {v, on}                     (authenticated)
--   ikvall_prompt_set(p_on)        → {ok, on}                    (authenticated, 1 change per second)
--   ikvall_prompt_claim(p_limit)   → setof uuid (service_role; notify-group cron). Inside the window only:
--                                    Fri/Sat 20:00–22:29 Stockholm, opted in, has a push subscription, no answer yet
--                                    tonight, not claimed tonight. One UPDATE claims (a double cron run never sends twice).
-- notify-group (gw, not deployed by the agent) sends kind "ikvall": nattro respected, counts in the v28 pace / budget,
-- and an own evening-only rule (Fri/Sat 19–23). No row is ever removed. Safe to run again.

create table if not exists public.ikvall_prompt (
  user_id    uuid primary key,
  enabled    boolean not null default false,
  sent_night timestamptz,                    -- olnu_night_of() of the last claimed push
  sent_at    timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.ikvall_prompt enable row level security;
revoke all on table public.ikvall_prompt from public, anon, authenticated;

create or replace function public.ikvall_prompt_get()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('v', 1, 'on', coalesce((select p.enabled from public.ikvall_prompt p where p.user_id = v_uid), false));
end $$;

create or replace function public.ikvall_prompt_set(p_on boolean)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.ikvall_prompt p where p.user_id = v_uid and p.updated_at > now() - interval '1 second') then
    raise exception 'slow_down';
  end if;
  insert into public.ikvall_prompt (user_id, enabled, updated_at) values (v_uid, coalesce(p_on, false), now())
  on conflict (user_id) do update set enabled = excluded.enabled, updated_at = now();
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, false));
end $$;

create or replace function public.ikvall_prompt_claim(p_limit int default 500)
returns setof uuid language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_l timestamp := now() at time zone 'Europe/Stockholm';
  v_night timestamptz := public.olnu_night_of(now());
begin
  if extract(isodow from v_l) not in (5, 6) or v_l::time < time '20:00' or v_l::time >= time '22:30' then return; end if;
  return query
  with c as (
    select p.user_id from public.ikvall_prompt p
     where p.enabled and p.sent_night is distinct from v_night
       and not exists (select 1 from public.ikvall_status s where s.user_id = p.user_id and s.night = v_night)
       and exists (select 1 from public.push_subscriptions ps where ps.user_id = p.user_id)
       and not public.olnu_is_test_user(p.user_id)
     order by p.user_id
     limit greatest(1, least(2000, coalesce(p_limit, 500)))
     for update skip locked
  )
  update public.ikvall_prompt p set sent_night = v_night, sent_at = now()
    from c where p.user_id = c.user_id
  returning p.user_id;
end $$;

revoke all on function public.ikvall_prompt_get() from public, anon;
revoke all on function public.ikvall_prompt_set(boolean) from public, anon;
revoke all on function public.ikvall_prompt_claim(int) from public, anon, authenticated;
grant execute on function public.ikvall_prompt_get() to authenticated;
grant execute on function public.ikvall_prompt_set(boolean) to authenticated;
grant execute on function public.ikvall_prompt_claim(int) to service_role;
