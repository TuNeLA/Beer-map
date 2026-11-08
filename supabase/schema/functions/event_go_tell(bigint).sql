-- public.event_go_tell(p_event_id bigint)
-- live md5(pg_get_functiondef) = 58285d5b730641877705a5dbd68dfd4a
CREATE OR REPLACE FUNCTION public.event_go_tell(p_event_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_n int;
begin
  update public.event_going g set told_at = now()
   where g.event_id = p_event_id and g.user_id = v_uid and g.going and g.told_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'first', v_n > 0);
end; $function$;
