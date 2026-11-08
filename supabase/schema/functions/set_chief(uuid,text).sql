-- public.set_chief(p_group_id uuid, p_k text)
-- live md5(pg_get_functiondef) = 4f690d0d23f5cf101486b90f0e226ce3
CREATE OR REPLACE FUNCTION public.set_chief(p_group_id uuid, p_k text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_new uuid;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_chief:' || p_group_id::text, 0));
  if not public.olnu_owner_powers(p_group_id, v_uid) then raise exception 'not_allowed'; end if;
  select m.user_id into v_new from public.group_members m
   where m.group_id = p_group_id and public.olnu_chief_k(p_group_id, m.user_id) = p_k limit 1;
  if v_new is null then raise exception 'invalid_member'; end if;
  insert into public.group_chiefs (group_id, user_id, set_by, updated_at)
  values (p_group_id, v_new, v_uid, now())
  on conflict (group_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, updated_at = now();
  -- The new chief is no longer a vice.
  update public.group_vices v set active = false, updated_at = now(), set_by = v_uid
   where v.group_id = p_group_id and v.user_id = v_new and v.active;
  return public.olnu_chief_json(p_group_id, v_uid);
end; $function$;
