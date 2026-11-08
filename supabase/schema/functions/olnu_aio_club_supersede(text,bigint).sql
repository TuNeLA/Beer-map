-- public.olnu_aio_club_supersede(p_bar_id text, p_keep bigint)
-- live md5(pg_get_functiondef) = ce58c56aa8c043115872be82db000ec5
CREATE OR REPLACE FUNCTION public.olnu_aio_club_supersede(p_bar_id text, p_keep bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.club_info c set superseded_at = now()
   where c.bar_id = p_bar_id and c.status = 'ok' and c.superseded_at is null and c.id <> p_keep;
$function$;
