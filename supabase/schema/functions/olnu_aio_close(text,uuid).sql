-- public.olnu_aio_close(p_bar_id text, p_uid uuid)
-- live md5(pg_get_functiondef) = 2b0cd5dbff05b4296c581b16bca038c6
CREATE OR REPLACE FUNCTION public.olnu_aio_close(p_bar_id text, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('min', r.close_min, 'closed', r.closed, 'at', r.created_at, 'mine', r.user_id = p_uid,
           'n', (select count(*) from public.bar_close_reports x where x.bar_id = p_bar_id and x.evening = r.evening))
    from public.bar_close_reports r
   where r.bar_id = p_bar_id and r.evening = public.olnu_aio_evening()
   order by r.created_at desc limit 1;
$function$;
