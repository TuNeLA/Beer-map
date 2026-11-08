-- public.skal_hour(p_hour_id bigint)
-- live md5(pg_get_functiondef) = ecfb502e59d0fb815b2461cf6dadb705
CREATE OR REPLACE FUNCTION public.skal_hour(p_hour_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  h public.skal_hours;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into h from public.skal_hours x where x.id = p_hour_id and x.created_at > now() - interval '12 hours';
  if not found then raise exception 'skal_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = h.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return public.olnu_skal_json(h, v_uid);
end; $function$;
