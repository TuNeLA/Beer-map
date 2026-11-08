-- public.olnu_sport_info(p_bar_id text, p_uid uuid)
-- live md5(pg_get_functiondef) = 9419f2f21e1f86e76a365409153797ea
CREATE OR REPLACE FUNCTION public.olnu_sport_info(p_bar_id text, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with v as (select count(*) filter (where yes) y, count(*) filter (where yes = false) n
               from public.bar_sport_votes where bar_id = p_bar_id),
       o as (select shows from public.bar_sport_owner where bar_id = p_bar_id)
  select jsonb_build_object('bar_id', p_bar_id, 'yes', v.y, 'no', v.n, 'owner', (select shows from o),
           'shows', coalesce((select shows from o), v.y >= 1 and v.y > v.n),
           'mine', (select yes from public.bar_sport_votes where bar_id = p_bar_id and user_id = p_uid))
    from v;
$function$;
