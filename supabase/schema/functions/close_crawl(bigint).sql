-- public.close_crawl(p_crawl_id bigint)
-- live md5(pg_get_functiondef) = ff57a049c50dfefee2b23307ef6274ef
CREATE OR REPLACE FUNCTION public.close_crawl(p_crawl_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  update public.game_crawls c set closed = true
   where c.id = p_crawl_id and c.user_id = v_uid and c.night = public.olnu_night_of(now());
  if not found then
    raise exception 'crawl_not_found';
  end if;
  return jsonb_build_object('ok', true);
end; $function$;
