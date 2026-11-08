-- public.owner_trust_me(p_key text, p_on boolean)
-- live md5(pg_get_functiondef) = 0b6a6016a20f6a188cafd5da3078e058
CREATE OR REPLACE FUNCTION public.owner_trust_me(p_key text, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_n int := 0; r record;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  insert into public.bar_area_trusted (user_id, active) values (v_uid, coalesce(p_on, true))
  on conflict (user_id) do update set active = excluded.active, updated_at = now();
  if coalesce(p_on, true) then
    for r in select x.id, x.bar_id from public.bar_areas x
              where x.created_by = v_uid and x.status = 'pending' and x.superseded_at is null order by x.id loop
      update public.bar_areas x set status = 'ok', auto = true, status_at = now() where x.id = r.id;
      perform public.olnu_area_supersede(r.bar_id, r.id);
      v_n := v_n + 1;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'trusted', coalesce(p_on, true), 'approved', v_n);
end; $function$;
