-- public.live_others()
-- live md5(pg_get_functiondef) = 65c6a7e2521a8061cb4606e13f6f5ad0
CREATE OR REPLACE FUNCTION public.live_others()
 RETURNS TABLE(beer_id bigint, other_count integer, other_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.olnu_uid();
  return query
  select b.id, b.other_count, b.other_kind from public.beers b
   where b.expires_at > now() and not b.stopped and b.other_count > 0 and (b.user_id = auth.uid() or not public.olnu_is_test_zone(b.lat, b.lng) or (select public.olnu_is_test_user(auth.uid())))
   order by b.id;
end; $function$;
