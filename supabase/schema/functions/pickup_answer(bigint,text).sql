-- public.pickup_answer(p_id bigint, p_ans text)
-- live md5(pg_get_functiondef) = 40d58d1fbbf6d50a69cd63eec4ca7ec8
CREATE OR REPLACE FUNCTION public.pickup_answer(p_id bigint, p_ans text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs; v_ans text := lower(trim(coalesce(p_ans, '')));
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_ans not in ('kommer', 'kan_inte') then raise exception 'invalid_answer'; end if;
  perform public.olnu_pickup_sweep();
  select * into r from public.pickup_reqs x where x.id = p_id and v_uid = any (x.to_users);
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is not null then raise exception 'ended'; end if;
  if exists (select 1 from public.pickup_answers a where a.req_id = p_id and a.user_id = v_uid and a.at > now() - interval '2 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.pickup_answers (req_id, user_id, ans, at) values (p_id, v_uid, v_ans, now())
  on conflict (req_id, user_id) do update set ans = excluded.ans, at = now(),
    notified = case when public.pickup_answers.ans = excluded.ans then public.pickup_answers.notified else false end;
  return jsonb_build_object('ok', true, 'ans', v_ans);
end; $function$;
