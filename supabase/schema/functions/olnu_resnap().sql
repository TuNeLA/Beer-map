-- public.olnu_resnap()
-- live md5(pg_get_functiondef) = e5a9bc5af4c56b5503d517ba29cfcc1f
CREATE OR REPLACE FUNCTION public.olnu_resnap()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n int;
begin
  update public.beers b
     set (snap_lat, snap_lng, snap_bar) = (select s.snap_lat, s.snap_lng, s.snap_bar
                                             from public.olnu_snap(b.lat, b.lng, b.precise) s)
   where b.expires_at > now() - interval '1 day' or b.snap_lat is null;
  get diagnostics v_n = row_count;
  update public.beer_events e
     set (hlat, hlng, hkind) = (select c.hlat, c.hlng, c.hkind from public.olnu_heat_cell(e.lat, e.lng, e.precise) c)
   where e.expires_at > now() - interval '1 day' or e.hlat is null or e.hkind is null;
  -- (beer_events older than ~10 days are cleaned by the notify-group function, so this stays small.)
  return v_n;
end;
$function$;
