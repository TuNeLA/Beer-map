-- public.olnu_aio_club(p_bar_id text)
-- live md5(pg_get_functiondef) = dafab4ae156e4ab575273e4d41ed8c17
CREATE OR REPLACE FUNCTION public.olnu_aio_club(p_bar_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('age', c.age, 'fee', c.fee, 'dress', c.dress, 'at', coalesce(c.status_at, c.created_at))
    from public.club_info c
   where c.bar_id = p_bar_id and c.status = 'ok' and c.superseded_at is null
   order by coalesce(c.status_at, c.created_at) desc limit 1;
$function$;
