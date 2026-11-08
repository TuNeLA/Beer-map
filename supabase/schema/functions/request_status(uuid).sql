-- public.request_status(p_group_id uuid)
-- live md5(pg_get_functiondef) = 18e079a40e592b3fd5d9e5e82d85d0bf
CREATE OR REPLACE FUNCTION public.request_status(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  r public.status_reqs;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_status:' || p_group_id::text, 0));
  if public.olnu_chief_of(p_group_id) is distinct from v_uid and not public.olnu_is_vice(p_group_id, v_uid) then
    raise exception 'not_chief';
  end if;
  if exists (select 1 from public.status_reqs x where x.group_id = p_group_id and x.created_at > now() - interval '20 minutes') then
    raise exception 'status_slow';
  end if;
  if (select count(*) from public.status_reqs x where x.group_id = p_group_id and x.created_at >= public.olnu_chief_from()) >= 6 then
    raise exception 'status_limit';
  end if;
  insert into public.status_reqs (group_id, user_id, night, created_at, ends_at)
  values (p_group_id, v_uid, public.olnu_night_of(now()), now(), now() + interval '10 minutes')
  returning * into r;
  return public.olnu_status_json(r, v_uid);
end; $function$;
