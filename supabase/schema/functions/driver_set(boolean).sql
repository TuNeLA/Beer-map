-- public.driver_set(p_on boolean)
-- live md5(pg_get_functiondef) = d6e82c103f9b32735182554ebe8732c6
CREATE OR REPLACE FUNCTION public.driver_set(p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz := public.olnu_night_of(now());
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-driver:' || v_uid::text, 0));
  if exists (select 1 from public.driver_status d where d.user_id = v_uid and d.updated_at > now() - interval '1 second') then
    raise exception 'slow_down';
  end if;
  if coalesce(p_on, false) then
    insert into public.driver_status (user_id, night, updated_at) values (v_uid, v_night, now())
    on conflict (user_id) do update set night = excluded.night, updated_at = now();
  else
    update public.driver_status set night = v_night - interval '1 day', updated_at = now() where user_id = v_uid;
  end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, false));
end; $function$;
