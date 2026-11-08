-- public.walk_timer_due_claim(p_limit integer)
-- live md5(pg_get_functiondef) = 3b4ec1b2970ab82a5ba2d2d0aab43b9e
CREATE OR REPLACE FUNCTION public.walk_timer_due_claim(p_limit integer DEFAULT 50)
 RETURNS TABLE(walk_id bigint, stage text, user_id uuid, viewers uuid[], name text, due_at timestamp with time zone, last_lat double precision, last_lng double precision, last_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.olnu_gw_walk_advance(null);
  return query select * from public.olnu_gw_walk_claim(null, p_limit);
end $function$;
