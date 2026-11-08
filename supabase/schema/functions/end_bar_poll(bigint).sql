-- public.end_bar_poll(p_poll_id bigint)
-- live md5(pg_get_functiondef) = b057532a918532d0f5ca9de4167f2baf
CREATE OR REPLACE FUNCTION public.end_bar_poll(p_poll_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  p public.gang_polls;
begin
  select * into p from public.gang_polls x where x.id = p_poll_id;
  if not found or not public.olnu_gang_member(p.group_id, v_uid) then raise exception 'poll_not_found'; end if;
  if p.ended_at is null then
    if p.user_id <> v_uid and p.ends_at > now() then raise exception 'not_yours'; end if;
    perform public.olnu_gang_rl('poll:' || p.group_id::text);
    p := public.olnu_gang_poll_finish(p.id, v_uid);
  end if;
  return public.olnu_gang_poll_json(p, v_uid);
end; $function$;
