-- public.olnu_area_check(p_poly jsonb, p_lat0 double precision, p_lng0 double precision)
-- live md5(pg_get_functiondef) = 714d754734fa607e6fef5d2e251868aa
CREATE OR REPLACE FUNCTION public.olnu_area_check(p_poly jsonb, p_lat0 double precision, p_lng0 double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  n int; i int; j int;
  x double precision[] := '{}'; y double precision[] := '{}';
  lo double precision; la double precision;
  kx double precision := 111195 * cos(radians(p_lat0)); ky double precision := 111195;
  a double precision := 0; pts jsonb := '[]'::jsonb;
  ax double precision; ay double precision; bx double precision; by_ double precision;
  cx double precision; cy double precision; dx double precision; dy double precision;
  d1 double precision; d2 double precision; d3 double precision; d4 double precision;
begin
  if p_poly is null or jsonb_typeof(p_poly) <> 'array' then raise exception 'invalid_area'; end if;
  n := jsonb_array_length(p_poly);
  if n >= 4 and p_poly -> 0 = p_poly -> (n - 1) then n := n - 1; end if;   -- closed ring given
  if n < 3 or n > 40 then raise exception 'invalid_area'; end if;
  for i in 0 .. n - 1 loop
    if jsonb_typeof(p_poly -> i) <> 'array' or jsonb_array_length(p_poly -> i) <> 2
       or jsonb_typeof(p_poly -> i -> 0) <> 'number' or jsonb_typeof(p_poly -> i -> 1) <> 'number' then
      raise exception 'invalid_area';
    end if;
    lo := round((p_poly -> i ->> 0)::numeric, 6)::float8; la := round((p_poly -> i ->> 1)::numeric, 6)::float8;
    if abs(la) > 85 or abs(lo) > 180 then raise exception 'invalid_area'; end if;
    x := x || ((lo - p_lng0) * kx); y := y || ((la - p_lat0) * ky);
    if sqrt(power(x[i + 1], 2) + power(y[i + 1], 2)) > 60 then raise exception 'too_far'; end if;
    pts := pts || jsonb_build_array(jsonb_build_array(lo, la));
  end loop;
  for i in 1 .. n loop
    j := case when i = n then 1 else i + 1 end;
    a := a + x[i] * y[j] - x[j] * y[i];
  end loop;
  a := abs(a) / 2;
  if a < 20 or a > 3000 then raise exception 'area_size'; end if;
  -- no two non-neighbour edges may cross (proper crossing or touching)
  for i in 1 .. n loop
    ax := x[i]; ay := y[i]; bx := x[case when i = n then 1 else i + 1 end]; by_ := y[case when i = n then 1 else i + 1 end];
    for j in i + 1 .. n loop
      if j = i + 1 or (i = 1 and j = n) then continue; end if;
      cx := x[j]; cy := y[j]; dx := x[case when j = n then 1 else j + 1 end]; dy := y[case when j = n then 1 else j + 1 end];
      d1 := (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      d2 := (dx - cx) * (by_ - cy) - (dy - cy) * (bx - cx);
      d3 := (bx - ax) * (cy - ay) - (by_ - ay) * (cx - ax);
      d4 := (bx - ax) * (dy - ay) - (by_ - ay) * (dx - ax);
      if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)) then
        raise exception 'self_cross';
      end if;
    end loop;
  end loop;
  return jsonb_build_object('pts', pts, 'area', round(a::numeric, 1), 'n', n);
end; $function$;
