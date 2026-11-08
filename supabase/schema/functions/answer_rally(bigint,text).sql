-- public.answer_rally(p_rally_id bigint, p_answer text)
-- live md5(pg_get_functiondef) = 5a9160a17381801dd43bd2631529d39f
CREATE OR REPLACE FUNCTION public.answer_rally(p_rally_id bigint, p_answer text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_answer text := lower(btrim(coalesce(p_answer, '')));
  v_gid uuid; v_y int; v_n int; v_m int;
begin
  if v_answer not in ('yes', 'no', 'maybe') then raise exception 'invalid_answer'; end if;
  select r.group_id into v_gid from public.rallies r where r.id = p_rally_id and r.expires_at > now() and not r.closed;
  if not found then raise exception 'rally_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  insert into public.rally_answers (rally_id, user_id, answer) values (p_rally_id, v_uid, v_answer)
  on conflict (rally_id, user_id) do update set answer = excluded.answer, updated_at = now();
  select count(*) filter (where a.answer = 'yes')::int, count(*) filter (where a.answer = 'no')::int,
         count(*) filter (where a.answer = 'maybe')::int
    into v_y, v_n, v_m
    from public.rally_answers a
    join public.group_members gm on gm.group_id = v_gid and gm.user_id = a.user_id
   where a.rally_id = p_rally_id;
  return json_build_object('yes', v_y, 'no', v_n, 'maybe', v_m, 'mine', v_answer);
end; $function$;
