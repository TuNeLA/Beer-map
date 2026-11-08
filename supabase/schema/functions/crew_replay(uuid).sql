-- public.crew_replay(p_group_id uuid)
-- live md5(pg_get_functiondef) = 5856209286cab40394832bd805f1c14f
CREATE OR REPLACE FUNCTION public.crew_replay(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_crew_now();
  v_last timestamptz := public.olnu_crew_last_night(v_now);
  v_pts jsonb; v_mem jsonb; v_sum jsonb;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_now >= v_last + interval '13 hours' then
    return jsonb_build_object('available', false, 'opens_at', public.olnu_night_of(v_now));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_crew_k(p_group_id, t.user_id), 'at', t.at,
           'lat', t.lat, 'lng', t.lng, 'bar_name', t.bar_name, 'kind', t.kind) order by t.at, t.id), '[]'::jsonb)
    into v_pts
    from (select x.* from public.crew_tracks x join public.group_members m on m.group_id = p_group_id and m.user_id = x.user_id
           where x.night = v_last order by x.at limit 1500) t;
  if jsonb_array_length(v_pts) = 0 then
    return jsonb_build_object('available', false, 'empty', true, 'opens_at', public.olnu_night_of(v_now));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_crew_k(p_group_id, m.user_id), 'name', m.display_name,
           'is_me', m.user_id = v_uid,
           'home_at', (select an.home_at from public.after_nights an where an.user_id = m.user_id and an.night = v_last),
           'bye_at', (select y.at from public.crew_byes y where y.user_id = m.user_id and y.night = v_last and y.cleared_at is null))
           order by m.joined_at), '[]'::jsonb)
    into v_mem from public.group_members m
   where m.group_id = p_group_id
     and exists (select 1 from public.crew_tracks x where x.user_id = m.user_id and x.night = v_last);
  select jsonb_build_object(
    'members_out', count(distinct x.user_id),
    'bars', count(distinct x.bar_id) filter (where x.bar_id is not null),
    'checkins', count(*) filter (where x.kind = 'ci'),
    'points', count(*),
    'first_at', min(x.at), 'last_at', max(x.at),
    'top_bar', (select y.bar_name from public.crew_tracks y join public.group_members m2 on m2.group_id = p_group_id and m2.user_id = y.user_id
                 where y.night = v_last and y.bar_name is not null
                 group by y.bar_name order by count(distinct y.user_id) desc, count(*) desc limit 1),
    'torch', (select count(*) from public.crew_torch_hops h join public.crew_torches tt on tt.id = h.torch_id
               where h.to_group = p_group_id and tt.night = v_last))
    into v_sum
    from public.crew_tracks x join public.group_members m on m.group_id = p_group_id and m.user_id = x.user_id
   where x.night = v_last;
  return jsonb_build_object('available', true, 'night', v_last, 'evening', public.olnu_evening(v_last),
    'members', v_mem, 'points', v_pts, 'summary', v_sum);
end; $function$;
