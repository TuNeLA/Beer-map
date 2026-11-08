-- public.bar_regulars(p_bar_id text)
-- live md5(pg_get_functiondef) = 162d150465d134a927395e2cfa6800ca
CREATE OR REPLACE FUNCTION public.bar_regulars(p_bar_id text)
 RETURNS TABLE(rank integer, name text, nights integer, is_me boolean, last_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with n as (
    select c.user_id as u, count(distinct c.night)::int as k, max(c.night) as la
      from public.medal_checkins c
     where c.bar_id = left(coalesce(p_bar_id, ''), 80) and c.night > now() - interval '30 days'
     group by c.user_id
  ),
  r as (select n.*, (row_number() over (order by n.k desc, n.la asc, n.u))::int as rk from n)
  select r.rk, public.olnu_name_for(v_uid, r.u), r.k, r.u = v_uid, r.la
    from r
   where (r.rk <= 3 and r.k >= 2) or r.u = v_uid
   order by r.rk;
end;
$function$;
