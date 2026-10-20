-- 0044 v27 fix: film_roll takes the reveal time from the roll's rows (same as film_poll / film_photo), so every
-- read agrees on when a roll is developed. Same params and return shape as 0042. Safe to run again.

-- film_roll(p_group_id, p_night default null = the newest developed roll) -> jsonb
--   {night, evening, develop_at, developed, n, gone, photos:[{id, k, name, is_me, at, w, h, reacts[{e,n}], n, my}]}.
--   Before 10:00: developed = false and no photos. Error: not_member.
create or replace function public.film_roll(p_group_id uuid, p_night timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
end; $$;

revoke all on function public.film_roll(uuid, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.film_roll(uuid, timestamptz) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.film_roll(uuid, timestamptz) to authenticated';
  end if;
end $$;
