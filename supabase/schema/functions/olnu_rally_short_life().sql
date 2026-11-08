-- public.olnu_rally_short_life()
-- live md5(pg_get_functiondef) = 0d955a1946a773889e19278998d52a4e
CREATE OR REPLACE FUNCTION public.olnu_rally_short_life()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.expires_at := least(coalesce(new.expires_at, now() + interval '2 hours'), coalesce(new.created_at, now()) + interval '2 hours');
  return new;
end;
$function$;
