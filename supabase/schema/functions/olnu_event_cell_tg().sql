-- public.olnu_event_cell_tg()
-- live md5(pg_get_functiondef) = 18a7f9813f3a0a6b5a9576c9b662749c
CREATE OR REPLACE FUNCTION public.olnu_event_cell_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    select c.hlat, c.hlng, c.hkind into new.hlat, new.hlng, new.hkind
      from public.olnu_heat_cell(new.lat, new.lng, new.precise) c;
  exception when others then
    new.hlat := (round(new.lat::numeric / 0.005) * 0.005)::float8;
    new.hlng := (round(new.lng::numeric / 0.01) * 0.01)::float8;
    new.hkind := 3;
  end;
  return new;
end; $function$;
