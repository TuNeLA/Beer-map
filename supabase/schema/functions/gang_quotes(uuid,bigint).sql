-- public.gang_quotes(p_group_id uuid, p_before_id bigint)
-- live md5(pg_get_functiondef) = 2ff5404f930e05f25cec7134c1c37e5c
CREATE OR REPLACE FUNCTION public.gang_quotes(p_group_id uuid, p_before_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, who text, body text, by_name text, by_me boolean, created_at timestamp with time zone, night timestamp with time zone, reveal_at timestamp with time zone, revealed boolean, can_hide boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_me text;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  v_me := lower(coalesce(public.olnu_gang_name(p_group_id, v_uid), ''));
  return query
  select q.id, q.who, q.body, public.olnu_gang_name(q.group_id, q.user_id), q.user_id = v_uid, q.created_at, q.night,
         q.reveal_at, q.reveal_at <= now(), q.user_id = v_uid or lower(q.who) = v_me
    from public.gang_quotes q
   where q.group_id = p_group_id and not q.hidden
     and (q.reveal_at <= now() or q.user_id = v_uid)
     and (p_before_id is null or q.id < p_before_id)
   order by q.id desc
   limit 30;
end; $function$;
