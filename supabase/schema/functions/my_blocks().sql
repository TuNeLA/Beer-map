-- public.my_blocks()
-- live md5(pg_get_functiondef) = 96e987e28ec0fbff85186b739ba67812
CREATE OR REPLACE FUNCTION public.my_blocks()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('v', 1, 'blocks', coalesce((select jsonb_agg(jsonb_build_object(
           'id', substr(md5(k.blocker::text || ':' || k.blocked::text || ':olnu-ub'), 1, 16), 'name', coalesce(k.name, '?'), 'at', k.created_at)
           order by k.created_at desc) from public.user_blocks k where k.blocker = public.olnu_uid() and k.active), '[]'::jsonb));
$function$;
