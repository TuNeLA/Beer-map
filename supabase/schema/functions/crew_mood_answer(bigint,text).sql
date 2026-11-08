-- public.crew_mood_answer(p_mood_id bigint, p_answer text)
-- live md5(pg_get_functiondef) = 9422da9dd6b0a742cfdc8ea3bc12155e
CREATE OR REPLACE FUNCTION public.crew_mood_answer(p_mood_id bigint, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_answer, '')));
  md public.crew_moods;
begin
  if v_a not in ('bra', 'snurr', 'hem') then raise exception 'invalid_answer'; end if;
  select * into md from public.crew_moods x where x.id = p_mood_id and x.ends_at > now();
  if not found then raise exception 'mood_not_found'; end if;
  if not public.olnu_crew_member(md.group_id, v_uid) then raise exception 'not_member'; end if;
  insert into public.crew_mood_answers (mood_id, user_id, answer) values (md.id, v_uid, v_a)
  on conflict (mood_id, user_id) do update set answer = excluded.answer, updated_at = now();
  return jsonb_build_object('ok', true, 'answer', v_a);
end; $function$;
