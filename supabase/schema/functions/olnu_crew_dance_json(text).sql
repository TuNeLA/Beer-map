-- public.olnu_crew_dance_json(p_bar text)
-- live md5(pg_get_functiondef) = be986d828982f316e01651a5a2ec9538
CREATE OR REPLACE FUNCTION public.olnu_crew_dance_json(p_bar text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'n', count(*),
    'avg', case when count(*) > 0 then round((sum(d.level * w) / sum(w))::numeric, 2) end,
    'level', case when count(*) > 0 then round(sum(d.level * w) / sum(w))::int end,
    'at', max(d.created_at))
  from (select x.level, x.created_at,
               (1.0 - least(1.0, extract(epoch from (now() - x.created_at)) / 1800.0) * 0.5) as w
          from public.crew_dance x where x.bar_id = p_bar and x.expires_at > now()) d;
$function$;
