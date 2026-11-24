-- 0534 · Privacy start state for a NEW account (lane texts, OWNER-INPUTS B3 / PLAN B8, owner default 24 Nov 2026).
-- COORDINATOR-RUN, staging first. Additive and idempotent: one function (create or replace), one trigger (create or replace).
-- The rule: a new account starts as "Bara vänner" (0340: friends + group mates see the pin, strangers get no row).
-- Existing accounts keep what they have: the trigger runs only for a NEW row in auth.users (a first sign-in, anonymous
-- or e-mail). No existing row in olnu_visibility is changed (on conflict do nothing). my_visibility() is unchanged:
-- an account with no row still reads friends_only = false (= Alla, as today).
-- Not in SQL (they are phone settings, see docs/js/privstart.js): area position (olnu.prec = area) and the position
-- log off (olnu.logLoc = 0) for a new install.
-- Safety: a sign-up must never fail because of this. Any error inside the insert is caught and ignored.
-- The function is a trigger function (it cannot be called as an RPC). Execute is revoked from public, anon, authenticated.
-- Edge case (known, privacy-safe): a recovery code (0160 olnu_move_user) moves an old account onto the new phone's
-- account. When the old account had no row (= Alla), the new account's row (friends_only = true) stays. The person
-- then sees "Bara vänner" and can change it in one tap. Nothing becomes more visible than before.
-- Post-checks (staging, then live):
--   select tgname, tgenabled from pg_trigger where tgname = 'olnu_new_user_privacy';             -- 1 row, 'O'
--   select count(*) from public.olnu_visibility where updated_at > now() - interval '1 day';     -- grows with new sign-ups
--   one new anonymous sign-in on /test/, then: select public.my_visibility(); as that user      -- friends_only true
--   an old test account: my_visibility() unchanged.

create or replace function public.olnu_new_user_privacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.olnu_visibility (user_id, friends_only, updated_at)
    values (new.id, true, now())
    on conflict (user_id) do nothing;
  exception when others then
    null;   -- never block a sign-up
  end;
  return new;
end $$;

revoke all on function public.olnu_new_user_privacy() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_new_user_privacy() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_new_user_privacy() from authenticated';
  end if;
end $$;

create or replace trigger olnu_new_user_privacy
  after insert on auth.users
  for each row execute function public.olnu_new_user_privacy();

select public.olnu_strip_cr();
