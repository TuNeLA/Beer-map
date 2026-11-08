-- public.my_rallies()
-- live md5(pg_get_functiondef) = 44749248fbeebbe7a2f5d2adc676ad11
CREATE OR REPLACE FUNCTION public.my_rallies()
 RETURNS TABLE(id bigint, name text, body text, place text, lat double precision, lng double precision, created_at timestamp with time zone, yes integer, no integer, maybe integer, my_answer text, yes_names text[], is_mine boolean, group_id uuid, group_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return query
  select r.id, r.name, r.body, r.place, r.lat, r.lng, r.created_at, r.yes, r.no, r.maybe,
         r.my_answer, r.yes_names, r.is_mine, r.group_id, r.group_name
    from public.olnu_rally_rows(v_uid, null) r;
end; $function$;
