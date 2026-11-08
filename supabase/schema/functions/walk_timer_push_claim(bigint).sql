-- public.walk_timer_push_claim(p_walk_id bigint)
-- live md5(pg_get_functiondef) = 8c225bc74eee7bde6632a8bf29858525
CREATE OR REPLACE FUNCTION public.walk_timer_push_claim(p_walk_id bigint)
 RETURNS TABLE(walk_id bigint, stage text, user_id uuid, viewers uuid[], name text, due_at timestamp with time zone, last_lat double precision, last_lng double precision, last_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_walk_id is null then return; end if;
  perform public.olnu_gw_walk_advance(p_walk_id);
  return query select * from public.olnu_gw_walk_claim(p_walk_id, 5);
end $function$;
