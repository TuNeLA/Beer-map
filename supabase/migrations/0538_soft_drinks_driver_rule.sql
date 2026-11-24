-- 0538 · Water + soda log, and no driver mode after a drink (lane fixB, polish sweep 24 Nov 2026: P-17 + P-01).
-- COORDINATOR-RUN, staging first. Client: docs/js/extras.js (post_soft), docs/js/nightlog.js (my_soft_tonight),
-- docs/js/lask.js + docs/js/skjuts.js (the driver rule; the client blocks first, this is the server's copy of the rule).
-- What it adds / changes:
--   public.soft_log (id, user_id, night, at, kind)   NEW table. kind = 'vatten' | 'lask'. No position, no bar, no group.
--       It is NOT a drink: never in beers / drink_log, so never in a count, a streak, a medal, a 5/10 push, the ride
--       "drinking" rule (olnu_ride_drinking) or the driver unlock (ride_lask stays the driver's own LÄSK! table).
--       RLS on, all table rights revoked: only the two functions below read or write it.
--       Account erase: delete_my_data_v2 removes every row with a user_id column (c_own), so this table is covered.
--   post_soft(p_kind text) -> {ok, kind, n, vatten, lask}   NEW. One row for the caller. n = this kind tonight.
--       'invalid_kind' for another kind; 'slow_down' when the caller logged one in the last 20 s.
--   my_soft_tonight() -> {vatten, lask}   NEW. The caller's own numbers for tonight (olnu_night_of(now())).
--   driver_set(p_on boolean)   REPLACED (same signature, owner, grants). The only change: p_on = true while
--       olnu_ride_drinking(caller) (a drink logged tonight, not undone, or a live pin with drinks) raises 'drinking'.
--       Turning driving OFF is never refused. The rest of the text = schema/functions/driver_set(boolean).sql.
-- Grants: execute for authenticated only (revoked from public and anon). SECURITY DEFINER, fixed search_path, the caller
-- from public.olnu_uid() (auth.uid(); raises not_authenticated) in each body.
-- Old client: never calls post_soft / my_soft_tonight. An old client that turns driving on after a drink gets the error
-- toast "Det gick int'. Försök igen." (no 'drinking' text in the old skjuts.js) and driving stays off: the safe side.
-- New client + server without 0538: PGRST202 = the water / soda row hides after one calm line; the driver rule still
-- holds on the phone (lask.js).
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_uid, olnu_night_of, olnu_ride_drinking (0420), driver_status (0250),
--   olnu_strip_cr (0436).
-- Check after the run (expect t, t, t, t, t, t, t):
--   select to_regclass('public.soft_log') is not null,
--     to_regprocedure('public.post_soft(text)') is not null,
--     to_regprocedure('public.my_soft_tonight()') is not null,
--     not has_function_privilege('anon', 'public.post_soft(text)', 'execute'),
--     has_function_privilege('authenticated', 'public.my_soft_tonight()', 'execute'),
--     position('olnu_ride_drinking' in pg_get_functiondef('public.driver_set(boolean)'::regprocedure)) > 0,
--     not has_table_privilege('authenticated', 'public.soft_log', 'select');

create table if not exists public.soft_log (
  id      bigserial primary key,
  user_id uuid not null,
  night   timestamptz not null,
  at      timestamptz not null default now(),
  kind    text not null check (kind in ('vatten', 'lask'))
);
create index if not exists soft_log_user_idx on public.soft_log (user_id, night);
alter table public.soft_log enable row level security;
revoke all on table public.soft_log from public;
revoke all on table public.soft_log from anon;
revoke all on table public.soft_log from authenticated;

create or replace function public.post_soft(p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz := public.olnu_night_of(now()); v_k text := lower(coalesce(p_kind, ''));
  v_v int; v_l int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_k not in ('vatten', 'lask') then raise exception 'invalid_kind'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-soft:' || v_uid::text, 0));
  if exists (select 1 from public.soft_log s where s.user_id = v_uid and s.at > now() - interval '20 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.soft_log (user_id, night, kind) values (v_uid, v_night, v_k);
  select count(*) filter (where s.kind = 'vatten')::int, count(*) filter (where s.kind = 'lask')::int into v_v, v_l
    from public.soft_log s where s.user_id = v_uid and s.night = v_night;
  return jsonb_build_object('ok', true, 'kind', v_k, 'n', case when v_k = 'vatten' then v_v else v_l end, 'vatten', v_v, 'lask', v_l);
end; $$;

create or replace function public.my_soft_tonight()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz := public.olnu_night_of(now()); v_v int; v_l int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select count(*) filter (where s.kind = 'vatten')::int, count(*) filter (where s.kind = 'lask')::int into v_v, v_l
    from public.soft_log s where s.user_id = v_uid and s.night = v_night;
  return jsonb_build_object('vatten', coalesce(v_v, 0), 'lask', coalesce(v_l, 0));
end; $$;

-- driver_set: the text of schema/functions/driver_set(boolean).sql + the drink rule (fixB P-01).
create or replace function public.driver_set(p_on boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz := public.olnu_night_of(now());
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-driver:' || v_uid::text, 0));
  if exists (select 1 from public.driver_status d where d.user_id = v_uid and d.updated_at > now() - interval '1 second') then
    raise exception 'slow_down';
  end if;
  if coalesce(p_on, false) then
    if public.olnu_ride_drinking(v_uid) then raise exception 'drinking'; end if;   -- fixB P-01: a drink tonight = no driver mode
    insert into public.driver_status (user_id, night, updated_at) values (v_uid, v_night, now())
    on conflict (user_id) do update set night = excluded.night, updated_at = now();
  else
    update public.driver_status set night = v_night - interval '1 day', updated_at = now() where user_id = v_uid;
  end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, false));
end; $function$;

revoke all on function public.post_soft(text) from public;
revoke all on function public.post_soft(text) from anon;
revoke all on function public.my_soft_tonight() from public;
revoke all on function public.my_soft_tonight() from anon;
grant execute on function public.post_soft(text) to authenticated;
grant execute on function public.my_soft_tonight() to authenticated;
revoke all on function public.driver_set(boolean) from public;
revoke all on function public.driver_set(boolean) from anon;
grant execute on function public.driver_set(boolean) to authenticated;

select public.olnu_strip_cr();
