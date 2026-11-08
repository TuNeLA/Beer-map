-- public.answer_brunch(p_brunch_id bigint, p_answer text)
-- live md5(pg_get_functiondef) = 34628acf4d874e318aaaa74c863b93a6
CREATE OR REPLACE FUNCTION public.answer_brunch(p_brunch_id bigint, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_answer, '')));
  b public.gang_brunches;
begin
  if v_a not in ('ja', 'kanske', 'nej') then raise exception 'invalid_answer'; end if;
  select * into b from public.gang_brunches x where x.id = p_brunch_id and not x.closed and x.expires_at > now();
  if not found or not public.olnu_gang_member(b.group_id, v_uid) then raise exception 'brunch_not_found'; end if;
  insert into public.gang_brunch_answers (brunch_id, user_id, answer) values (b.id, v_uid, v_a)
  on conflict (brunch_id, user_id) do update set answer = excluded.answer, updated_at = now();
  return public.olnu_gang_brunch_json(b, v_uid);
end; $function$;
