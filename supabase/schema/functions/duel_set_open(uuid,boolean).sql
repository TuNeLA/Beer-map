-- public.duel_set_open(p_group_id uuid, p_on boolean)
-- live md5(pg_get_functiondef) = fc83a2563289d367ea410126e2265453
CREATE OR REPLACE FUNCTION public.duel_set_open(p_group_id uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  insert into public.duel_open (group_id, open, changed_by, changed_at) values (p_group_id, coalesce(p_on, false), v_uid, now())
  on conflict (group_id) do update set open = excluded.open, changed_by = v_uid, changed_at = now();
  return jsonb_build_object('open', coalesce(p_on, false));
end; $function$;
