-- public.set_group_keep_history(p_group_id uuid, p_on boolean)
-- live md5(pg_get_functiondef) = 21d74e1aaa1e50a5132761c1621f9a93
CREATE OR REPLACE FUNCTION public.set_group_keep_history(p_group_id uuid, p_on boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_creator uuid; v_on boolean := coalesce(p_on, false);
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select g.created_by into v_creator from public.groups g where g.id = p_group_id;
  if v_creator is not null and v_creator <> v_uid
     and exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_creator) then
    raise exception 'not_admin';
  end if;
  insert into public.group_settings as s (group_id, keep_history, changed_by, changed_at)
  values (p_group_id, v_on, v_uid, now())
  on conflict (group_id) do update set keep_history = v_on, changed_by = v_uid, changed_at = now();
  if v_on then
    update public.group_msgs set expires_at = 'infinity' where group_id = p_group_id and expires_at > now();
    update public.voice_msgs set expires_at = 'infinity' where group_id = p_group_id and expires_at > now();
  else
    update public.group_msgs set expires_at = public.olnu_next_expiry() where group_id = p_group_id and expires_at = 'infinity';
    update public.voice_msgs set expires_at = public.olnu_next_expiry() where group_id = p_group_id and expires_at = 'infinity';
  end if;
  return v_on;
end; $function$;
