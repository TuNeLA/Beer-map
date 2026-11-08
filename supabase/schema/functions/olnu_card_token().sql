-- public.olnu_card_token()
-- live md5(pg_get_functiondef) = 5f6e955873c4dd005c28a2ed5e49d3d4
CREATE OR REPLACE FUNCTION public.olnu_card_token()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '' order by i)
    from (select extensions.gen_random_bytes(10) b) x, generate_series(0, 9) i;
$function$;
