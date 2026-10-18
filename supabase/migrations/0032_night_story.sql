-- 0032 v24 KVÄLLENS FÖRLOPP (the story of the group's night, for the Morgontidningen paper).
-- Client: docs/js/gang.js (renderPaper -> paper with timeline, quotes, photos, stats, awards).
-- group_night_story(p_group_id, p_night date default null) -> jsonb, members only.
--   Night = 05:00-05:00 Europe/Stockholm (same rule as olnu_next_expiry / olnu_night_of).
--   p_night = the evening date (olnu_evening); null = the night that ended last. Never later than tonight.
-- night_story_photo(p_photo_id) -> {id, mime, w, h, b64}: a photo of the story even after 05:00
--   (while the bytes are still there; post_photo empties expired bytes), only the last two nights.
-- Read only. Additive only. Needs 0001-0031 (crew_tracks, duel_log, chat_photos, status_reqs, duels,
-- group_msg_reacts, group_msg_likes, rallies, rally_answers, etas, after_nights, medal_nights, voice_msgs).
-- Drink counts per member are part of this story (drinking is the point of the app; members only).
-- SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only. Safe to run again.

-- Check-in lookups by bar for "met another group".
create index if not exists crew_tracks_night_bar_idx on public.crew_tracks (night, bar_id, at);
create index if not exists duel_log_kind_idx on public.duel_log (kind, user_id, at);

create or replace function public.group_night_story(p_group_id uuid, p_night date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_tz constant text := 'Europe/Stockholm';
  v_cur timestamptz := public.olnu_night_of(now());
  v_end timestamptz;
  v_start timestamptz;
  v_uids uuid[];
  r record;
  -- clusters (arrivals)
  c_key text[] := '{}'; c_bar text[] := '{}'; c_at timestamptz[] := '{}'; c_last timestamptz[] := '{}';
  c_names jsonb[] := '{}'; c_ks jsonb[] := '{}'; c_from jsonb[] := '{}';
  i int; jj int; v_hit int;
  v_arr jsonb := '[]'::jsonb;
  v_ci jsonb; v_mem jsonb; v_hours jsonb; v_peak jsonb; v_drinks jsonb; v_ral jsonb; v_skal jsonb;
  v_status jsonb; v_duels jsonb; v_chat jsonb; v_photos jsonb;
  v_texts int; v_photos_n int; v_voice_n int; v_total int; v_first timestamptz; v_last timestamptz;
  v_met int; v_met_g text; v_from text; v_town text; v_ready boolean;
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
  v_start := ((v_end at time zone v_tz) - interval '1 day') at time zone v_tz;
  select coalesce(array_agg(m.user_id), '{}') into v_uids from public.group_members m where m.group_id = p_group_id;

  -- 1. Check-ins in time order (one row per bar change of a member)
  select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'k', public.olnu_gang_k(p_group_id, x.user_id),
           'name', x.display_name, 'bar', x.bar_name, 'bar_id', x.bar_id, 'from_bar', x.prev_name) order by x.at), '[]'::jsonb)
    into v_ci
    from (select y.* from (
            select t.user_id, t.at, t.bar_id, coalesce(t.bar_name, '?') as bar_name, m.display_name,
                   lag(coalesce(t.bar_id, t.bar_name)) over w as prev_key,
                   lag(t.bar_name) over w as prev_name,
                   row_number() over (order by t.at) as rn
              from public.crew_tracks t
              join public.group_members m on m.group_id = p_group_id and m.user_id = t.user_id
             where t.kind = 'ci' and t.night = v_end
            window w as (partition by t.user_id order by t.at)) y
           where y.prev_key is distinct from coalesce(y.bar_id, y.bar_name)
           order by y.at limit 80) x;

  -- 2. Arrivals: check-ins at the same bar within 30 min merge into one arrival
  for r in select (e.value ->> 'at')::timestamptz as at, e.value ->> 'k' as k, e.value ->> 'name' as name,
                  e.value ->> 'bar' as bar, coalesce(e.value ->> 'bar_id', e.value ->> 'bar') as key, e.value ->> 'from_bar' as from_bar
             from jsonb_array_elements(v_ci) e order by (e.value ->> 'at')::timestamptz loop
    v_hit := null;
    for jj in 1 .. coalesce(array_length(c_key, 1), 0) loop
      if c_key[jj] = r.key and c_last[jj] >= r.at - interval '30 minutes' then v_hit := jj; end if;
    end loop;
    if v_hit is null then
      c_key := array_append(c_key, r.key); c_bar := array_append(c_bar, r.bar);
      c_at := array_append(c_at, r.at); c_last := array_append(c_last, r.at);
      c_names := array_append(c_names, jsonb_build_array(r.name)); c_ks := array_append(c_ks, jsonb_build_array(r.k));
      c_from := array_append(c_from, case when r.from_bar is null then '[]'::jsonb else jsonb_build_array(r.from_bar) end);
    else
      c_last[v_hit] := r.at;
      if not c_ks[v_hit] ? r.k then
        c_names[v_hit] := c_names[v_hit] || jsonb_build_array(r.name);
        c_ks[v_hit] := c_ks[v_hit] || jsonb_build_array(r.k);
      end if;
      if r.from_bar is not null then c_from[v_hit] := c_from[v_hit] || jsonb_build_array(r.from_bar); end if;
    end if;
  end loop;
  for i in 1 .. least(30, coalesce(array_length(c_key, 1), 0)) loop
    -- other app users who checked in at the same bar around the arrival (count only, never who)
    select count(distinct t.user_id)::int into v_met from public.crew_tracks t
     where t.night = v_end and t.kind = 'ci' and t.bar_id = c_key[i]
       and t.at between c_at[i] - interval '60 minutes' and c_last[i] + interval '30 minutes'
       and not (t.user_id = any (v_uids));
    -- a duel opponent group with a member there (only the group name of a duel the group took part in)
    select g.name into v_met_g
      from public.duels d
      join public.groups g on g.id = case when d.group_a = p_group_id then d.group_b else d.group_a end
     where (d.group_a = p_group_id or d.group_b = p_group_id) and d.status = 'active'
       and d.ends_at > v_start and d.ends_at <= v_end + interval '1 hour'
       and exists (select 1 from public.crew_tracks t join public.group_members om on om.user_id = t.user_id and om.group_id = g.id
                    where t.night = v_end and t.kind = 'ci' and t.bar_id = c_key[i] and not (t.user_id = any (v_uids))
                      and t.at between c_at[i] - interval '60 minutes' and c_last[i] + interval '30 minutes')
     limit 1;
    select f.value #>> '{}' into v_from from jsonb_array_elements(c_from[i]) f
     group by f.value #>> '{}' order by count(*) desc limit 1;
    v_arr := v_arr || jsonb_build_array(jsonb_build_object(
      'at', c_at[i], 'last_at', c_last[i], 'bar', c_bar[i], 'bar_id', c_key[i],
      'n', jsonb_array_length(c_names[i]), 'names', c_names[i], 'ks', c_ks[i],
      'from_bar', v_from, 'first', i = 1, 'met_n', coalesce(v_met, 0), 'met_group', v_met_g));
    v_met_g := null; v_from := null;
  end loop;

  -- 3. Drinks per member per hour (duel_log drink deltas, undo = -1), plus medal_nights totals
  with dl as (
    select l.user_id, l.n, l.at, date_trunc('hour', l.at at time zone v_tz) as h
      from public.duel_log l
     where l.kind = 'drink' and l.user_id = any (v_uids) and l.at >= v_start and l.at < v_end
  ), gh as (
    select h, greatest(0, sum(n))::int as n from dl group by h
  )
  select coalesce(jsonb_agg(jsonb_build_object('h', to_char(h, 'HH24'), 'at', h at time zone v_tz, 'n', n) order by h), '[]'::jsonb),
         (select jsonb_build_object('h', to_char(g2.h, 'HH24'), 'at', g2.h at time zone v_tz, 'n', g2.n)
            from gh g2 order by g2.n desc, g2.h limit 1)
    into v_hours, v_peak from gh;
  select min(l.at) filter (where l.n > 0), max(l.at) filter (where l.n > 0) into v_first, v_last
    from public.duel_log l
   where l.kind = 'drink' and l.user_id = any (v_uids) and l.at >= v_start and l.at < v_end;

  with dl as (
    select l.user_id, l.n, l.at, date_trunc('hour', l.at at time zone v_tz) as h
      from public.duel_log l
     where l.kind = 'drink' and l.user_id = any (v_uids) and l.at >= v_start and l.at < v_end
  ), per as (
    select dl.user_id, greatest(0, sum(dl.n))::int as n,
           min(dl.at) filter (where dl.n > 0) as first_at, max(dl.at) filter (where dl.n > 0) as last_at
      from dl group by dl.user_id
  ), ph as (
    select x.user_id, jsonb_agg(jsonb_build_object('h', to_char(x.h, 'HH24'), 'n', x.n) order by x.h) as hours
      from (select dl.user_id, dl.h, greatest(0, sum(dl.n))::int as n from dl group by dl.user_id, dl.h) x
     group by x.user_id
  ), ci as (
    select (e.value ->> 'k') as k, count(*)::int as n, count(distinct coalesce(e.value ->> 'bar_id', e.value ->> 'bar'))::int as bars,
           min((e.value ->> 'at')::timestamptz) as first_ci
      from jsonb_array_elements(v_ci) e group by e.value ->> 'k'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_gang_k(p_group_id, m.user_id), 'name', m.display_name, 'is_me', m.user_id = v_uid,
           'drinks', greatest(coalesce(p.n, 0), coalesce(mn.beers + mn.others, 0)),
           'first_at', coalesce(p.first_at, mn.first_at), 'last_at', p.last_at, 'hours', coalesce(ph.hours, '[]'::jsonb),
           'checkins', coalesce(ci.n, 0), 'bars', coalesce(ci.bars, 0), 'first_ci', ci.first_ci,
           'skal_given', coalesce(an.skal_given, 0), 'skal_got', coalesce(an.skal_got, 0), 'home_at', an.home_at,
           'out', coalesce(an.out, false) or coalesce(p.n, 0) > 0 or coalesce(mn.beers + mn.others, 0) > 0 or coalesce(ci.n, 0) > 0)
           order by m.display_name), '[]'::jsonb),
         (select a2.town from public.after_nights a2 where a2.night = v_end and a2.user_id = any (v_uids) and a2.town is not null
           group by a2.town order by count(*) desc, a2.town limit 1)
    into v_mem, v_town
    from public.group_members m
    left join per p on p.user_id = m.user_id
    left join ph on ph.user_id = m.user_id
    left join public.medal_nights mn on mn.user_id = m.user_id and mn.night = v_end
    left join public.after_nights an on an.user_id = m.user_id and an.night = v_end
    left join ci on ci.k = public.olnu_gang_k(p_group_id, m.user_id)
   where m.group_id = p_group_id;

  select coalesce(sum((x.value ->> 'drinks')::int), 0)::int into v_total from jsonb_array_elements(v_mem) x;
  v_drinks := jsonb_build_object('total', v_total, 'hours', v_hours, 'peak', v_peak, 'first_at', v_first, 'last_at', v_last);

  -- 4. Call-outs (rallies) with answers and ETAs
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r2.id, 'at', r2.created_at, 'by', m.display_name, 'by_k', public.olnu_gang_k(p_group_id, r2.user_id),
           'place', r2.place, 'body', r2.body,
           'yes', (select count(*) from public.rally_answers a join public.group_members am on am.group_id = p_group_id and am.user_id = a.user_id
                    where a.rally_id = r2.id and a.answer = 'yes')::int,
           'yes_names', (select coalesce(jsonb_agg(am.display_name order by a.updated_at), '[]'::jsonb) from public.rally_answers a
                          join public.group_members am on am.group_id = p_group_id and am.user_id = a.user_id
                         where a.rally_id = r2.id and a.answer = 'yes'),
           'maybe', (select count(*) from public.rally_answers a join public.group_members am on am.group_id = p_group_id and am.user_id = a.user_id
                      where a.rally_id = r2.id and a.answer = 'maybe')::int,
           'no', (select count(*) from public.rally_answers a join public.group_members am on am.group_id = p_group_id and am.user_id = a.user_id
                   where a.rally_id = r2.id and a.answer = 'no')::int,
           'etas', (select coalesce(jsonb_agg(jsonb_build_object('name', em.display_name, 'minutes', e.minutes,
                                  'eta_at', e.eta_at, 'arrived_at', e.arrived_at) order by e.created_at), '[]'::jsonb)
                      from public.etas e join public.group_members em on em.group_id = p_group_id and em.user_id = e.user_id
                     where e.rally_id = r2.id and e.cancelled_at is null)) order by r2.created_at), '[]'::jsonb)
    into v_ral
    from (select * from public.rallies x where x.group_id = p_group_id and x.created_at >= v_start and x.created_at < v_end
           order by x.created_at limit 12) r2
    left join public.group_members m on m.group_id = p_group_id and m.user_id = r2.user_id;

  -- 5. Skål
  select jsonb_build_object('total', coalesce(sum((x.value ->> 'skal_given')::int), 0)::int,
           'top', (select jsonb_build_object('name', y.value ->> 'name', 'n', (y.value ->> 'skal_given')::int)
                     from jsonb_array_elements(v_mem) y where (y.value ->> 'skal_given')::int > 0
                    order by (y.value ->> 'skal_given')::int desc, y.value ->> 'name' limit 1))
    into v_skal from jsonb_array_elements(v_mem) x;

  -- 6. Chief status reports (0030)
  select coalesce(jsonb_agg(jsonb_build_object('at', s.sj ->> 'created_at', 'by', s.sj ->> 'by',
           'needed', (s.sj ->> 'needed')::int, 'answered', (s.sj ->> 'answered')::int,
           'fastest', (select jsonb_build_object('name', a.value ->> 'name', 'sec', (a.value ->> 'sec')::int)
                         from jsonb_array_elements(s.sj -> 'answers') a
                        where not (a.value ->> 'is_chief')::boolean and (a.value ->> 'in_time')::boolean
                        order by (a.value ->> 'sec')::int limit 1)) order by s.at), '[]'::jsonb)
    into v_status
    from (select x.created_at as at, public.olnu_status_json(x, v_uid) as sj from public.status_reqs x
           where x.group_id = p_group_id and x.night = v_end order by x.created_at limit 6) s;

  -- 7. Duels (0031) with results, from this group's view
  select coalesce(jsonb_agg(jsonb_build_object('at', d.accepted_at, 'opp', d.dj -> 'opp' ->> 'name', 'status', d.dj ->> 'status',
           'winner', d.dj ->> 'winner', 'us', (d.dj -> 'us' ->> 'drinks')::int, 'them', (d.dj -> 'them' ->> 'drinks')::int)
           order by d.accepted_at), '[]'::jsonb)
    into v_duels
    from (select x.*, public.olnu_duel_json(x.id, v_uid) as dj from public.duels x
           where (x.group_a = p_group_id or x.group_b = p_group_id) and x.status = 'active' and x.accepted_at is not null
             and x.ends_at > v_start and x.ends_at <= v_end + interval '1 hour'
           order by x.accepted_at limit 6) d;

  -- 8. Chat highlights: the most-reacted text messages (no photos, no tips), text + name only
  with msgs as (
    select gm.id, gm.body, gm.created_at, m.display_name
      from public.group_msgs gm
      join public.group_members m on m.group_id = p_group_id and m.user_id = gm.user_id
     where gm.group_id = p_group_id and gm.created_at >= v_start and gm.created_at < v_end
       and gm.body not like '📷%' and gm.body not like '📣%'
  ), sc as (
    select ms.*,
      (select count(*) from public.group_msg_reacts x where x.msg_id = ms.id and x.active)::int
      + (select count(*) from public.group_msg_likes x where x.msg_id = ms.id and x.liked)::int as score,
      (select x.emoji from public.group_msg_reacts x where x.msg_id = ms.id and x.active
        group by x.emoji order by count(*) desc, x.emoji limit 1) as emoji
      from msgs ms
  )
  select (select count(*) from msgs)::int,
         coalesce((select jsonb_agg(jsonb_build_object('name', t.display_name, 'body', t.body, 'at', t.created_at,
                    'reacts', t.score, 'emoji', t.emoji) order by t.score desc, t.created_at)
                     from (select * from sc order by sc.score desc, (char_length(sc.body) between 6 and 90) desc, sc.created_at desc limit 6) t),
                  '[]'::jsonb)
    into v_texts, v_chat;

  -- 9. Photos: top 4 by reactions, then newest; only while the bytes are still there
  select count(*)::int into v_photos_n from public.chat_photos cp
   where cp.group_id = p_group_id and cp.created_at >= v_start and cp.created_at < v_end;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'by', p.display_name, 'at', p.created_at, 'w', p.w, 'h', p.h,
           'reacts', p.score, 'caption', nullif(p.caption, ''), 'status', p.status) order by p.score desc, p.created_at desc), '[]'::jsonb)
    into v_photos
    from (select cp.id, cp.created_at, cp.w, cp.h, m.display_name,
                 coalesce((select count(*) from public.group_msg_reacts x where x.msg_id = cp.msg_id and x.active), 0)::int
                 + coalesce((select count(*) from public.group_msg_likes x where x.msg_id = cp.msg_id and x.liked), 0)::int as score,
                 btrim(regexp_replace(coalesce((select gm.body from public.group_msgs gm where gm.id = cp.msg_id), ''),
                                      '^📷\s*(🎖️\s*Lägesrapport:?\s*)?', '')) as caption,
                 coalesce((select gm.body like '📷 🎖️%' from public.group_msgs gm where gm.id = cp.msg_id), false) as status
            from public.chat_photos cp
            join public.group_members m on m.group_id = p_group_id and m.user_id = cp.user_id
           where cp.group_id = p_group_id and cp.created_at >= v_start and cp.created_at < v_end and cp.bytes is not null
           order by 6 desc, cp.created_at desc limit 4) p;

  -- 10. Voice messages (count only)
  select count(*)::int into v_voice_n from public.voice_msgs vm
   where vm.group_id = p_group_id and vm.created_at >= v_start and vm.created_at < v_end;

  v_ready := v_total > 0 or jsonb_array_length(v_ci) > 0;
  return jsonb_build_object('v', 1, 'night', v_end, 'evening', public.olnu_evening(v_end), 'from', v_start, 'to', v_end,
    'group_name', (select g.name from public.groups g where g.id = p_group_id), 'town', v_town,
    'ready', v_ready, 'members', v_mem, 'checkins', v_ci, 'arrivals', v_arr, 'rallies', v_ral, 'drinks', v_drinks,
    'skal', v_skal, 'status', v_status, 'duels', v_duels,
    'chat', jsonb_build_object('texts', v_texts, 'top', v_chat),
    'photos', v_photos, 'photos_n', v_photos_n, 'voice_n', v_voice_n);
end; $$;

-- night_story_photo(p_photo_id) -> {id, mime, w, h, b64}. A group photo from the last two nights while the bytes
-- are still there (also after 05:00). Errors: photo_not_found, not_member.
create or replace function public.night_story_photo(p_photo_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.chat_photos;
  v_from timestamptz := ((public.olnu_night_of(now()) at time zone 'Europe/Stockholm') - interval '2 days') at time zone 'Europe/Stockholm';
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.chat_photos cp where cp.id = p_photo_id and cp.bytes is not null and cp.created_at >= v_from;
  if not found then raise exception 'photo_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end; $$;

revoke all on function public.group_night_story(uuid, date) from public;
revoke all on function public.night_story_photo(bigint) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.group_night_story(uuid, date), public.night_story_photo(bigint) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.group_night_story(uuid, date), public.night_story_photo(bigint) to authenticated';
  end if;
end $$;
