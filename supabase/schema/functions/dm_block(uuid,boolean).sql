-- public.dm_block(p_group_id uuid, p_on boolean)
-- live md5(pg_get_functiondef) = eed6373e0678a6bfdb4da5b94e362728
CREATE OR REPLACE FUNCTION public.dm_block(p_group_id uuid, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_o uuid := public.olnu_dm_other(p_group_id, v_uid);
begin
  if v_o is null then raise exception 'not_member'; end if;
  if (select count(*) from public.dm_blocks k where k.blocker = v_uid and k.updated_at > now() - interval '1 minute') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into public.dm_blocks as k (blocker, blocked, active) values (v_uid, v_o, coalesce(p_on, true))
  on conflict (blocker, blocked) do update set active = coalesce(p_on, true), updated_at = now();
  return public.olnu_dm_json(p_group_id, v_uid);
end; $function$;
