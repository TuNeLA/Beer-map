-- public.crew_dance_bar(p_bar_id text)
-- live md5(pg_get_functiondef) = 4199a0e9b50474ec9c477df5bce819c1
CREATE OR REPLACE FUNCTION public.crew_dance_bar(p_bar_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_last timestamptz;
begin
  select max(d.created_at) into v_last from public.crew_dance d where d.user_id = v_uid and d.bar_id = p_bar_id;
  return public.olnu_crew_dance_json(p_bar_id) || jsonb_build_object('wait_seconds',
    case when v_last > now() - interval '10 minutes'
         then greatest(1, ceil(extract(epoch from (v_last + interval '10 minutes' - now())))::int) else 0 end);
end; $function$;
