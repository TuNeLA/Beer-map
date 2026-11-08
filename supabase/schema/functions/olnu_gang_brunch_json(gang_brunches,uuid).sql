-- public.olnu_gang_brunch_json(b gang_brunches, p_uid uuid)
-- live md5(pg_get_functiondef) = ae55e2b2681cd296560b6b4a03b6565c
CREATE OR REPLACE FUNCTION public.olnu_gang_brunch_json(b gang_brunches, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with a as (
    select x.user_id, x.answer, x.updated_at from public.gang_brunch_answers x
      join public.group_members m on m.group_id = b.group_id and m.user_id = x.user_id
     where x.brunch_id = b.id
  )
  select jsonb_build_object(
    'id', b.id, 'by', public.olnu_gang_name(b.group_id, b.user_id), 'by_me', b.user_id = p_uid,
    'place', b.place, 'place_id', b.place_id, 'lat', b.lat, 'lng', b.lng, 'at_time', b.at_time,
    'created_at', b.created_at, 'expires_at', b.expires_at,
    'mine', (select a.answer from a where a.user_id = p_uid),
    'ja', coalesce((select jsonb_agg(public.olnu_gang_name(b.group_id, a.user_id) order by a.user_id <> b.user_id, a.updated_at) from a where a.answer = 'ja'), '[]'::jsonb),
    'kanske', coalesce((select jsonb_agg(public.olnu_gang_name(b.group_id, a.user_id) order by a.updated_at) from a where a.answer = 'kanske'), '[]'::jsonb),
    'nej', coalesce((select jsonb_agg(public.olnu_gang_name(b.group_id, a.user_id) order by a.updated_at) from a where a.answer = 'nej'), '[]'::jsonb));
$function$;
