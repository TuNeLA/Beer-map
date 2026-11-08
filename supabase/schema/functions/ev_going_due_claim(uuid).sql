-- public.ev_going_due_claim(p_uid uuid)
-- live md5(pg_get_functiondef) = 5234504f5cde21d14af7e164faf4c77a
CREATE OR REPLACE FUNCTION public.ev_going_due_claim(p_uid uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end; $function$;
