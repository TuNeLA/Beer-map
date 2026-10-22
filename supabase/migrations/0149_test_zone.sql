-- 0149 Test zone: live tests (lat 68.35, lng 18.80) must never leak into public / aggregate reads.
-- Box: lat 68.25..68.45, lng 18.60..19.00. A "test user" = a user whose latest pin (beers row, one per user)
-- is in the box; with no beers row, the check-in row decides; else the push location. A test user still
-- sees the test zone (so live tests work); everybody else gets it filtered out.
-- Each patched RPC keeps its signature and return shape: olnu_tz_patch() takes the DEPLOYED definition,
-- makes exact text replacements (each anchor must occur exactly once, else it raises) and runs the
-- resulting CREATE OR REPLACE. A definition that already has the filter is skipped (idempotent).

create or replace function public.olnu_is_test_zone(p_lat double precision, p_lng double precision)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(p_lat between 68.25 and 68.45 and p_lng between 18.60 and 19.00, false);
$$;

create or replace function public.olnu_is_test_user(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_uid is not null and coalesce(
    (select public.olnu_is_test_zone(b.lat, b.lng) from public.beers b where b.user_id = p_uid limit 1),
    (select public.olnu_is_test_zone(c.lat, c.lng) from public.checkins c where c.user_id = p_uid limit 1),
    (select bool_or(public.olnu_is_test_zone(s.lat, s.lng)) from public.push_subscriptions s
      where s.user_id = p_uid and s.lat is not null),
    false);
$$;

create or replace function public.olnu_tz_patch(p_fn regprocedure, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  i int; n int;
begin
  if position('olnu_is_test_' in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_tz_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;

revoke all on function public.olnu_is_test_zone(double precision, double precision) from public, anon;
revoke all on function public.olnu_is_test_user(uuid) from public, anon, authenticated;
revoke all on function public.olnu_tz_patch(regprocedure, text[], text[]) from public, anon, authenticated;
grant execute on function public.olnu_is_test_zone(double precision, double precision) to authenticated;

-- 1. Map pins (poll_v2 pins / pins_in_view / capped, live_beers): strangers' pins in the zone.
select public.olnu_tz_patch('public.olnu_pins(uuid, double precision, double precision, double precision, double precision)',
  array['where c.known or not v_box',
        'between p_min_lng and p_max_lng);'],
  array['where (c.known or not v_box',
        $a$between p_min_lng and p_max_lng))
     and (c.known or not public.olnu_is_test_zone(c.lat, c.lng) or (select public.olnu_is_test_user(p_uid)));$a$]);

-- 2. Heat (poll_v2 heat, heat_points) and ghost heat (last week).
select public.olnu_tz_patch('public.olnu_heat(double precision, double precision, double precision, double precision, integer)',
  array['and not e.undone and e.hlat is not null'],
  array['and not e.undone and e.hlat is not null and (not public.olnu_is_test_zone(coalesce(e.lat, e.hlat), coalesce(e.lng, e.hlng)) or (select public.olnu_is_test_user(auth.uid())))']);

select public.olnu_tz_patch('public.ghost_points()',
  array[$a$and e.created_at <  now() - interval '1 day'$a$],
  array[$a$and e.created_at <  now() - interval '1 day'
       and (not public.olnu_is_test_zone(coalesce(e.lat, e.hlat), coalesce(e.lng, e.hlng)) or (select public.olnu_is_test_user(auth.uid())))$a$]);

-- 3. poll_v2: world count ("N dricker i världen") and check-ins (ticker / crowd news).
select public.olnu_tz_patch('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)',
  array['and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)),',
        'where c0.expires_at > now()'],
  array[$a$and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
                        and (b.user_id = v_uid or not public.olnu_is_test_zone(b.lat, b.lng) or (select public.olnu_is_test_user(v_uid)))),$a$,
        'where c0.expires_at > now() and (c0.user_id = v_uid or not public.olnu_is_test_zone(c0.lat, c0.lng) or (select public.olnu_is_test_user(v_uid)))']);

-- 4. Old live endpoints.
select public.olnu_tz_patch('public.live_others()',
  array['and not b.stopped and b.other_count > 0'],
  array['and not b.stopped and b.other_count > 0 and (b.user_id = auth.uid() or not public.olnu_is_test_zone(b.lat, b.lng) or (select public.olnu_is_test_user(auth.uid())))']);

