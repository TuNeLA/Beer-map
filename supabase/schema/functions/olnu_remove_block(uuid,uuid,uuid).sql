-- public.olnu_remove_block(p_group uuid, p_actor uuid, p_target uuid)
-- live md5(pg_get_functiondef) = 36023761cf83626334e1c94defadceaa
CREATE OR REPLACE FUNCTION public.olnu_remove_block(p_group uuid, p_actor uuid, p_target uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid := (select g.created_by from public.groups g where g.id = p_group);
  v_chief uuid := public.olnu_chief_of(p_group);
begin
  if p_actor is null or not public.olnu_chief_member(p_group, p_actor) then return 'not_member'; end if;
  if p_target is null or not public.olnu_chief_member(p_group, p_target) then return 'not_member'; end if;
  if p_target = p_actor then return 'cannot_remove_self'; end if;
  if v_owner is not null and p_target = v_owner then return 'cannot_remove_creator'; end if;
  if public.olnu_owner_powers(p_group, p_actor) then return null; end if;
  if p_actor = v_chief or public.olnu_is_vice(p_group, p_actor) then
    if p_target = v_chief or public.olnu_is_vice(p_group, p_target) then return 'not_allowed'; end if;
    return null;
  end if;
  return 'not_allowed';
end; $function$;
