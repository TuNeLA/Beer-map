-- public.group_rallies(p_group_id uuid)
-- live md5(pg_get_functiondef) = 60f9f3ee998f561de91196e42ac8a568
CREATE OR REPLACE FUNCTION public.group_rallies(p_group_id uuid)
 RETURNS TABLE(id bigint, name text, body text, place text, lat double precision, lng double precision, created_at timestamp with time zone, yes integer, no integer, maybe integer, my_answer text, yes_names text[], is_mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select r.id, r.name, r.body, r.place, r.lat, r.lng, r.created_at, r.yes, r.no, r.maybe,
         r.my_answer, r.yes_names, r.is_mine
    from public.olnu_rally_rows(v_uid, p_group_id) r;
end; $function$;
COMMENT ON FUNCTION public.group_rallies(p_group_id uuid) IS 'DEPRECATED 2026-11-07: no caller in the app any more (old clients only). Drop after 30 days with 0 calls.';
