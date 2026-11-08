-- public.my_eta()
-- live md5(pg_get_functiondef) = b40bcd66f9cb6de201f382fced31fc8a
CREATE OR REPLACE FUNCTION public.my_eta()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  e public.etas;
begin
  select * into e from public.etas x
   where x.user_id = v_uid and x.expires_at > now() and x.cancelled_at is null
     and (public.olnu_eta_live(x) or (x.arrived_at > now() - interval '15 minutes' and public.olnu_eta_rally_ok(x)))
   order by x.created_at desc limit 1;
  if not found then return jsonb_build_object('active', false); end if;
  return public.olnu_eta_json(e);
end; $function$;
COMMENT ON FUNCTION public.my_eta() IS 'DEPRECATED 2026-11-07: no caller in the app any more (old clients only). Drop after 30 days with 0 calls.';
