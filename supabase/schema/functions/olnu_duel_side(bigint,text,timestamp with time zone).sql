-- public.olnu_duel_side(p_duel bigint, p_side text, p_t1 timestamp with time zone)
-- live md5(pg_get_functiondef) = 2230496ab3790612aefcd8d37949995b
CREATE OR REPLACE FUNCTION public.olnu_duel_side(p_duel bigint, p_side text, p_t1 timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (
    select x.*, case when p_side = 'a' then x.group_a else x.group_b end as gid,
                case when p_side = 'a' then x.group_b else x.group_a end as oid,
                x.accepted_at as t0, least(coalesce(p_t1, now()), x.ends_at) as t1
      from public.duels x where x.id = p_duel
  ), mem as (
    select m.user_id,
           exists (select 1 from public.group_members o, d where o.group_id = d.oid and o.user_id = m.user_id) as dual,
           (select s.side from public.duel_sides s, d where s.duel_id = d.id and s.user_id = m.user_id) as pick
      from d join public.group_members m on m.group_id = d.gid
  ), cnt as (
    select mem.user_id from mem where not mem.dual or mem.pick = p_side
  ), per as (
    select c.user_id,
      greatest(0, coalesce((select sum(l.n) from public.duel_log l, d where l.user_id = c.user_id and l.kind = 'drink'
                                and d.t0 is not null and l.at >= d.t0 and l.at <= d.t1), 0))::int as dr,
      (least(3, (select count(*) from public.duel_log l, d where l.user_id = c.user_id and l.kind = 'checkin'
                    and d.t0 is not null and l.at >= d.t0 and l.at <= d.t1)) * 3
       + least(10, (select count(*) from public.duel_log l, d where l.user_id = c.user_id and l.kind = 'skal'
                    and d.t0 is not null and l.at >= d.t0 and l.at <= d.t1))
       + least(3, (select count(*) from public.duel_log l, d where l.user_id = c.user_id and l.kind = 'photo'
                    and d.t0 is not null and l.at >= d.t0 and l.at <= d.t1)) * 2)::int as sp
      from cnt c
  )
  select jsonb_build_object(
    'drinks', coalesce((select sum(per.dr) from per), 0)::int,
    'spirit', coalesce((select sum(per.sp) from per), 0)::int,
    'members', (select count(*) from cnt)::int,
    'undecided', (select count(*) from mem where mem.dual and mem.pick is null)::int);
$function$;
