-- public.find_cancel(p_id bigint)
-- live md5(pg_get_functiondef) = 0f6b74620109bea88c9d83f5fe7c0f4b
CREATE OR REPLACE FUNCTION public.find_cancel(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  r public.find_reqs;
begin
  select * into r from public.find_reqs x where x.id = p_id and (x.from_uid = v_uid or x.to_uid = v_uid) for update;
  if r.id is null then raise exception 'find_req_not_found'; end if;
  if r.status in ('pending', 'accepted', 'auto') then
    update public.find_reqs x set status = 'cancelled', until = least(coalesce(x.until, now()), now()), answered_at = coalesce(x.answered_at, now())
     where x.id = r.id;
  end if;
  return jsonb_build_object('ok', true);
end; $function$;
COMMENT ON FUNCTION public.find_cancel(p_id bigint) IS 'DEPRECATED 2026-11-07: no caller in the app any more (old clients only). Drop after 30 days with 0 calls.';
