-- public.gang_paper(p_group_id uuid, p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = 1d6194a12b9edaef377c30f2324dcb7e
CREATE OR REPLACE FUNCTION public.gang_paper(p_group_id uuid, p_night timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := coalesce(p_night, public.olnu_gang_last_night());
  v_mem jsonb; v_q jsonb; v_mt jsonb; v_take jsonb; v_town text; v_out int; v_crawl boolean := false;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_night > public.olnu_gang_last_night() then v_night := public.olnu_gang_last_night(); end if;
  with mem as (
    select m.user_id, m.display_name from public.group_members m where m.group_id = p_group_id
  ), mn as (
    select n.user_id, (n.beers + n.others) > 0 as out, n.first_at, n.home from public.medal_nights n
     where n.night = v_night and n.user_id in (select user_id from mem)
  ), an as (
    select a.user_id, a.out, a.town, a.home_at, a.skal_given from public.after_nights a
     where a.night = v_night and a.user_id in (select user_id from mem)
  ), bars as (
    select c.user_id, count(distinct c.bar_id)::int as n,
           (select jsonb_agg(distinct b.name) from public.medal_checkins c2 join public.bars_lite b on b.id = c2.bar_id
             where c2.user_id = c.user_id and c2.night = v_night and b.name is not null) as names
      from public.medal_checkins c
     where c.night = v_night and c.user_id in (select user_id from mem) group by c.user_id
  ), eta as (
    select e.user_id, max(e.minutes)::int as mx from public.etas e
     where e.user_id in (select user_id from mem) and public.olnu_night_of(e.created_at) = v_night and e.cancelled_at is null
     group by e.user_id
  ), ral as (
    select r.user_id, count(*)::int as n from public.rallies r
     where r.group_id = p_group_id and public.olnu_night_of(r.created_at) = v_night group by r.user_id
  ), rounds as (
    select r.* from public.gang_mt_rounds r where r.group_id = p_group_id and r.night = v_night
  ), mtw as (
    select w.target as user_id, count(*)::int as n from (
      select distinct on (v.round_id) v.round_id, v.target, count(*) over (partition by v.round_id, v.target) as c
        from public.gang_mt_votes v where v.round_id in (select id from rounds)
       order by v.round_id, c desc, v.target) w group by w.target
  ), kb as (
    select distinct on (k.user_id) k.user_id, k.place_name from public.kebab_ratings k
     where k.night = v_night and k.user_id in (select user_id from mem) order by k.user_id, k.stars desc, k.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_gang_k(p_group_id, m.user_id), 'name', m.display_name, 'is_me', m.user_id = v_uid,
           'out', coalesce(mn.out, false) or coalesce(an.out, false) or coalesce(b.n, 0) > 0,
           'bars', coalesce(b.n, 0), 'bar_names', coalesce(b.names, '[]'::jsonb),
           'first_at', mn.first_at,
           'home_at', coalesce(an.home_at, case when mn.home then v_night end),
           'skal', coalesce(an.skal_given, 0), 'eta_max', e.mx, 'rallies', coalesce(r.n, 0),
           'mt_wins', coalesce(w.n, 0),
           'quotes', (select count(*) from public.gang_quotes q where q.group_id = p_group_id and q.night = v_night
                       and not q.hidden and lower(q.who) = lower(m.display_name))::int,
           'kebab', kb.place_name) order by m.display_name), '[]'::jsonb),
         (select a.town from an a where a.town is not null group by a.town order by count(*) desc, a.town limit 1)
    into v_mem, v_town
    from mem m
    left join mn on mn.user_id = m.user_id left join an on an.user_id = m.user_id
    left join bars b on b.user_id = m.user_id left join eta e on e.user_id = m.user_id
    left join ral r on r.user_id = m.user_id left join mtw w on w.user_id = m.user_id
    left join kb on kb.user_id = m.user_id;

  select count(*)::int into v_out from jsonb_array_elements(v_mem) x where (x.value ->> 'out')::boolean;

  select coalesce(jsonb_agg(jsonb_build_object('who', q.who, 'body', q.body) order by q.id), '[]'::jsonb) into v_q
    from (select * from public.gang_quotes q where q.group_id = p_group_id and q.night = v_night and not q.hidden
            and q.reveal_at <= now() order by q.id limit 8) q;

  select coalesce(jsonb_agg(jsonb_build_object('q', r.q, 'names', (
           select coalesce(jsonb_agg(public.olnu_gang_name(p_group_id, x.target) order by x.target), '[]'::jsonb) from (
             select v.target, count(*) c, max(count(*)) over () mx from public.gang_mt_votes v
              where v.round_id = r.id group by v.target) x where x.c = x.mx)) order by r.id), '[]'::jsonb)
    into v_mt
    from public.gang_mt_rounds r where r.group_id = p_group_id and r.night = v_night
     and exists (select 1 from public.gang_mt_votes v where v.round_id = r.id);

  begin
    select coalesce(jsonb_agg(distinct t.bar_name), '[]'::jsonb) into v_take
      from public.bar_takeovers t where t.group_id = p_group_id and t.night = v_night and t.bar_name is not null;
  exception when others then v_take := '[]'::jsonb;
  end;
  begin
    select exists (select 1 from public.game_crawls c where c.group_id = p_group_id and c.night = v_night and c.done_at is not null)
      into v_crawl;
  exception when others then v_crawl := false;
  end;

  return jsonb_build_object('night', v_night, 'evening', public.olnu_evening(v_night),
    'group_name', (select g.name from public.groups g where g.id = p_group_id),
    'town', v_town, 'out_n', v_out, 'members', v_mem, 'quotes', v_q, 'mt', v_mt,
    'takeovers', coalesce(v_take, '[]'::jsonb), 'crawl_done', coalesce(v_crawl, false), 'ready', v_out > 0);
end; $function$;
