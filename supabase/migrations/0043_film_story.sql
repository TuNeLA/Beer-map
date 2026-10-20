-- 0043 v27 Engångskameran in Morgontidningen. A helper next to group_night_story (0032), so 0032 stays as it is:
-- film_story(p_group_id, p_night date default null) -> jsonb {night, evening, develop_at, developed, n, skal_n, camera_photos:[...]}
--   Same night rule as group_night_story: p_night = the evening date (olnu_evening); null = the night that ended last;
--   a later date is capped to tonight. camera_photos only when the roll is developed (10:00): the top 4 by reactions,
--   then oldest first: [{id, by, at, w, h, reacts, caption: null, camera: true}] (same keys as group_night_story photos).
--   skal_n = skåltimmar of that night. The client (gang.js) prefers camera_photos for the front photo and the strip.
-- Read only. Needs 0040-0042. SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only.

create or replace function public.film_story(p_group_id uuid, p_night date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_tz constant text := 'Europe/Stockholm';
  v_cur timestamptz := public.olnu_night_of(now());
  v_end timestamptz;
  v_rev timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_night is null then
    v_end := ((v_cur at time zone v_tz) - interval '1 day') at time zone v_tz;
  else
    v_end := ((p_night + 1)::timestamp + time '05:00') at time zone v_tz;
    if v_end > v_cur then v_end := v_cur; end if;
  end if;
  v_rev := public.olnu_gang_reveal(v_end);
  return jsonb_build_object('night', v_end, 'evening', public.olnu_evening(v_end), 'develop_at', v_rev,
    'developed', v_rev <= now(),
    'n', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_end)::int,
    'skal_n', (select count(*) from public.skal_hours h where h.group_id = p_group_id and h.night = v_end)::int,
    'camera_photos', case when v_rev > now() then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'by', x.display_name, 'at', x.created_at, 'w', x.w, 'h', x.h,
               'reacts', x.n, 'caption', null, 'camera', true) order by x.n desc, x.created_at)
        from (select sp.id, sp.created_at, sp.w, sp.h, m.display_name,
                     (select count(*) from public.film_reacts r where r.photo_id = sp.id and r.active)::int as n
                from public.snap_photos sp
                join public.group_members m on m.group_id = p_group_id and m.user_id = sp.user_id
               where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_end
                 and sp.bytes is not null and sp.expires_at > now()
               order by 6 desc, sp.created_at limit 4) x), '[]'::jsonb) end);
end; $$;

revoke all on function public.film_story(uuid, date) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.film_story(uuid, date) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.film_story(uuid, date) to authenticated';
  end if;
end $$;
