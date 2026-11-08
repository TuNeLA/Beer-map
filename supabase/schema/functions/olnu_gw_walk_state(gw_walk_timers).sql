-- public.olnu_gw_walk_state(t gw_walk_timers)
-- live md5(pg_get_functiondef) = efa4dfdf6e0e5f27c9e05b5ea654fa3b
CREATE OR REPLACE FUNCTION public.olnu_gw_walk_state(t gw_walk_timers)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('walk_id', t.walk_id, 'minutes', t.minutes, 'due_at', t.due_at, 'reminded_at', t.reminded_at,
    'alert_at', t.alert_at, 'ok_at', t.ok_at, 'cancelled_at', t.cancelled_at, 'now', now(),
    'left_s', greatest(0, ceil(extract(epoch from (t.due_at - now()))))::int,
    'answer_s', case when t.reminded_at is not null and t.alert_at is null
                     then greatest(0, ceil(extract(epoch from (t.reminded_at + interval '30 seconds' - now()))))::int end);
$function$;
