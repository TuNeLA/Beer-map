-- public.ikvall_prompt_set(p_on boolean)
-- live md5(pg_get_functiondef) = aa670844ad06074f6f3b3eeef91f844c
CREATE OR REPLACE FUNCTION public.ikvall_prompt_set(p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.ikvall_prompt p where p.user_id = v_uid and p.updated_at > now() - interval '1 second') then
    raise exception 'slow_down';
  end if;
  insert into public.ikvall_prompt (user_id, enabled, updated_at) values (v_uid, coalesce(p_on, false), now())
  on conflict (user_id) do update set enabled = excluded.enabled, updated_at = now();
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, false));
end $function$;
