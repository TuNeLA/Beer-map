-- Öl Nu 0162 🚪 CHECKA UT (owner 2026-11-07: "when I am checked in at this bar, show Checka ut"). Additive.
-- check_out() -> jsonb {ok, bar_id, bar_name}
-- Ends the caller's active check-in now: sets checkins.expires_at = now() (the row stays; every reader
-- filters on expires_at > now(), so it is gone from live_checkins at once). ok=false when nothing is active.
-- No old RPC, parameter or returned field changes.
create or replace function public.check_out()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.checkins%rowtype;
begin
  update public.checkins c
     set expires_at = now()
   where c.user_id = v_uid and c.expires_at > now()
  returning * into v_row;
  if not found then
    return jsonb_build_object('ok', false, 'bar_id', null, 'bar_name', null);
  end if;
  return jsonb_build_object('ok', true, 'bar_id', v_row.bar_id, 'bar_name', v_row.bar_name);
end $$;

revoke all on function public.check_out() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.check_out() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.check_out() to authenticated';
  end if;
end $$;
