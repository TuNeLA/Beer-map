-- public.olnu_eta_rally_ok(e etas)
-- live md5(pg_get_functiondef) = 6e78a6793bbc84d9e7acea9c9976ab43
CREATE OR REPLACE FUNCTION public.olnu_eta_rally_ok(e etas)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select e.rally_id is null
      or exists (select 1 from public.rallies r where r.id = e.rally_id and not r.closed and r.expires_at > now());
$function$;
