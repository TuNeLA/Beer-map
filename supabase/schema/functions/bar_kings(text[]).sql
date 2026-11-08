-- public.bar_kings(p_bar_ids text[])
-- live md5(pg_get_functiondef) = 0800fd1ed81b2d5d2b3872953875f888
CREATE OR REPLACE FUNCTION public.bar_kings(p_bar_ids text[])
 RETURNS TABLE(bar_id text, king_name text, king_n integer, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return query
  with ids as (
    select distinct x as id from unnest((coalesce(p_bar_ids, array[]::text[]))[1:500]) as u(x)
  ),
  ranked as (
    select t.bar_id as b_id, t.user_id as u_id, t.n as cnt,
           row_number() over (partition by t.bar_id order by t.n desc, t.last_at asc, t.user_id) as rn
      from public.bar_taps t join ids on ids.id = t.bar_id
     where t.week = public.olnu_week_start(now()) and t.n > 0
  )
  select r.b_id,
         (select min(am.display_name) from public.group_members am
            join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
           where am.user_id = r.u_id),
         r.cnt, (r.u_id = v_uid)
    from ranked r where r.rn = 1 order by r.b_id;
end; $function$;
