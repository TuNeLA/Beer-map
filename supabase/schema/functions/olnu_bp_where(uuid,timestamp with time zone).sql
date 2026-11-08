-- public.olnu_bp_where(p_uid uuid, p_at timestamp with time zone)
-- live md5(pg_get_functiondef) = 9543fdc108e392078bc7250810ed3a5f
CREATE OR REPLACE FUNCTION public.olnu_bp_where(p_uid uuid, p_at timestamp with time zone)
 RETURNS TABLE(bar_id text, bar_name text, bar_lat double precision, bar_lng double precision, via text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c record; b record; br record;
begin
  select ci.bar_id, ci.bar_name, ci.lat, ci.lng into c
    from public.checkins ci
   where ci.user_id = p_uid and ci.expires_at > p_at and ci.created_at > p_at - interval '3 hours'
     and ci.created_at <= p_at + interval '1 minute'
   order by ci.created_at desc limit 1;
  if found and c.bar_id is not null and c.lat is not null then
    bar_id := c.bar_id; bar_name := c.bar_name; bar_lat := c.lat; bar_lng := c.lng; via := 'checkin';
    return next; return;
  end if;
  select x.lat, x.lng into b
    from public.beers x
   where x.user_id = p_uid and x.expires_at > p_at and not coalesce(x.stopped, false) and not coalesce(x.ghost, false)
     and coalesce(x.precise, false)
     and greatest(coalesce(x.beer_at, x.created_at), coalesce(x.other_at, x.created_at), x.updated_at) > p_at - interval '2 hours'
   limit 1;
  if not found or b.lat is null then return; end if;
  select l.id, l.name, l.lat, l.lng, public.olnu_bp_m(b.lat, b.lng, l.lat, l.lng) as d into br
    from public.bars_lite l
   where l.active and l.lat between b.lat - 0.0007 and b.lat + 0.0007
     and l.lng between b.lng - 0.0014 and b.lng + 0.0014
   order by public.olnu_bp_m(b.lat, b.lng, l.lat, l.lng) limit 1;
  if found and br.d <= 60 then
    bar_id := br.id; bar_name := br.name; bar_lat := br.lat; bar_lng := br.lng; via := 'pin';
    return next;
  end if;
  return;
end; $function$;
