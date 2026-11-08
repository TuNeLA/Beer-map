-- public.group_msgs(p_group_id uuid, p_after_id bigint)
-- live md5(pg_get_functiondef) = a27962286e94178498fcdfa7e28fe836
CREATE OR REPLACE FUNCTION public.group_msgs(p_group_id uuid, p_after_id bigint DEFAULT 0)
 RETURNS TABLE(id bigint, name text, body text, created_at timestamp with time zone, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_after bigint := coalesce(p_after_id, 0);
  v_temp boolean := public.olnu_is_temp_group(p_group_id);
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select s.mid, s.mname, s.mbody, s.mat, s.mme
    from (
      select gm.id as mid,
             coalesce((select mm.display_name from public.group_members mm where mm.group_id = gm.group_id and mm.user_id = gm.user_id),
                      case when v_temp then public.olnu_friend_name(gm.user_id) end) as mname,
             gm.body as mbody, gm.created_at as mat, (gm.user_id = v_uid) as mme
        from public.group_msgs gm
       where gm.group_id = p_group_id and gm.expires_at > now() and gm.id > v_after
         and not public.olnu_ub_hidden(v_uid, gm.user_id)
       order by case when v_after = 0 then -gm.id else gm.id end
       limit 100
    ) s order by s.mid;
end; $function$;
