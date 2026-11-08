-- public.olnu_medal_eval(p_uid uuid)
-- live md5(pg_get_functiondef) = 69359fc2855629a8045bfe282ad5d966
CREATE OR REPLACE FUNCTION public.olnu_medal_eval(p_uid uuid)
 RETURNS TABLE(medal text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total int := public.olnu_lifetime(p_uid);
  v_nights int; v_bars int; v_rounds int; v_regular int;
  v_sg int := 0; v_sr int := 0; v_msgs int := 0;
  v_yes int; v_rallies int; v_home int; v_day int; v_owl int; v_tue int;
  v_first int; v_king int; v_league int; v_cells int; v_side int; v_hot int; v_med int;
  v_valb int; v_mids int; v_luc int; v_nyar int; v_group int; v_comp int;
  v_week date := public.olnu_week_start(now());
  v_store boolean := public.olnu_store_on();   -- 0211
begin
  select count(*) filter (where (mn.beers + mn.others) >= 1),
         count(*) filter (where (mn.beers + mn.others) >= 1 and mn.home),
         count(*) filter (where (mn.beers + mn.others) >= 1 and mn.early),
         count(*) filter (where (mn.beers + mn.others) >= 1 and mn.owl),
         count(*) filter (where (mn.beers + mn.others) >= 1 and extract(isodow from public.olnu_evening(mn.night)) = 2),
         count(*) filter (where mn.others >= 1),
         count(*) filter (where (mn.beers + mn.others) >= 5),
         count(*) filter (where (mn.beers + mn.others) >= 10),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '04-30'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') between '06-19' and '06-25'
                   and extract(isodow from public.olnu_evening(mn.night)) = 5),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-13'),
         count(distinct extract(year from public.olnu_evening(mn.night)))
           filter (where (mn.beers + mn.others) >= 1 and to_char(public.olnu_evening(mn.night), 'MM-DD') = '12-31'),
         count(distinct mn.cell) filter (where (mn.beers + mn.others) >= 1)
    into v_nights, v_home, v_day, v_owl, v_tue, v_side, v_hot, v_med, v_valb, v_mids, v_luc, v_nyar, v_cells
    from public.medal_nights mn where mn.user_id = p_uid;

  select count(distinct c.bar_id) into v_bars from public.medal_checkins c where c.user_id = p_uid;
  select count(*) into v_rounds from (
    select c.night from public.medal_checkins c where c.user_id = p_uid group by c.night having count(*) >= 3) x;
  select count(*) into v_regular from (
    select c.bar_id from public.medal_checkins c where c.user_id = p_uid group by c.bar_id having count(*) >= 5) x;

  select coalesce(mc.skal_given, 0), coalesce(mc.skal_got, 0), coalesce(mc.msgs, 0)
    into v_sg, v_sr, v_msgs from public.medal_counts mc where mc.user_id = p_uid;
  v_sg := coalesce(v_sg, 0); v_sr := coalesce(v_sr, 0); v_msgs := coalesce(v_msgs, 0);

  select count(*) into v_yes from public.rally_answers a join public.rallies r on r.id = a.rally_id
   where a.user_id = p_uid and a.answer = 'yes' and r.user_id <> p_uid;
  select count(*) into v_rallies from public.rallies r where r.user_id = p_uid;

  select count(*) into v_first
    from public.medal_nights mn
   where mn.user_id = p_uid and (mn.beers + mn.others) >= 1 and mn.first_at is not null
     and exists (select 1 from public.medal_nights o
                  where o.night = mn.night and (o.beers + o.others) >= 1 and o.user_id <> p_uid
                    and o.user_id in (select am.user_id from public.group_members am
                                        join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid))
     and not exists (select 1 from public.medal_nights o
                      where o.night = mn.night and (o.beers + o.others) >= 1 and o.user_id <> p_uid and o.first_at < mn.first_at
                        and o.user_id in (select am.user_id from public.group_members am
                                            join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid));

  select count(*) into v_king from (
    select t.user_id, row_number() over (partition by t.bar_id, t.week order by t.n desc, t.last_at asc, t.user_id) as rn
      from public.bar_taps t
     where t.n > 0 and t.bar_id in (select x.bar_id from public.bar_taps x where x.user_id = p_uid)
  ) k where k.rn = 1 and k.user_id = p_uid;

  select count(*) into v_league from (
    select distinct on (s.wk) s.wk, s.gid
      from (select wb.week as wk, gm.group_id as gid, sum(wb.n) as tot, g.created_at as gat
              from public.week_beers wb
              join public.group_members gm on gm.user_id = wb.user_id
              join public.groups g on g.id = gm.group_id
             where wb.week < v_week and wb.week >= v_week - 182
               and gm.group_id in (select x.group_id from public.group_members x group by x.group_id having count(*) >= 2)
             group by wb.week, gm.group_id, g.created_at) s
     where s.tot > 0
     order by s.wk, s.tot desc, s.gat asc, s.gid
  ) top
   where top.gid in (select m.group_id from public.group_members m where m.user_id = p_uid);

  select count(*) into v_group from public.group_members m where m.user_id = p_uid;
  select count(*) into v_comp from public.groups g
   where g.created_by = p_uid
     and (select count(*) from public.group_members m where m.group_id = g.id) >= 5;

  if v_store then v_total := coalesce(v_sg, 0) + coalesce(v_sr, 0); end if;   -- 0211
  return query
  select v.medal, v.n from (values
    ('m1', case when (case when v_store then v_nights else v_total end) >= 1 then 1 else 0 end),
    ('m10', case when v_total >= 10 then 1 else 0 end),
    ('m50', case when v_total >= 50 then 1 else 0 end),
    ('m100', case when v_total >= 100 then 1 else 0 end),
    ('m250', case when v_total >= 250 then 1 else 0 end),
    ('m500', case when v_total >= 500 then 1 else 0 end),
    ('m1000', case when v_total >= 1000 then 1 else 0 end),
    ('n5', case when v_nights >= 5 then 1 else 0 end),
    ('n25', case when v_nights >= 25 then 1 else 0 end),
    ('n100', case when v_nights >= 100 then 1 else 0 end),
    ('b5', case when v_bars >= 5 then 1 else 0 end),
    ('b15', case when v_bars >= 15 then 1 else 0 end),
    ('b40', case when v_bars >= 40 then 1 else 0 end),
    ('krogrunda', v_rounds),
    ('stammis', v_regular),
    ('sg10', case when v_sg >= 10 then 1 else 0 end),
    ('sg100', case when v_sg >= 100 then 1 else 0 end),
    ('sr10', case when v_sr >= 10 then 1 else 0 end),
    ('sr100', case when v_sr >= 100 then 1 else 0 end),
    ('inryckt', case when v_yes >= 1 then 1 else 0 end),
    ('alltid', case when v_yes >= 10 then 1 else 0 end),
    ('trumslag', case when v_rallies >= 1 then 1 else 0 end),
    ('hemvarn', v_home),
    ('komhem', case when v_home >= 5 then v_home / 5 else 0 end),
    ('dagsljus', v_day),
    ('uggla', v_owl),
    ('tisdag', v_tue),
    ('fortrupp', v_first),
    ('kung', case when v_store then 0 else v_king end),
    ('liga', case when v_store then 0 else v_league end),
    ('pluton', case when v_group >= 1 then 1 else 0 end),
    ('kompani', v_comp),
    ('radio', case when v_msgs >= 1 then 1 else 0 end),
    ('signal', case when v_msgs >= 50 then 1 else 0 end),
    ('valborg', v_valb),
    ('midsommar', v_mids),
    ('lucia', v_luc),
    ('nyar', v_nyar),
    ('faltresa', greatest(0, v_cells - 1)),
    ('sidospar', v_side),
    ('het', case when v_store then 0 else v_hot end),
    ('medevac', case when v_store then 0 else v_med end)
  ) as v(medal, n)
  union all
  select c.medal, count(*)::int from public.medal_claims c where c.user_id = p_uid group by c.medal;
end;
$function$;
