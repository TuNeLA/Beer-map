-- public.olnu_eta_live(e etas)
-- live md5(pg_get_functiondef) = f970ef3eb6cc1a3d31b97018a9305487
CREATE OR REPLACE FUNCTION public.olnu_eta_live(e etas)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select e.expires_at > now() and e.cancelled_at is null and e.arrived_at is null
     and e.eta_at > now() - interval '20 minutes' and public.olnu_eta_rally_ok(e);
$function$;
