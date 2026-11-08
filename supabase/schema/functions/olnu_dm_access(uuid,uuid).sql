-- public.olnu_dm_access(p_gid uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 3d8127ac8bed7373b02083cccc6fa9c3
CREATE OR REPLACE FUNCTION public.olnu_dm_access(p_gid uuid, p_uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.dm_threads;
  v_o uuid;
begin
  select * into t from public.dm_threads x where x.group_id = p_gid;
  if not found then return null; end if;
  if p_uid is null or (p_uid <> t.a and p_uid <> t.b) then return 'none'; end if;
  v_o := case when t.a = p_uid then t.b else t.a end;
  if public.olnu_dm_blocked(p_uid, v_o) or not public.olnu_dm_friends(p_uid, v_o) then return 'read'; end if;
  return 'write';
end; $function$;
