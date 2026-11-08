-- public.olnu_eta_arrive(p_uid uuid, p_bar_id text, p_lat double precision, p_lng double precision, p_bar_only boolean)
-- live md5(pg_get_functiondef) = 671cbc12a252bd93877238de7f846c75
CREATE OR REPLACE FUNCTION public.olnu_eta_arrive(p_uid uuid, p_bar_id text, p_lat double precision, p_lng double precision, p_bar_only boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.etas e set arrived_at = now()
   where e.user_id = p_uid and e.cancelled_at is null and e.arrived_at is null and e.expires_at > now()
     and e.eta_at > now() - interval '20 minutes'
     and (
       (p_bar_id is not null and e.bar_id is not null and e.bar_id = p_bar_id)
       or (
         (not p_bar_only or e.bar_id is null)
         and e.lat is not null and e.lng is not null and p_lat is not null and p_lng is not null
         and public.olnu_dist_m(e.lat, e.lng, p_lat, p_lng) <= 100
       )
     );
end; $function$;
