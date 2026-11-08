-- public.duel_accept_token(p_token text, p_group_id uuid)
-- live md5(pg_get_functiondef) = 2d8d58cf1a0f401de71f950dc3496dbb
CREATE OR REPLACE FUNCTION public.duel_accept_token(p_token text, p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  t public.duel_tokens;
  v_id bigint;
  d public.duels;
begin
  select * into t from public.duel_tokens x where x.token = upper(btrim(coalesce(p_token, ''))) and x.expires_at > now();
  if not found then raise exception 'token_not_found'; end if;
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_group_id = t.group_id then raise exception 'same_group'; end if;
  perform public.olnu_wd_rl('pair:' || least(p_group_id::text, t.group_id::text) || greatest(p_group_id::text, t.group_id::text));
  v_id := public.olnu_duel_pair(p_group_id, t.group_id);
  if v_id is not null then
    select * into d from public.duels x where x.id = v_id;
    if d.status = 'pending' then
      update public.duels x set status = 'active', accepted_at = now(), answered_by = v_uid where x.id = v_id;
      return public.olnu_duel_json(v_id, v_uid) || jsonb_build_object('already', false);
    end if;
    return public.olnu_duel_json(v_id, v_uid) || jsonb_build_object('already', true);
  end if;
  if public.olnu_duel_open_n(p_group_id) >= 10 or public.olnu_duel_open_n(t.group_id) >= 10 then raise exception 'too_many_duels'; end if;
  insert into public.duels (group_a, group_b, created_by, via, status, answer_by, answered_by, accepted_at, ends_at)
  values (t.group_id, p_group_id, t.user_id, 'qr', 'active', now(), v_uid, now(), public.olnu_night_of(now()))
  returning id into v_id;
  return public.olnu_duel_json(v_id, v_uid) || jsonb_build_object('already', false);
end; $function$;
