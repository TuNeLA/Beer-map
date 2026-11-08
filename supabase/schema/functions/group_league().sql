-- public.group_league()
-- live md5(pg_get_functiondef) = 05982f7a49e9ebf6c9c854a6ced255aa
CREATE OR REPLACE FUNCTION public.group_league()
 RETURNS TABLE(group_id uuid, name text, total integer, members integer, rank integer, is_mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return query
  with g as (
    select gm.group_id as gid, count(*)::int as cnt, coalesce(sum(wb.n), 0)::int as tot,
           bool_or(gm.user_id = v_uid) as mine
      from public.group_members gm
      left join public.week_beers wb on wb.user_id = gm.user_id and wb.week = public.olnu_week_start(now())
     group by gm.group_id having count(*) >= 2 and (bool_or(gm.user_id = v_uid) or bool_or(not public.olnu_is_test_user(gm.user_id)) or (select public.olnu_is_test_user(v_uid)))
  ),
  r as (
    select g.*, grp.name as gname, grp.created_at as gcreated,
           (row_number() over (order by g.tot desc, grp.created_at asc, g.gid))::int as rnk
      from g join public.groups grp on grp.id = g.gid
  )
  select r.gid, case when r.mine then r.gname else null end, r.tot, r.cnt, r.rnk, r.mine
    from r where r.rnk <= 10 or r.mine order by r.rnk;
end; $function$;
