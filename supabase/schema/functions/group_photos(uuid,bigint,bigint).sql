-- public.group_photos(p_group_id uuid, p_after_id bigint, p_before_id bigint)
-- live md5(pg_get_functiondef) = 4c45874c918ea877258c33f037687c1c
CREATE OR REPLACE FUNCTION public.group_photos(p_group_id uuid, p_after_id bigint DEFAULT 0, p_before_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, msg_id bigint, w integer, h integer, size integer, created_at timestamp with time zone, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select x.id, x.msg_id, x.w, x.h, x.size, x.created_at, x.is_me from (
    select cp.id, cp.msg_id, cp.w, cp.h, cp.size, cp.created_at, cp.user_id = v_uid as is_me
      from public.chat_photos cp
     where cp.group_id = p_group_id and cp.expires_at > now() and cp.bytes is not null
       and cp.id > coalesce(p_after_id, 0) and (p_before_id is null or cp.id < p_before_id)
       and not public.olnu_ub_hidden(v_uid, cp.user_id)
     order by cp.id desc limit 100) x
   order by x.id;
end;
$function$;
