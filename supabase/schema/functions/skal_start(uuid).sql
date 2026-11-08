-- public.skal_start(p_group_id uuid)
-- live md5(pg_get_functiondef) = e0f0d7d855ac9a276b7bd91205b65fb7
CREATE OR REPLACE FUNCTION public.skal_start(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  h public.skal_hours;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if not public.olnu_skal_can(p_group_id, v_uid) then raise exception 'not_allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_skal:' || p_group_id::text, 0));
  if (select count(*) from public.skal_hours x where x.group_id = p_group_id and x.created_at >= public.olnu_skal_from()) >= 4 then
    raise exception 'skal_limit';
  end if;
  if exists (select 1 from public.skal_hours x where x.group_id = p_group_id and x.created_at > now() - interval '30 minutes') then
    raise exception 'skal_slow';
  end if;
  h := public.olnu_skal_insert(p_group_id, v_uid, v_uid, false);
  if h.id is null then raise exception 'skal_slow'; end if;
  return public.olnu_skal_json(h, v_uid);
end; $function$;
