-- public.olnu_snap(p_lat double precision, p_lng double precision, p_precise boolean)
-- live md5(pg_get_functiondef) = 2ee05e29d08673adcc8a6bb2dca0fd78
CREATE OR REPLACE FUNCTION public.olnu_snap(p_lat double precision, p_lng double precision, p_precise boolean)
 RETURNS TABLE(snap_lat double precision, snap_lng double precision, snap_bar text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_id text; v_la float8; v_ln float8;
begin
  if p_lat is null or p_lng is null then
    return query select p_lat, p_lng, null::text;
    return;
  end if;
  if coalesce(p_precise, false) then
    select nb.id, nb.lat, nb.lng into v_id, v_la, v_ln from public.olnu_near_bar(p_lat, p_lng) nb;
    if v_id is not null then
      return query select v_la, v_ln, v_id;
      return;
    end if;
    return query select (round(p_lat::numeric / 0.005) * 0.005)::float8, (round(p_lng::numeric / 0.01) * 0.01)::float8, null::text;
    return;
  end if;
  return query select p_lat, p_lng, null::text;
end;
$function$;
