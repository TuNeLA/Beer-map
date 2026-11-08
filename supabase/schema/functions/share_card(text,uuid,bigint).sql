-- public.share_card(p_kind text, p_group_id uuid, p_ref bigint)
-- live md5(pg_get_functiondef) = 2318eec6869b7df05d267725bbfb1ec0
CREATE OR REPLACE FUNCTION public.share_card(p_kind text, p_group_id uuid, p_ref bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_exp timestamptz;
  v_ref bigint := null;
  c public.share_cards;
  i int := 0;
begin
  if v_kind not in ('group', 'rally', 'duel', 'paper') then raise exception 'bad_kind'; end if;
  if p_group_id is null or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_kind = 'rally' then
    select r.id, r.expires_at + interval '12 hours' into v_ref, v_exp
      from public.rallies r where r.id = p_ref and r.group_id = p_group_id;
    if v_ref is null then raise exception 'not_found'; end if;
  elsif v_kind = 'duel' then
    select d.id, d.ends_at + interval '1 day' into v_ref, v_exp
      from public.duels d where d.id = p_ref and (d.group_a = p_group_id or d.group_b = p_group_id)
       and d.status in ('pending', 'active');
    if v_ref is null then raise exception 'not_found'; end if;
  elsif v_kind = 'paper' then
    v_exp := now() + interval '3 days';
  else
    v_exp := now() + interval '30 days';
  end if;
  select * into c from public.share_cards s
   where s.kind = v_kind and s.group_id = p_group_id and s.ref_id is not distinct from v_ref and s.user_id = v_uid
     and s.expires_at > now() + interval '1 hour'
   order by s.expires_at desc limit 1;
  if found then
    return jsonb_build_object('token', c.token, 'expires_at', c.expires_at, 'kind', c.kind);
  end if;
  if (select count(*) from public.share_cards s where s.user_id = v_uid and s.created_at > now() - interval '1 hour') >= 40 then
    raise exception 'slow_down';
  end if;
  loop
    i := i + 1;
    begin
      insert into public.share_cards (token, kind, group_id, ref_id, user_id, expires_at)
      values (public.olnu_card_token(), v_kind, p_group_id, v_ref, v_uid, v_exp)
      returning * into c;
      exit;
    exception when unique_violation then
      if i >= 5 then raise exception 'code_generation_failed'; end if;
    end;
  end loop;
  return jsonb_build_object('token', c.token, 'expires_at', c.expires_at, 'kind', c.kind);
end; $function$;
