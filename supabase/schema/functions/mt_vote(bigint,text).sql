-- public.mt_vote(p_round_id bigint, p_member text)
-- live md5(pg_get_functiondef) = 531ce52e775116aebc58af585ff229dd
CREATE OR REPLACE FUNCTION public.mt_vote(p_round_id bigint, p_member text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  r public.gang_mt_rounds;
  v_t uuid;
begin
  select * into r from public.gang_mt_rounds x where x.id = p_round_id;
  if not found or not public.olnu_gang_member(r.group_id, v_uid) then raise exception 'round_not_found'; end if;
  if public.olnu_gang_mt_done(r) then raise exception 'round_done'; end if;
  v_t := public.olnu_gang_uid_of(r.group_id, p_member);
  if v_t is null then raise exception 'invalid_member'; end if;
  insert into public.gang_mt_votes (round_id, voter, target) values (r.id, v_uid, v_t)
  on conflict (round_id, voter) do update set target = excluded.target, updated_at = now();
  return public.olnu_gang_mt_json(r, v_uid);
end; $function$;
