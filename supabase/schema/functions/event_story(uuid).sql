-- public.event_story(p_group_id uuid)
-- live md5(pg_get_functiondef) = 02920daf7bf3db9491dea9ce2a77bf64
CREATE OR REPLACE FUNCTION public.event_story(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_tz constant text := 'Europe/Stockholm';
  i public.invites;
  v_end timestamptz; v_start timestamptz;
  v_uids uuid[];
  r record;
  c_key text[] := '{}'; c_bar text[] := '{}'; c_at timestamptz[] := '{}'; c_last timestamptz[] := '{}';
  c_names jsonb[] := '{}'; c_ks jsonb[] := '{}'; c_from jsonb[] := '{}';
  ii int; jj int; v_hit int;
  v_arr jsonb := '[]'::jsonb;
  v_ci jsonb; v_mem jsonb; v_hours jsonb; v_peak jsonb; v_drinks jsonb; v_skal jsonb; v_chat jsonb; v_photos jsonb;
  v_texts int; v_photos_n int; v_voice_n int; v_total int; v_first timestamptz; v_last timestamptz; v_from text; v_town text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_evg_was(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select x.* into i from public.invites x join public.temp_groups t on t.invite_id = x.id where t.group_id = p_group_id;
  v_end := public.olnu_night_of(i.starts_at);
  if v_end > public.olnu_night_of(now()) then v_end := public.olnu_night_of(now()); end if;
  v_start := ((v_end at time zone v_tz) - interval '1 day') at time zone v_tz;
  select coalesce(array_agg(e.user_id), '{}') into v_uids from public.olnu_evg_people(p_group_id) e;

  select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'k', public.olnu_gang_k(p_group_id, x.user_id),
           'name', x.nm, 'bar', x.bar_name, 'bar_id', x.bar_id, 'from_bar', x.prev_name) order by x.at), '[]'::jsonb)
    into v_ci
    from (select y.* from (
            select t.user_id, t.at, t.bar_id, coalesce(t.bar_name, '?') as bar_name, coalesce(public.olnu_friend_name(t.user_id), '?') as nm,
                   lag(coalesce(t.bar_id, t.bar_name)) over w as prev_key, lag(t.bar_name) over w as prev_name
              from public.crew_tracks t
             where t.kind = 'ci' and t.night = v_end and t.user_id = any (v_uids)
            window w as (partition by t.user_id order by t.at)) y
           where y.prev_key is distinct from coalesce(y.bar_id, y.bar_name)
           order by y.at limit 80) x;

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
  for ii in 1 .. least(30, coalesce(array_length(c_key, 1), 0)) loop
    select f.value #>> '{}' into v_from from jsonb_array_elements(c_from[ii]) f group by f.value #>> '{}' order by count(*) desc limit 1;
    v_arr := v_arr || jsonb_build_array(jsonb_build_object('at', c_at[ii], 'last_at', c_last[ii], 'bar', c_bar[ii], 'bar_id', c_key[ii],
      'n', jsonb_array_length(c_names[ii]), 'names', c_names[ii], 'ks', c_ks[ii], 'from_bar', v_from, 'first', ii = 1, 'met_n', 0, 'met_group', null));
    v_from := null;
  end loop;

  with dl as (
    select d.user_id, 1 as n, d.at from public.drink_log d
     where d.user_id = any (v_uids) and d.night = v_end and d.kind <> 'checkin' and not d.undone
    union all
    select l.user_id, l.n, l.at from public.duel_log l
     where l.kind = 'drink' and l.user_id = any (v_uids) and l.at >= v_start and l.at < v_end
       and not exists (select 1 from public.drink_log d2 where d2.user_id = l.user_id and d2.night = v_end)
  ), dh as (select dl.*, date_trunc('hour', dl.at at time zone v_tz) as h from dl),
  gh as (select h, greatest(0, sum(n))::int as n from dh group by h),
  per as (select dh.user_id, greatest(0, sum(dh.n))::int as n, min(dh.at) filter (where dh.n > 0) as first_at,
                 max(dh.at) filter (where dh.n > 0) as last_at from dh group by dh.user_id),
  ph as (select x.user_id, jsonb_agg(jsonb_build_object('h', to_char(x.h, 'HH24'), 'n', x.n) order by x.h) as hours
           from (select dh.user_id, dh.h, greatest(0, sum(dh.n))::int as n from dh group by dh.user_id, dh.h) x group by x.user_id),
  ci as (select (e.value ->> 'k') as k, count(*)::int as n, count(distinct coalesce(e.value ->> 'bar_id', e.value ->> 'bar'))::int as bars,
                min((e.value ->> 'at')::timestamptz) as first_ci from jsonb_array_elements(v_ci) e group by e.value ->> 'k')
  select (select coalesce(jsonb_agg(jsonb_build_object('h', to_char(g.h, 'HH24'), 'at', g.h at time zone v_tz, 'n', g.n) order by g.h), '[]'::jsonb) from gh g),
         (select jsonb_build_object('h', to_char(g2.h, 'HH24'), 'at', g2.h at time zone v_tz, 'n', g2.n) from gh g2 order by g2.n desc, g2.h limit 1),
         (select min(first_at) from per), (select max(last_at) from per),
         coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_gang_k(p_group_id, e.user_id), 'name', e.name, 'is_me', e.user_id = v_uid, 'answer', e.answer, 'creator', e.creator,
           'drinks', greatest(coalesce(p.n, 0), coalesce(mn.beers + mn.others, 0)),
           'first_at', coalesce(p.first_at, mn.first_at), 'last_at', p.last_at, 'hours', coalesce(ph.hours, '[]'::jsonb),
           'checkins', coalesce(ci.n, 0), 'bars', coalesce(ci.bars, 0), 'first_ci', ci.first_ci,
           'skal_given', coalesce(an.skal_given, 0), 'skal_got', coalesce(an.skal_got, 0), 'home_at', an.home_at,
           'out', coalesce(an.out, false) or coalesce(p.n, 0) > 0 or coalesce(mn.beers + mn.others, 0) > 0 or coalesce(ci.n, 0) > 0)
           order by e.creator desc, e.name), '[]'::jsonb),
         (select a2.town from public.after_nights a2 where a2.night = v_end and a2.user_id = any (v_uids) and a2.town is not null
           group by a2.town order by count(*) desc, a2.town limit 1)
    into v_hours, v_peak, v_first, v_last, v_mem, v_town
    from public.olnu_evg_people(p_group_id) e
    left join per p on p.user_id = e.user_id
    left join ph on ph.user_id = e.user_id
    left join public.medal_nights mn on mn.user_id = e.user_id and mn.night = v_end
    left join public.after_nights an on an.user_id = e.user_id and an.night = v_end
    left join ci on ci.k = public.olnu_gang_k(p_group_id, e.user_id);

  select coalesce(sum((x.value ->> 'drinks')::int), 0)::int into v_total from jsonb_array_elements(v_mem) x;
  v_drinks := jsonb_build_object('total', v_total, 'hours', coalesce(v_hours, '[]'::jsonb), 'peak', v_peak, 'first_at', v_first, 'last_at', v_last);
  select jsonb_build_object('total', coalesce(sum((x.value ->> 'skal_given')::int), 0)::int,
           'top', (select jsonb_build_object('name', y.value ->> 'name', 'n', (y.value ->> 'skal_given')::int)
                     from jsonb_array_elements(v_mem) y where (y.value ->> 'skal_given')::int > 0
                    order by (y.value ->> 'skal_given')::int desc, y.value ->> 'name' limit 1))
    into v_skal from jsonb_array_elements(v_mem) x;

  with msgs as (
    select gm.id, gm.body, gm.created_at, coalesce(public.olnu_friend_name(gm.user_id), '?') as nm
      from public.group_msgs gm
     where gm.group_id = p_group_id and gm.created_at < v_end + interval '12 hours'
       and left(gm.body, 1) <> chr(8291) and gm.body not like '📷%' and gm.body not like '📣%' and gm.body <> '🗑️'
  ), sc as (
    select ms.*,
      (select count(*) from public.group_msg_reacts x where x.msg_id = ms.id and x.active)::int
      + (select count(*) from public.group_msg_likes x where x.msg_id = ms.id and x.liked)::int as score,
      (select x.emoji from public.group_msg_reacts x where x.msg_id = ms.id and x.active group by x.emoji order by count(*) desc, x.emoji limit 1) as emoji
      from msgs ms
  )
  select (select count(*) from msgs)::int,
         coalesce((select jsonb_agg(jsonb_build_object('name', t.nm, 'body', t.body, 'at', t.created_at, 'reacts', t.score, 'emoji', t.emoji)
                                    order by t.score desc, t.created_at)
                     from (select * from sc order by sc.score desc, (char_length(sc.body) between 6 and 90) desc, sc.created_at desc limit 6) t), '[]'::jsonb)
    into v_texts, v_chat;

  select count(*)::int into v_photos_n from public.chat_photos cp where cp.group_id = p_group_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'by', p.nm, 'at', p.created_at, 'w', p.w, 'h', p.h,
           'reacts', p.score, 'caption', nullif(p.caption, ''), 'status', false) order by p.score desc, p.created_at desc), '[]'::jsonb)
    into v_photos
    from (select cp.id, cp.created_at, cp.w, cp.h, coalesce(public.olnu_friend_name(cp.user_id), '?') as nm,
                 coalesce((select count(*) from public.group_msg_reacts x where x.msg_id = cp.msg_id and x.active), 0)::int
                 + coalesce((select count(*) from public.group_msg_likes x where x.msg_id = cp.msg_id and x.liked), 0)::int as score,
                 btrim(regexp_replace(coalesce((select gm.body from public.group_msgs gm where gm.id = cp.msg_id), ''), '^📷\s*', '')) as caption
            from public.chat_photos cp
           where cp.group_id = p_group_id and cp.bytes is not null and cp.created_at > now() - interval '35 days'
           order by 6 desc, cp.created_at desc limit 4) p;
  select count(*)::int into v_voice_n from public.voice_msgs vm where vm.group_id = p_group_id;

  return jsonb_build_object('v', 1, 'night', v_end, 'evening', public.olnu_evening(v_end), 'from', v_start, 'to', v_end,
    'group_name', i.title, 'town', v_town,
    'ready', v_total > 0 or jsonb_array_length(v_ci) > 0 or v_texts > 0 or v_photos_n > 0,
    'members', v_mem, 'checkins', v_ci, 'arrivals', v_arr, 'rallies', '[]'::jsonb, 'drinks', v_drinks,
    'skal', v_skal, 'status', '[]'::jsonb, 'duels', '[]'::jsonb,
    'chat', jsonb_build_object('texts', v_texts, 'top', v_chat),
    'photos', v_photos, 'photos_n', v_photos_n, 'voice_n', v_voice_n,
    'event', jsonb_build_object('group_id', p_group_id, 'invite_id', i.id, 'title', i.title, 'kind', i.kind, 'place', i.place,
                                'bar_id', i.bar_id, 'starts_at', i.starts_at));
end; $function$;
