-- public.olnu_skal_insert(p_group uuid, p_starter uuid, p_fired_by uuid, p_auto boolean)
-- live md5(pg_get_functiondef) = b18011ff1f294c0aba7d04c3a0644b5b
CREATE OR REPLACE FUNCTION public.olnu_skal_insert(p_group uuid, p_starter uuid, p_fired_by uuid, p_auto boolean)
 RETURNS skal_hours
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  h public.skal_hours;
begin
  if exists (select 1 from public.skal_hours x where x.group_id = p_group and x.created_at > now() - interval '30 minutes') then
    return null;
  end if;
  if (select count(*) from public.skal_hours x where x.group_id = p_group and x.created_at >= public.olnu_skal_from()) >= 4 then
    return null;
  end if;
  insert into public.skal_hours (group_id, started_by, fired_by, auto, night, created_at, ends_at)
  values (p_group, p_starter, p_fired_by, p_auto, public.olnu_night_of(now()), now(), now() + interval '3 minutes')
  returning * into h;
  return h;
end; $function$;
