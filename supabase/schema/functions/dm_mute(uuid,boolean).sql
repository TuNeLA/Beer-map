-- public.dm_mute(p_group_id uuid, p_on boolean)
-- live md5(pg_get_functiondef) = e70d15271176e6b334f9bfea7cf71d48
CREATE OR REPLACE FUNCTION public.dm_mute(p_group_id uuid, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if public.olnu_dm_other(p_group_id, v_uid) is null then raise exception 'not_member'; end if;
  insert into public.dm_state as s (group_id, user_id, muted) values (p_group_id, v_uid, coalesce(p_on, true))
  on conflict (group_id, user_id) do update set muted = coalesce(p_on, true), updated_at = now();
  return public.olnu_dm_json(p_group_id, v_uid);
end; $function$;
