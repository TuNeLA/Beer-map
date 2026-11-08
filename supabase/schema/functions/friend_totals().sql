-- public.friend_totals()
-- live md5(pg_get_functiondef) = 74e1229f8a4c20711e8c0d551091d3fb
CREATE OR REPLACE FUNCTION public.friend_totals()
 RETURNS TABLE(beer_id bigint, total integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return query
  select b.id, public.olnu_lifetime(b.user_id)
    from public.beers b
   where b.expires_at > now() and not b.stopped
     and (b.user_id = v_uid or exists (select 1 from public.group_members am
            join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
           where am.user_id = b.user_id))
   order by b.id;
end; $function$;
