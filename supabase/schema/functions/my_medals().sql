-- public.my_medals()
-- live md5(pg_get_functiondef) = 35f4c8af30f3a90041e1e5f000f7dad8
CREATE OR REPLACE FUNCTION public.my_medals()
 RETURNS TABLE(medal text, earned_at timestamp with time zone, count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select um.medal, um.earned_at, um.count from public.user_medals um
   where um.user_id = v_uid order by um.earned_at, um.medal;
end;
$function$;
