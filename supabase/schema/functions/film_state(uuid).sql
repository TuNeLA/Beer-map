-- public.film_state(p_group_id uuid)
-- live md5(pg_get_functiondef) = 76725beea903be46ecd159c1eed879ae
CREATE OR REPLACE FUNCTION public.film_state(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object(
    'now', now(), 'night', v_night, 'develop_at', public.olnu_gang_reveal(v_night),
    'mine', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film'
              and sp.night = v_night and sp.user_id = v_uid)::int,
    'left', greatest(0, 10 - (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film'
              and sp.night = v_night and sp.user_id = v_uid))::int,
    'max', 10,
    'group_n', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night)::int,
    'group_max', 60,
    'shooters', (select count(distinct sp.user_id) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night)::int,
    'keeps', public.olnu_group_keeps(p_group_id),
    'rolls', coalesce((select jsonb_agg(jsonb_build_object('night', x.night, 'evening', public.olnu_evening(x.night),
                 'develop_at', x.rev, 'n', x.n, 'alive', x.alive) order by x.night desc)
               from (select sp.night, min(sp.reveal_at) as rev, count(*)::int as n,
                            count(*) filter (where sp.bytes is not null and sp.expires_at > now())::int as alive
                       from public.snap_photos sp
                      where sp.group_id = p_group_id and sp.kind = 'film' and sp.reveal_at <= now()
                        and sp.created_at > now() - interval '32 days'
                      group by sp.night order by sp.night desc limit 10) x), '[]'::jsonb));
end; $function$;
