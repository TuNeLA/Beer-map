-- public.user_places(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 9a089b55bea583b68372340aabf96722
CREATE OR REPLACE FUNCTION public.user_places(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.bar_id, 'name', s.name, 'type', s.type, 'lat', s.lat, 'lng', s.lng,
             'pending', s.status = 'pending', 'mine', s.user_id = v_uid) order by s.id)
    from (select * from public.place_suggestions x
           where (x.status = 'ok' and (p_lat is null or (x.lat between p_lat - 0.4 and p_lat + 0.4 and x.lng between p_lng - 0.8 and p_lng + 0.8)))
              or (x.status = 'pending' and x.user_id = v_uid)
           order by x.id desc limit 300) s), '[]'::jsonb);
end; $function$;
