-- public.ceremony_group(p_group_id uuid)
-- live md5(pg_get_functiondef) = b9779efe85a119170e6f1f9b4a3480a8
CREATE OR REPLACE FUNCTION public.ceremony_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return public.olnu_cer_json(p_group_id, v_uid, true);
end;
$function$;
