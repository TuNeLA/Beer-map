-- public.kebab_place(p_place_id text)
-- live md5(pg_get_functiondef) = cade917e8ad6182e800e11013fb12c37
CREATE OR REPLACE FUNCTION public.kebab_place(p_place_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_month date := date_trunc('month', now() at time zone 'Europe/Stockholm')::date;
  v_night timestamptz := public.olnu_night_of(now());
  r jsonb;
begin
  with latest as (
    select distinct on (k.user_id) k.* from public.kebab_ratings k
     where k.place_id = p_place_id and k.month = v_month order by k.user_id, k.updated_at desc
  )
  select jsonb_build_object(
    'avg', (select round(avg(l.stars)::numeric, 2) from latest l),
    'n', (select count(*) from latest l)::int,
    'my_stars', (select l.stars from latest l where l.user_id = v_uid),
    'my_tag', (select l.tag from latest l where l.user_id = v_uid),
    'rated_tonight', exists (select 1 from public.kebab_ratings k where k.user_id = v_uid and k.place_id = p_place_id and k.night = v_night),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('tag', t.tag, 'n', t.n) order by t.n desc)
                       from (select l.tag, count(*)::int n from latest l where l.tag is not null group by l.tag) t), '[]'::jsonb))
    into r;
  return r;
end; $function$;
