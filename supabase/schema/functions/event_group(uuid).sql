-- public.event_group(p_group_id uuid)
-- live md5(pg_get_functiondef) = 46297f5a3e493169fa5cb0792d75574b
CREATE OR REPLACE FUNCTION public.event_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  t public.temp_groups; i public.invites;
  v_acc text; v_night timestamptz;
begin
  select * into t from public.temp_groups x where x.group_id = p_group_id;
  if not found then raise exception 'not_member'; end if;
  v_acc := public.olnu_tg_access(p_group_id, v_uid);
  if coalesce(v_acc, 'none') = 'none' and not public.olnu_evg_was(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into i from public.invites x where x.id = t.invite_id;
  v_night := public.olnu_night_of(i.starts_at);
  return jsonb_build_object('v', 1, 'now', now(), 'group_id', t.group_id, 'invite_id', i.id, 'title', i.title, 'kind', i.kind,
    'place', i.place, 'bar_id', i.bar_id, 'lat', i.lat, 'lng', i.lng, 'starts_at', i.starts_at, 'open_until', t.open_until, 'hide_at', t.hide_at,
    'night', v_night, 'evening', public.olnu_evening(v_night), 'past', now() >= v_night,
    'state', case when t.closed_at is not null or i.status <> 'open' then 'cancelled' when now() >= t.open_until then 'archived' else 'open' end,
    'can_write', coalesce(v_acc, 'none') = 'write', 'can_play', public.olnu_evg_member(p_group_id, v_uid),
    'mine', i.creator = v_uid,
    'my_answer', (select p.answer from public.invite_people p where p.invite_id = i.id and p.user_id = v_uid),
    'invited', (select count(*) from public.invite_people p where p.invite_id = i.id)::int,
    'people', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_rnd_k(p_group_id, e.user_id), 'name', e.name, 'answer', e.answer,
                 'creator', e.creator, 'is_me', e.user_id = v_uid,
                 'out', exists (select 1 from public.beers b where b.user_id = e.user_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)))
               order by e.creator desc, e.answer, e.ord) from public.olnu_evg_people(p_group_id) e), '[]'::jsonb));
end; $function$;
