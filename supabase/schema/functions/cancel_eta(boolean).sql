-- public.cancel_eta(p_arrived boolean)
-- live md5(pg_get_functiondef) = b5eb83a97307437a563365dd2fa4da4d
CREATE OR REPLACE FUNCTION public.cancel_eta(p_arrived boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_id  bigint;
begin
  update public.etas x
     set cancelled_at = case when coalesce(p_arrived, false) then x.cancelled_at else now() end,
         arrived_at   = case when coalesce(p_arrived, false) then now() else x.arrived_at end
   where x.id = (select y.id from public.etas y
                  where y.user_id = v_uid and y.cancelled_at is null and y.arrived_at is null and y.expires_at > now()
                  order by y.created_at desc limit 1)
  returning x.id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'no_eta'); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'arrived', coalesce(p_arrived, false));
end; $function$;
