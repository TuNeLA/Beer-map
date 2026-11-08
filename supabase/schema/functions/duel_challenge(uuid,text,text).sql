-- public.duel_challenge(p_group_id uuid, p_code text, p_handle text)
-- live md5(pg_get_functiondef) = 28c98463f9b9a933a42575447a710c99
CREATE OR REPLACE FUNCTION public.duel_challenge(p_group_id uuid, p_code text DEFAULT NULL::text, p_handle text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_other uuid;
  v_via text;
  v_id bigint;
begin
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if nullif(btrim(coalesce(p_code, '')), '') is not null then
    select g.id into v_other from public.groups g where g.code = upper(btrim(p_code));
    v_via := 'code';
  elsif nullif(btrim(coalesce(p_handle, '')), '') is not null then
    select o.group_id into v_other from public.duel_open o
     where o.open and public.olnu_duel_handle(o.group_id) = btrim(p_handle) limit 1;
    v_via := 'near';
  end if;
  if v_other is null then raise exception 'group_not_found'; end if;
  if v_other = p_group_id then raise exception 'same_group'; end if;
  perform public.olnu_wd_rl('pair:' || least(p_group_id::text, v_other::text) || greatest(p_group_id::text, v_other::text));
  if public.olnu_duel_pair(p_group_id, v_other) is not null then raise exception 'already_dueling'; end if;
  if public.olnu_duel_open_n(p_group_id) >= 10 or public.olnu_duel_open_n(v_other) >= 10 then raise exception 'too_many_duels'; end if;
  if exists (select 1 from public.duels d where d.created_by = v_uid and d.created_at > now() - interval '20 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.duels (group_a, group_b, created_by, via, status, answer_by, ends_at)
  values (p_group_id, v_other, v_uid, v_via, 'pending',
          least(now() + interval '30 minutes', public.olnu_night_of(now())), public.olnu_night_of(now()))
  returning id into v_id;
  return public.olnu_duel_json(v_id, v_uid);
end; $function$;
