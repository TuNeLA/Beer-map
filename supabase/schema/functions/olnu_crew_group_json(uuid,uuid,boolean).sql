-- public.olnu_crew_group_json(p_group uuid, p_uid uuid, p_full boolean)
-- live md5(pg_get_functiondef) = f4ebf4f14a4792306796a070bc15b86b
CREATE OR REPLACE FUNCTION public.olnu_crew_group_json(p_group uuid, p_uid uuid, p_full boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(now());
  v_mm jsonb; v_deps jsonb; v_dates jsonb := null; v_mood jsonb := null; v_alone jsonb := null;
  v_out int; v_gone int; v_me text;
  dp public.crew_date_polls; md public.crew_moods;
begin
  select coalesce(jsonb_agg(jsonb_build_object('uid', x.uid, 'k', x.k, 'name', x.name, 'is_me', x.is_me, 'state', x.state,
           'left_at', x.left_at, 'lat', x.lat, 'lng', x.lng, 'bar_name', x.bar_name, 'pres_at', x.pres_at)
           order by x.name), '[]'::jsonb)
    into v_mm from public.olnu_crew_members(p_group, p_uid) x;

  select count(*) filter (where r.state = 'out'), count(*) filter (where r.state in ('left', 'home', 'quiet')),
         max(r.state) filter (where r.is_me)
    into v_out, v_gone, v_me
    from jsonb_to_recordset(v_mm) as r(uid uuid, k text, name text, is_me boolean, state text);
  if v_out = 1 and v_gone >= 1 then
    select jsonb_build_object('k', r.k, 'name', r.name, 'is_me', r.is_me, 'bar_name', r.bar_name)
      into v_alone
      from jsonb_to_recordset(v_mm) as r(k text, name text, is_me boolean, state text, bar_name text)
     where r.state = 'out' limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'by', public.olnu_crew_name(p_group, d.user_id), 'is_mine', d.user_id = p_uid,
           'leave_at', d.leave_at, 'bar_id', d.bar_id, 'bar_name', d.bar_name, 'lat', d.lat, 'lng', d.lng,
           'created_at', d.created_at,
           'going_n', (select count(*) from public.crew_dep_going g join public.group_members m
                        on m.group_id = p_group and m.user_id = g.user_id where g.dep_id = d.id and g.going),
           'i_going', exists (select 1 from public.crew_dep_going g where g.dep_id = d.id and g.user_id = p_uid and g.going),
           'going_names', case when p_full then (select coalesce(jsonb_agg(m.display_name order by g.updated_at), '[]'::jsonb)
                              from public.crew_dep_going g join public.group_members m on m.group_id = p_group and m.user_id = g.user_id
                             where g.dep_id = d.id and g.going) end)
           order by d.leave_at), '[]'::jsonb)
    into v_deps
    from public.crew_deps d
   where d.group_id = p_group and d.night = v_night and d.cancelled_at is null and d.leave_at > now() - interval '15 minutes';

  select * into dp from public.crew_date_polls p where p.group_id = p_group and p.ends_at > now()
   order by p.id desc limit 1;
  if found then
    with opts as (
      select o.d, (select count(*) from public.crew_date_votes v join public.group_members m on m.group_id = p_group and m.user_id = v.user_id
                    where v.poll_id = dp.id and v.d = o.d and v.answer = 'kan') as kan,
                  (select count(*) from public.crew_date_votes v join public.group_members m on m.group_id = p_group and m.user_id = v.user_id
                    where v.poll_id = dp.id and v.d = o.d and v.answer = 'kanske') as kanske,
                  (select count(*) from public.crew_date_votes v join public.group_members m on m.group_id = p_group and m.user_id = v.user_id
                    where v.poll_id = dp.id and v.d = o.d and v.answer = 'nej') as nej,
                  (select v.answer from public.crew_date_votes v where v.poll_id = dp.id and v.d = o.d and v.user_id = p_uid) as my
        from unnest(dp.dates) as o(d)
    )
    select jsonb_build_object(
      'id', dp.id, 'title', dp.title, 'by', public.olnu_crew_name(p_group, dp.user_id), 'is_mine', dp.user_id = p_uid,
      'closed', dp.closed_at is not null, 'created_at', dp.created_at, 'ends_at', dp.ends_at,
      'voters', (select count(distinct v.user_id) from public.crew_date_votes v join public.group_members m
                  on m.group_id = p_group and m.user_id = v.user_id where v.poll_id = dp.id),
      'i_voted', exists (select 1 from public.crew_date_votes v where v.poll_id = dp.id and v.user_id = p_uid),
      'winner', (select o.d from opts o where o.kan + o.kanske > 0 order by o.kan desc, o.kanske desc, o.nej, o.d limit 1),
      'dates', (select jsonb_agg(jsonb_build_object('d', o.d, 'kan', o.kan, 'kanske', o.kanske, 'nej', o.nej, 'my', o.my,
                  'kan_names', case when p_full then (select coalesce(jsonb_agg(m.display_name order by v.updated_at), '[]'::jsonb)
                       from public.crew_date_votes v join public.group_members m on m.group_id = p_group and m.user_id = v.user_id
                      where v.poll_id = dp.id and v.d = o.d and v.answer = 'kan') end) order by o.d) from opts o))
      into v_dates;
  end if;

  select * into md from public.crew_moods x where x.group_id = p_group and x.ends_at > now() order by x.id desc limit 1;
  if found then
    with ans as (
      select a.user_id, a.answer, a.updated_at from public.crew_mood_answers a
        join public.group_members m on m.group_id = p_group and m.user_id = a.user_id
       where a.mood_id = md.id
    ), mm as (
      select * from jsonb_to_recordset(v_mm) as r(uid uuid, k text, name text, is_me boolean, state text,
                                                   lat float8, lng float8, bar_name text)
    )
    select jsonb_build_object(
      'id', md.id, 'by', public.olnu_crew_name(p_group, md.user_id), 'is_mine', md.user_id = p_uid,
      'created_at', md.created_at, 'ends_at', md.ends_at,
      'my', (select a.answer from ans a where a.user_id = p_uid),
      'bra', (select count(*) from ans a where a.answer = 'bra'),
      'snurr', (select count(*) from ans a where a.answer = 'snurr'),
      'hem', (select count(*) from ans a where a.answer = 'hem'),
      'answers', (select coalesce(jsonb_agg(jsonb_build_object(
          'k', m.k, 'name', m.name, 'is_me', m.is_me, 'answer', a.answer, 'at', a.updated_at, 'bar_name', m.bar_name,
          'near', case when a.answer = 'snurr' and m.lat is not null then
             (select coalesce(jsonb_agg(o.name order by public.olnu_dist_m(m.lat, m.lng, o.lat, o.lng)), '[]'::jsonb)
                from mm o where o.uid <> m.uid and o.state = 'out' and o.lat is not null
                 and public.olnu_dist_m(m.lat, m.lng, o.lat, o.lng) <= 400) end)
          order by a.updated_at), '[]'::jsonb)
          from ans a join mm m on m.uid = a.user_id),
      'waiting', (select count(*) from mm m where not exists (select 1 from ans a where a.user_id = m.uid)))
      into v_mood;
  end if;

  return jsonb_build_object(
    'id', p_group, 'name', (select g.name from public.groups g where g.id = p_group),
    'me_state', v_me, 'out_n', v_out, 'gone_n', v_gone, 'alone', v_alone,
    'deps', v_deps, 'dates', v_dates, 'mood', v_mood,
    'replay', public.olnu_crew_replay_open(p_group),
    'members', case when p_full then (select coalesce(jsonb_agg(jsonb_build_object('k', r.k, 'name', r.name, 'is_me', r.is_me,
                 'state', r.state, 'bar_name', r.bar_name, 'left_at', r.left_at, 'at', r.pres_at)), '[]'::jsonb)
                 from jsonb_to_recordset(v_mm) as r(k text, name text, is_me boolean, state text, bar_name text,
                                                    left_at timestamptz, pres_at timestamptz)) end);
end; $function$;
