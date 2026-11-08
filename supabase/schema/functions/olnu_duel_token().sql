-- public.olnu_duel_token()
-- live md5(pg_get_functiondef) = 688775cf7ef29a0ef7dd1dfc6a1af8c1
CREATE OR REPLACE FUNCTION public.olnu_duel_token()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '' order by i)
    from (select extensions.gen_random_bytes(8) b) x, generate_series(0, 7) i;
$function$;
