-- public.film_poll()
-- live md5(pg_get_functiondef) = d794e466596fec846551a4e31c58e848
CREATE OR REPLACE FUNCTION public.film_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  r       record;
  v_rolls jsonb := '[]'::jsonb;
  v_mine  boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  for r in select sp.group_id, sp.night, min(sp.reveal_at) as rev, count(*)::int as n
             from public.snap_photos sp
             join public.group_members m on m.group_id = sp.group_id and m.user_id = v_uid
            where sp.kind = 'film' and sp.reveal_at <= now() and sp.reveal_at > now() - interval '20 hours'
            group by sp.group_id, sp.night loop
    v_mine := false;
    insert into public.film_rolls (group_id, night, claimed_by, claimed_at)
    values (r.group_id, r.night, v_uid, now())
    on conflict (group_id, night) do nothing;
    if found then v_mine := true; end if;
    if not v_mine then
      v_mine := exists (select 1 from public.film_rolls f where f.group_id = r.group_id and f.night = r.night
                         and f.claimed_by = v_uid and not f.notified and f.claimed_at > now() - interval '10 minutes');
    end if;
    v_rolls := v_rolls || jsonb_build_array(jsonb_build_object('group_id', r.group_id,
      'group_name', (select g.name from public.groups g where g.id = r.group_id),
      'night', r.night, 'develop_at', r.rev, 'n', r.n, 'push_mine', v_mine));
  end loop;
  return jsonb_build_object('v', 2, 'now', now(), 'night', v_night, 'develop_at', public.olnu_gang_reveal(v_night),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group_id', m.group_id,
        'mine', (select count(*) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night and sp.user_id = v_uid)::int,
        'left', greatest(0, 10 - (select count(*) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night and sp.user_id = v_uid))::int,
        'group_n', (select count(*) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night)::int,
        'group_name', (select g.name from public.groups g where g.id = m.group_id),
        'shooters', (select count(distinct sp.user_id) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night)::int,
        'first_name', (select gm.display_name from public.film_starts fs join public.group_members gm on gm.group_id = fs.group_id and gm.user_id = fs.started_by
                        where fs.group_id = m.group_id and fs.night = v_night),
        'first_me', coalesce((select fs.started_by = v_uid from public.film_starts fs where fs.group_id = m.group_id and fs.night = v_night), false),
        'first_at', (select fs.created_at from public.film_starts fs where fs.group_id = m.group_id and fs.night = v_night)))
        from public.group_members m where m.user_id = v_uid), '[]'::jsonb),
    'rolls', v_rolls);
end; $function$;
