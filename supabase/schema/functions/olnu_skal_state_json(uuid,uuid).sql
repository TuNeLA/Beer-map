-- public.olnu_skal_state_json(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 7eb0c10a0cd51608b4ca3d6282dfc8d4
CREATE OR REPLACE FUNCTION public.olnu_skal_state_json(p_group uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with last as (
    select x.* from public.skal_hours x where x.group_id = p_group order by x.created_at desc, x.id desc limit 1
  )
  select jsonb_build_object(
    'group_id', p_group,
    'can_start', public.olnu_skal_can(p_group, p_uid),
    'random_on', coalesce((select s.random_on from public.skal_settings s where s.group_id = p_group), false),
    'used', (select count(*) from public.skal_hours x where x.group_id = p_group and x.created_at >= public.olnu_skal_from())::int,
    'max', 4,
    'next_at', greatest(now(), coalesce((select l.created_at + interval '30 minutes' from last l), now())),
    'win_from', public.olnu_skal_win_from(public.olnu_night_of(now())),
    'win_to', public.olnu_skal_win_to(public.olnu_night_of(now())),
    'now', now(),
    'hour', (select public.olnu_skal_json(l, p_uid) from last l where l.created_at > now() - interval '2 hours'));
$function$;
