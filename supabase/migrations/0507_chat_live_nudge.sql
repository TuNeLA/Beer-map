-- 0507 · chat live nudge (lane s1speed, 13 Nov 2026). OWNER-RUN. Staging first. Needs 0136-0138 (DM) and Supabase Realtime.
-- Owner: "when I DM someone it takes a couple of seconds before the message reaches them - make it quicker".
-- Today the other phone sees a new chat line only at its next chat tick (7 s, then 15 s, then 30 s when quiet).
-- This file makes the server send a tiny Realtime Broadcast "nudge" when a chat line is saved. The app (docs/js/live.js,
-- flag OLNU_CONFIG.dmLive, default OFF) listens on a PRIVATE channel per open chat and then reads that one chat at once.
--   1. olnu_live_msg_tg: AFTER INSERT on group_msgs -> realtime.send({i: <msg id>}, 'm', 'pnc:<group id>', private).
--      No message text, no name, no user id in the nudge. Only the id (the app fetches the line with group_msgs as today).
--   2. olnu_live_seen_tg: AFTER INSERT / UPDATE OF seen_id on dm_state -> 's' nudge (the "Sett" mark comes at once,
--      and the DM chat can stop asking dm_seen every 4 s).
--   3. Realtime Authorization: a SELECT policy on realtime.messages. Only a person who may read the chat
--      (olnu_chat_can: member, event chat, or one of the 2 DM people) can join 'pnc:<group id>'. No INSERT policy:
--      apps cannot send on these channels, only the database can.
-- realtime.send never fails the insert (it catches every error and only logs a warning); the triggers also catch errors.
-- Additive: create or replace function, create or replace trigger, policy only if missing, grants. Nothing is removed.
-- Safe to run twice. No index is added (group_msgs has (group_id, id); see DONE.md server notes).
-- Check after the run (expect t, t, t, t):
--   select to_regprocedure('public.olnu_live_can(text)') is not null,
--     exists (select 1 from pg_trigger where tgname = 'olnu_zz_live_msg'),
--     exists (select 1 from pg_trigger where tgname = 'olnu_zz_live_seen_u'),
--     exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'pn_live_chat_read');

-- 1. the chat nudge
create or replace function public.olnu_live_msg_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(jsonb_build_object('i', new.id), 'm', 'pnc:' || new.group_id::text, true);
  exception when others then
    null;   -- a nudge is a bonus: the chat line is saved anyway, the app still polls
  end;
  return null;
end $$;

create or replace trigger olnu_zz_live_msg after insert on public.group_msgs
  for each row execute function public.olnu_live_msg_tg();

-- 2. the DM "Sett" nudge
create or replace function public.olnu_live_seen_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(jsonb_build_object('s', 1), 's', 'pnc:' || new.group_id::text, true);
  exception when others then
    null;
  end;
  return null;
end $$;

create or replace trigger olnu_zz_live_seen_i after insert on public.dm_state
  for each row execute function public.olnu_live_seen_tg();
create or replace trigger olnu_zz_live_seen_u after update of seen_id on public.dm_state
  for each row when (old.seen_id is distinct from new.seen_id) execute function public.olnu_live_seen_tg();

-- 3. who may join 'pnc:<group id>' (Realtime calls this once per channel join, as the joining user)
create or replace function public.olnu_live_can(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_gid uuid;
begin
  if p_topic is null or p_topic !~ '^pnc:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  v_gid := substr(p_topic, 5)::uuid;
  return coalesce(public.olnu_chat_can(v_gid, auth.uid(), false), false);
exception when others then
  return false;
end $$;

revoke all on function public.olnu_live_can(text) from public, anon;
grant execute on function public.olnu_live_can(text) to authenticated;
revoke all on function public.olnu_live_msg_tg() from public;
revoke all on function public.olnu_live_seen_tg() from public;
-- Supabase grants new functions to anon/authenticated by default privileges: take them back (sqlauto found them callable)
revoke all on function public.olnu_live_msg_tg() from anon, authenticated;
revoke all on function public.olnu_live_seen_tg() from anon, authenticated;

do $$
begin
  -- an empty Postgres (CI schema rehearsal) has no Supabase Realtime schema: skip the policy there
  if to_regclass('realtime.messages') is not null and not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'pn_live_chat_read') then
    create policy pn_live_chat_read on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast' and public.olnu_live_can(realtime.topic()));
  end if;
end $$;

select public.olnu_strip_cr();
