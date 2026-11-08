-- public.golden_horse(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 8140ab5982edfc19bf964c22a5bf2744
CREATE OR REPLACE FUNCTION public.golden_horse(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_town text; g public.golden_horses; v_state text; v_out jsonb; v_badges jsonb;
begin
  if p_lat is not null and public.olnu_world_ok(p_lat, p_lng) then v_town := public.olnu_town_of(p_lat, p_lng); end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', public.olnu_gh_name(x.u, v_uid), 'is_me', x.u = v_uid, 'until', x.until) order by x.until desc), '[]'::jsonb)
    into v_badges
    from (select h.claimed_by u, max(h.claimed_at) + interval '7 days' until from public.golden_horses h
           where h.claimed_at > now() - interval '7 days' and h.claimed_by is not null
             and (h.claimed_by = v_uid or exists (select 1 from public.group_members a join public.group_members c on c.group_id = a.group_id
                                                   where a.user_id = h.claimed_by and c.user_id = v_uid))
           group by h.claimed_by) x;
  v_out := jsonb_build_object('v', 1, 'server_time', now(), 'badges', v_badges,
    'mine_total', (select count(*) from public.golden_horses h where h.claimed_by = v_uid));
  if v_town is null then return v_out || jsonb_build_object('state', 'none'); end if;
  g := public.olnu_gh_get(v_town);
  if g.id is null or g.bar_id is null then return v_out || jsonb_build_object('state', 'none', 'town', v_town); end if;
  v_state := case when g.claimed_by is not null then 'claimed' when now() < g.appears_at then 'waiting' when now() < g.ends_at then 'live' else 'gone' end;
  if v_state = 'waiting' then
    return v_out || jsonb_build_object('state', v_state, 'town', v_town, 'week', g.week);
  end if;
  return v_out || jsonb_build_object('state', v_state, 'town', v_town, 'week', g.week, 'id', g.id, 'bar_id', g.bar_id, 'bar_name', g.bar_name,
    'lat', g.lat, 'lng', g.lng, 'appears_at', g.appears_at, 'ends_at', g.ends_at, 'claimed_at', g.claimed_at,
    'winner_mine', g.claimed_by = v_uid, 'winner_name', case when g.claimed_by is null then null else public.olnu_gh_name(g.claimed_by, v_uid) end);
end; $function$;
