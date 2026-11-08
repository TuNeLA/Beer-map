-- public.olnu_world_pos_tg()
-- live md5(pg_get_functiondef) = 06527350f3aef7ed51bc87cfaae4b0e1
CREATE OR REPLACE FUNCTION public.olnu_world_pos_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s   text := coalesce(current_setting('olnu.world_pos', true), '');
  v_lat float8;
  v_lng float8;
begin
  if v_s = '' or new.lat is distinct from 62.0::float8 or new.lng is distinct from 15.0::float8 then
    return new;
  end if;
  v_lat := split_part(v_s, ',', 1)::float8;
  v_lng := split_part(v_s, ',', 2)::float8;
  if not public.olnu_world_ok(v_lat, v_lng) then
    return new;
  end if;
  if new.precise then
    new.lat := round(v_lat::numeric, 5)::float8;
    new.lng := round(v_lng::numeric, 5)::float8;
  else
    new.lat := (round(v_lat::numeric / 0.005) * 0.005)::float8;
    new.lng := (round(v_lng::numeric / 0.01) * 0.01)::float8;
  end if;
  return new;
end; $function$;
