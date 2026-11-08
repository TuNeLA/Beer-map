-- public.medevac_checks()
-- live md5(pg_get_functiondef) = f8ba5b0460d6e47a9c7eaf136bfbfa9b
CREATE OR REPLACE FUNCTION public.medevac_checks()
 RETURNS TABLE(id bigint, beer_id bigint, target_name text, checker_name text, target_is_me boolean, checker_is_me boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select c.id, b.id, public.olnu_name_for(v_uid, c.target), public.olnu_name_for(v_uid, c.checker),
         c.target = v_uid, c.checker = v_uid, c.created_at
    from public.medevac_checks c
    left join public.beers b on b.user_id = c.target and b.expires_at = c.night
   where c.night > now()
     and (c.target = v_uid or c.checker = v_uid
          or public.olnu_shares_group(v_uid, c.target) or public.olnu_shares_group(v_uid, c.checker))
   order by c.created_at desc
   limit 50;
end;
$function$;