select public.olnu_tz_patch('public.live_checkins()',
  array['where c.expires_at > now()'],
  array['where c.expires_at > now() and (c.user_id = v_uid or f.fname is not null or not public.olnu_is_test_zone(c.lat, c.lng) or (select public.olnu_is_test_user(v_uid)))']);

-- 5. Bars: takeovers ("Hela gänget ä på X", bar_status owner), queue reports and offers.
select public.olnu_tz_patch('public.olnu_takeovers()',
  array['select distinct on (p.uid) p.uid, p.bid, p.at from pres p order by p.uid, p.at desc'],
  array['select distinct on (p.uid) p.uid, p.bid, p.at from pres p where not public.olnu_is_test_user(p.uid) or (select public.olnu_is_test_user(auth.uid())) order by p.uid, p.at desc']);

select public.olnu_tz_patch('public.bar_status()',
  array['group by x.bar_id',
        'group by o.id'],
  array[$a$and (not public.olnu_is_test_zone(x.bar_lat, x.bar_lng) or (select public.olnu_is_test_user(v_uid)))
     group by x.bar_id$a$,
        $a$and (not public.olnu_is_test_zone(o.bar_lat, o.bar_lng) or (select public.olnu_is_test_user(v_uid)))
     group by o.id$a$]);

-- 6. Boards: beer types ("Sverige"), group league (global top 10).
select public.olnu_tz_patch('public.beer_type_stats(double precision, double precision)',
  array[$a$where bt.created_at >= least(v_week, v_night - interval '24 hours')$a$],
  array[$a$where bt.created_at >= least(v_week, v_night - interval '24 hours')
       and (bt.user_id = v_uid or not public.olnu_is_test_zone(bt.lat, bt.lng) or (select public.olnu_is_test_user(v_uid)))$a$]);

select public.olnu_tz_patch('public.group_league()',
  array['group by gm.group_id having count(*) >= 2'],
  array['group by gm.group_id having count(*) >= 2 and (bool_or(gm.user_id = v_uid) or bool_or(not public.olnu_is_test_user(gm.user_id)) or (select public.olnu_is_test_user(v_uid)))']);

-- 7. Events: the TV list has no radius when tv_lat is null.
select public.olnu_tz_patch('public.events_near2(double precision, double precision, integer)',
  array[$a$where e.tv and e.status = 'ok'$a$],
  array[$a$where e.tv and e.status = 'ok'
           and (not public.olnu_is_test_zone(coalesce(e.tv_lat, e.lat), coalesce(e.tv_lng, e.lng)) or public.olnu_is_test_zone(p_lat, p_lng) or (select public.olnu_is_test_user(v_uid)))$a$]);

select public.olnu_tz_patch('public.events_near3(double precision, double precision, integer)',
  array[$a$where e.tv and e.status = 'ok'$a$],
  array[$a$where e.tv and e.status = 'ok'
           and (not public.olnu_is_test_zone(coalesce(e.tv_lat, e.lat), coalesce(e.tv_lng, e.lng)) or public.olnu_is_test_zone(p_lat, p_lng) or (select public.olnu_is_test_user(v_uid)))$a$]);

-- 8. Social: friend suggestions (friend_suggest, friend_suggest_add), inbox, near_poll friend requests.
select public.olnu_tz_patch('public.olnu_sug_rows(uuid)',
  array['and public.olnu_friend_name(c.uid) is not null;'],
  array[$a$and public.olnu_friend_name(c.uid) is not null
     and (not public.olnu_is_test_user(c.uid) or public.olnu_is_test_user(p_uid));$a$]);

select public.olnu_tz_patch('public.my_inbox()',
  array[$a$x.status = 'pending' and x.requester <> v_uid$a$,
        'and i.creator <> v_uid'],
  array[$a$x.status = 'pending' and x.requester <> v_uid and (not public.olnu_is_test_user(x.requester) or public.olnu_is_test_user(v_uid))$a$,
        'and i.creator <> v_uid and (not public.olnu_is_test_user(i.creator) or public.olnu_is_test_user(v_uid))']);

select public.olnu_tz_patch('public.near_poll(text)',
  array[$a$x.status = 'pending' and x.requester <> v_uid$a$],
  array[$a$x.status = 'pending' and x.requester <> v_uid and (not public.olnu_is_test_user(x.requester) or public.olnu_is_test_user(v_uid))$a$]);
