-- public.crew_dates_close(p_poll_id bigint)
-- live md5(pg_get_functiondef) = 002e87690dc5d3df851ca9f7aaafcb0e
CREATE OR REPLACE FUNCTION public.crew_dates_close(p_poll_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  update public.crew_date_polls p set closed_at = coalesce(p.closed_at, now())
   where p.id = p_poll_id and p.user_id = v_uid and p.ends_at > now();
  if not found then raise exception 'poll_not_found'; end if;
  return jsonb_build_object('ok', true);
end; $function$;
