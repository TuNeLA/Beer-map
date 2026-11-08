-- public.my_past_events(p_limit integer)
-- live md5(pg_get_functiondef) = 23328c95f8fb2394012c97873feb66eb
CREATE OR REPLACE FUNCTION public.my_past_events(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return jsonb_build_object('v', 1, 'now', now(), 'events', coalesce((
    select jsonb_agg(x.j order by x.s desc) from (
      select i.starts_at as s, jsonb_build_object(
        'group_id', t.group_id, 'invite_id', i.id, 'title', i.title, 'kind', i.kind, 'place', i.place, 'starts_at', i.starts_at,
        'night', public.olnu_night_of(i.starts_at), 'evening', public.olnu_evening(public.olnu_night_of(i.starts_at)),
        'mine', i.creator = v_uid,
        'people', (select count(*) from public.olnu_evg_people(t.group_id))::int,
        'names', (select coalesce(jsonb_agg(e.name order by e.creator desc, e.ord), '[]'::jsonb)
                    from (select * from public.olnu_evg_people(t.group_id) limit 8) e),
        'drinks', (select coalesce(sum(m.beers + m.others), 0)::int from public.medal_nights m
                    where m.night = public.olnu_night_of(i.starts_at) and m.user_id in (select e.user_id from public.olnu_evg_people(t.group_id) e)),
        'photos', (select count(*) from public.chat_photos cp where cp.group_id = t.group_id)::int,
        'msgs', (select count(*) from public.group_msgs gm where gm.group_id = t.group_id and left(gm.body, 1) <> chr(8291))::int) as j
        from public.temp_groups t
        join public.invites i on i.id = t.invite_id
       where i.status <> 'cancelled' and t.closed_at is null
         and now() >= public.olnu_night_of(i.starts_at)
         and i.starts_at > now() - interval '365 days'
         and (i.creator = v_uid or exists (select 1 from public.invite_people p where p.invite_id = i.id and p.user_id = v_uid and p.answer in ('yes', 'maybe')))
       order by i.starts_at desc
       limit greatest(1, least(50, coalesce(p_limit, 20)))) x), '[]'::jsonb));
end; $function$;
