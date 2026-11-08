-- public.skal_state(p_group_id uuid)
-- live md5(pg_get_functiondef) = 86f6d792f0af1e461f99e649ab3b2780
CREATE OR REPLACE FUNCTION public.skal_state(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return public.olnu_skal_state_json(p_group_id, v_uid);
end; $function$;
