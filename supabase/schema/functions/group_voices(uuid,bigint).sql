-- public.group_voices(p_group_id uuid, p_after_id bigint)
-- live md5(pg_get_functiondef) = 7d530d73e14deab0cae95f53c9666346
CREATE OR REPLACE FUNCTION public.group_voices(p_group_id uuid, p_after_id bigint DEFAULT 0)
 RETURNS TABLE(id bigint, name text, mime text, dur_ms integer, bytes integer, created_at timestamp with time zone, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_temp boolean := public.olnu_is_temp_group(p_group_id);
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select x.id, x.name, x.mime, x.dur_ms, x.bytes, x.created_at, x.is_me from (
    select v.id, coalesce(gm.display_name, case when v_temp then public.olnu_friend_name(v.user_id) end) as name,
           v.mime, v.dur_ms, octet_length(v.audio) as bytes, v.created_at, v.user_id = v_uid as is_me
      from public.voice_msgs v
      left join public.group_members gm on gm.group_id = v.group_id and gm.user_id = v.user_id
     where v.group_id = p_group_id and v.expires_at > now() and v.id > coalesce(p_after_id, 0)
       and not public.olnu_ub_hidden(v_uid, v.user_id)
     order by v.id desc limit 30) x
   order by x.id;
end;
$function$;
