-- public.olnu_card_faces(p_group uuid)
-- live md5(pg_get_functiondef) = c2b87553678d474333c7ed33054777a9
CREATE OR REPLACE FUNCTION public.olnu_card_faces(p_group uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(f.i), '[]'::jsonb) from (
    select upper(left(btrim(coalesce(m.display_name, '?')), 1)) as i
      from public.group_members m
      left join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
     where m.group_id = p_group
     order by (b.user_id is not null) desc, m.joined_at
     limit 4) f;
$function$;
