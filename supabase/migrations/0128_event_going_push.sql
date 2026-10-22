-- Öl Nu — 📅 GÅR: the "⏰ Om 1 timme" push for people who tapped Går (CONTRACT "📅 EVENT-ARKET 2"). Additive, needs 0127.
-- ev_going_due_claim(p_uid default null) — service_role only (notify-group). Claims every going row whose event starts in
-- 50–70 min (reminded_at null → now, one UPDATE, so a double cron run never sends twice). p_uid = only that person's rows
-- (the app's own fallback {event:"ev_due"}). Returns jsonb [{event_id, title, place, starts_at, tv, total, to:[user ids]}].

create or replace function public.ev_going_due_claim(p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  with c as (
    update public.event_going g set reminded_at = now()
      from public.bar_events e
     where e.id = g.event_id and g.going and g.reminded_at is null and e.status = 'ok'
       and e.starts_at between now() + interval '50 minutes' and now() + interval '70 minutes'
       and (p_uid is null or g.user_id = p_uid)
    returning g.event_id, g.user_id
  ), ev as (
    select c.event_id, jsonb_agg(c.user_id) as uids from c group by c.event_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'place', e.place, 'starts_at', e.starts_at,
           'tv', e.tv, 'to', ev.uids,
           'total', (select count(*) from public.event_going g2 where g2.event_id = e.id and g2.going))), '[]'::jsonb)
    into v
    from ev join public.bar_events e on e.id = ev.event_id;
  return v;
end; $$;

do $$
declare
  v_fns text := 'public.ev_going_due_claim(uuid)';
begin
  execute 'revoke all on function ' || v_fns || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || v_fns || ' from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || v_fns || ' from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || v_fns || ' to service_role'; end if;
end $$;
