-- public.olnu_find_resolve(p_key text, p_uid uuid)
-- live md5(pg_get_functiondef) = 4e8ea8ac26a67635476ae072eec0c1e6
CREATE OR REPLACE FUNCTION public.olnu_find_resolve(p_key text, p_uid uuid)
 RETURNS TABLE(uid uuid, group_id uuid, friendship_id bigint, name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_gid uuid; v_k text; f public.friendships;
begin
  if v_key ~ '^f[0-9]{1,18}$' then
    select * into f from public.friendships x where x.id = substr(v_key, 2)::bigint and x.status = 'accepted' and (x.a = p_uid or x.b = p_uid);
    if f.id is null then raise exception 'invalid_target'; end if;
    uid := public.olnu_friend_other(f, p_uid); group_id := null; friendship_id := f.id; name := public.olnu_friend_name(uid);
    return next; return;
  elsif v_key ~ '^g[0-9a-fA-F-]{36}:[0-9a-f]{12}$' then
    v_gid := substr(v_key, 2, 36)::uuid; v_k := substr(v_key, 39);
    if not exists (select 1 from public.group_members gm where gm.group_id = v_gid and gm.user_id = p_uid) then raise exception 'invalid_target'; end if;
    select gm.user_id, gm.display_name into uid, name from public.group_members gm
     where gm.group_id = v_gid and public.olnu_chief_k(v_gid, gm.user_id) = v_k;
    if uid is null or uid = p_uid then raise exception 'invalid_target'; end if;
    group_id := v_gid; friendship_id := null;
    return next; return;
  end if;
  raise exception 'invalid_target';
end; $function$;
