-- public.olnu_medal_store(p_uid uuid)
-- live md5(pg_get_functiondef) = ad89aadfb979233eb5ef10002e7764a8
CREATE OR REPLACE FUNCTION public.olnu_medal_store(p_uid uuid)
 RETURNS TABLE(medal text, count integer, is_new boolean, earned_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sql text;
begin
  select string_agg(format('select x.medal as m, x.n from public.%I($1) x', p.proname), ' union all ' order by p.proname)
    into v_sql
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname ~ '^olnu_medal_eval(_[a-z0-9]+)?$'
     and pg_get_function_identity_arguments(p.oid) = 'p_uid uuid'
     and pg_get_function_result(p.oid) = 'TABLE(medal text, n integer)';
  if v_sql is null then
    return;
  end if;
  return query execute
    'with ev as (' || v_sql || '),
     e as (select ev.m, max(ev.n)::int as n from ev where ev.n >= 1 group by ev.m),
     up as (
       insert into public.user_medals as um (user_id, medal, count, earned_at, updated_at)
       select $1, e.m, e.n, now(), now() from e
       on conflict on constraint user_medals_pkey do update
          set count = greatest(um.count, excluded.count), updated_at = now()
        where excluded.count > um.count
       returning um.medal, um.count, (um.earned_at = now()) as fresh, um.earned_at)
     select up.medal, up.count, up.fresh, up.earned_at from up'
  using p_uid;
end;
$function$;
