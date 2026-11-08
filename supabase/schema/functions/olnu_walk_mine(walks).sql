-- public.olnu_walk_mine(w walks)
-- live md5(pg_get_functiondef) = 75d44a34827421c334183a1a8ff1b069
CREATE OR REPLACE FUNCTION public.olnu_walk_mine(w walks)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', w.id, 'live', w.ended_at is null and w.ends_at > now(),
    'started_at', w.started_at, 'ends_at', w.ends_at, 'ended_at', w.ended_at, 'end_reason', w.end_reason,
    'group_id', w.group_id, 'group_name', (select g.name from public.groups g where g.id = w.group_id),
    'n', coalesce(array_length(w.viewers, 1), 0),
    'watching', (select count(*) from public.walk_views v where v.walk_id = w.id and v.seen_at > now() - interval '90 seconds'),
    'seen_by', (select count(*) from public.walk_views v where v.walk_id = w.id),
    'pos_at', w.pos_at, 'msg_id', w.msg_id);
$function$;
