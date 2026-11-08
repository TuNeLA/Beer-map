-- public.olnu_film_photo_json(sp snap_photos, p_uid uuid)
-- live md5(pg_get_functiondef) = 1a468cfc2b333c9d9fda54ee2f75d6ab
CREATE OR REPLACE FUNCTION public.olnu_film_photo_json(sp snap_photos, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', sp.id, 'k', public.olnu_gang_k(sp.group_id, sp.user_id),
    'name', coalesce(public.olnu_gang_name(sp.group_id, sp.user_id), '?'), 'is_me', sp.user_id = p_uid,
    'at', sp.created_at, 'w', sp.w, 'h', sp.h,
    'reacts', coalesce((select jsonb_agg(jsonb_build_object('e', x.emoji, 'n', x.n) order by x.n desc, x.emoji)
                          from (select r.emoji, count(*)::int as n from public.film_reacts r
                                 where r.photo_id = sp.id and r.active group by r.emoji) x), '[]'::jsonb),
    'n', (select count(*) from public.film_reacts r where r.photo_id = sp.id and r.active)::int,
    'my', (select r.emoji from public.film_reacts r where r.photo_id = sp.id and r.user_id = p_uid and r.active));
$function$;
