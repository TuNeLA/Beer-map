-- public.olnu_rank_of(p_m integer)
-- live md5(pg_get_functiondef) = 94bc928d1f9da837a306692b07e4dfbc
CREATE OR REPLACE FUNCTION public.olnu_rank_of(p_m integer)
 RETURNS TABLE(idx integer, title text, at integer, next_title text, next_at integer, n integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with l as (select t.at, t.title, row_number() over (order by t.at)::int as i, count(*) over ()::int as n
               from public.olnu_titles() t),
       c as (select * from l where l.at <= greatest(0, coalesce(p_m, 0)) order by l.at desc limit 1)
  select c.i, c.title, c.at, x.title, x.at, c.n
    from c left join l x on x.i = c.i + 1;
$function$;
