-- public.film_roll(p_group_id uuid, p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = 1444be2e3979765a8ec3e31f39d1f4dd
CREATE OR REPLACE FUNCTION public.film_roll(p_group_id uuid, p_night timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := p_night;
  v_rev   timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_night is null then
    select max(sp.night) into v_night from public.snap_photos sp
     where sp.group_id = p_group_id and sp.kind = 'film' and sp.reveal_at <= now() and sp.created_at > now() - interval '32 days';
  end if;
  if v_night is null then
    return jsonb_build_object('night', null, 'developed', false, 'n', 0, 'gone', 0, 'photos', '[]'::jsonb);
  end if;
  v_rev := coalesce((select min(sp.reveal_at) from public.snap_photos sp
                      where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night),
                    public.olnu_gang_reveal(v_night));
  if v_rev > now() then
    return jsonb_build_object('night', v_night, 'evening', public.olnu_evening(v_night), 'develop_at', v_rev, 'developed', false,
      'n', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night)::int,
      'gone', 0, 'photos', '[]'::jsonb);
  end if;
  return jsonb_build_object('night', v_night, 'evening', public.olnu_evening(v_night), 'develop_at', v_rev, 'developed', true,
    'n', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night)::int,
    'gone', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night
              and not (sp.bytes is not null and sp.expires_at > now()))::int,
    'expires_at', (select max(sp.expires_at) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night),
    'photos', coalesce((select jsonb_agg(public.olnu_film_photo_json(sp, v_uid) order by sp.created_at, sp.id)
                          from public.snap_photos sp
                         where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night
                           and sp.bytes is not null and sp.expires_at > now()
                           and exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = sp.user_id)), '[]'::jsonb));
end; $function$;
