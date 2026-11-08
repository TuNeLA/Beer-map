-- public.find_answer(p_id bigint, p_accept boolean)
-- live md5(pg_get_functiondef) = 974a0564562fb9f1272c39eee231e0ef
CREATE OR REPLACE FUNCTION public.find_answer(p_id bigint, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  r public.find_reqs;
begin
  select * into r from public.find_reqs x where x.id = p_id and x.to_uid = v_uid for update;
  if r.id is null or r.status <> 'pending' or r.answer_by <= now() then raise exception 'find_req_not_found'; end if;
  if coalesce(p_accept, false) then
    update public.find_reqs x set status = 'accepted', answered_at = now(),
           until = least(now() + interval '30 minutes', public.olnu_next_expiry())
     where x.id = r.id returning * into r;
  else
    update public.find_reqs x set status = 'declined', answered_at = now() where x.id = r.id returning * into r;
  end if;
  return public.olnu_find_req_json(r, v_uid);
end; $function$;
