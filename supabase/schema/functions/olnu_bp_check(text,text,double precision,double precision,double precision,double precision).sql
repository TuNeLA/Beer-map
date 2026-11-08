-- public.olnu_bp_check(p_bar_id text, p_bar_name text, p_bar_lat double precision, p_bar_lng double precision, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = fa34df9ff8f6e00f8e4b8b941d4b326f
CREATE OR REPLACE FUNCTION public.olnu_bp_check(p_bar_id text, p_bar_name text, p_bar_lat double precision, p_bar_lng double precision, p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_id   text := public.olnu_bp_clean(p_bar_id);
  v_name text := public.olnu_bp_clean(p_bar_name);
begin
  if char_length(v_id) < 1 or char_length(v_id) > 80 or char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'invalid_bar';
  end if;
  if not public.olnu_bp_in_sweden(p_bar_lat, p_bar_lng) or not public.olnu_bp_in_sweden(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if public.olnu_dist_m(p_bar_lat, p_bar_lng, p_lat, p_lng) > 300 then
    raise exception 'too_far';
  end if;
end;
$function$;
