-- public.crew_dates_vote(p_poll_id bigint, p_date date, p_answer text)
-- live md5(pg_get_functiondef) = d60459ad757ea38aa2d492fc28c94874
CREATE OR REPLACE FUNCTION public.crew_dates_vote(p_poll_id bigint, p_date date, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_answer, '')));
  p public.crew_date_polls;
begin
  if v_a not in ('kan', 'kanske', 'nej') then raise exception 'invalid_answer'; end if;
  select * into p from public.crew_date_polls x where x.id = p_poll_id and x.closed_at is null and x.ends_at > now();
  if not found then raise exception 'poll_not_found'; end if;
  if not public.olnu_crew_member(p.group_id, v_uid) then raise exception 'not_member'; end if;
  if p_date is null or not (p_date = any (p.dates)) then raise exception 'invalid_dates'; end if;
  insert into public.crew_date_votes (poll_id, user_id, d, answer) values (p.id, v_uid, p_date, v_a)
  on conflict (poll_id, user_id, d) do update set answer = excluded.answer, updated_at = now();
  return jsonb_build_object('ok', true, 'd', p_date, 'answer', v_a);
end; $function$;
