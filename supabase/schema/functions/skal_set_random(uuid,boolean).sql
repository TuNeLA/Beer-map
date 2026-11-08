-- public.skal_set_random(p_group_id uuid, p_on boolean)
-- live md5(pg_get_functiondef) = 20884cafce252db37fe5a470e7ef3aa8
CREATE OR REPLACE FUNCTION public.skal_set_random(p_group_id uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if not public.olnu_skal_can(p_group_id, v_uid) then raise exception 'not_allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_skal_set:' || p_group_id::text, 0));
  if exists (select 1 from public.skal_settings s where s.group_id = p_group_id and s.changed_at > now() - interval '3 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.skal_settings as s (group_id, random_on, changed_by, changed_at)
  values (p_group_id, coalesce(p_on, false), v_uid, now())
  on conflict (group_id) do update set random_on = coalesce(p_on, false), changed_by = v_uid, changed_at = now();
  return public.olnu_skal_state_json(p_group_id, v_uid);
end; $function$;
