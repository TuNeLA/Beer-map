-- public.olnu_gw_dalarna(p_town text)
-- live md5(pg_get_functiondef) = 276406bd5b5350f34d7754ff9ab4395c
CREATE OR REPLACE FUNCTION public.olnu_gw_dalarna(p_town text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(p_town, '') in ('Ludvika', 'Smedjebacken', 'Grängesberg', 'Borlänge', 'Falun', 'Säter', 'Hedemora', 'Avesta',
    'Leksand', 'Rättvik', 'Mora', 'Orsa', 'Älvdalen', 'Malung', 'Sälen', 'Vansbro');
$function$;
