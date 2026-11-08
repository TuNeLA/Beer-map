-- public.rnd_add(p_group_id uuid, p_kind text, p_payer text, p_total integer, p_shares jsonb, p_items integer, p_what text)
-- live md5(pg_get_functiondef) = ac82e928c0dc6e8dbf364cafe36bebe2
CREATE OR REPLACE FUNCTION public.rnd_add(p_group_id uuid, p_kind text, p_payer text, p_total integer, p_shares jsonb, p_items integer DEFAULT 0, p_what text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_payer uuid;
  v_kind text := coalesce(p_kind, 'round');
  v_what text := left(public.olnu_rnd_clean(p_what), 40);
  v_items int := greatest(0, least(99, coalesce(p_items, 0)));
  v_sum int := 0; v_n int := 0; v_eq int := null; v_first int := null; v_same boolean := true;
  x jsonb; v_t uuid; v_a int; v_seen uuid[] := '{}';
  v_id bigint; v_msg bigint; v_name text; v_body text; v_amt text;
begin
  if not public.olnu_rnd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_kind not in ('round', 'taxi', 'other') then raise exception 'invalid_split'; end if;
  if coalesce(p_payer, '') = '' then v_payer := v_uid;
  else v_payer := public.olnu_rnd_uid_of(p_group_id, p_payer);
       if v_payer is null then raise exception 'invalid_member'; end if;
  end if;
  if p_total is null or p_total < 1 or p_total > 50000 then raise exception 'invalid_split'; end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) < 1 or jsonb_array_length(p_shares) > 20 then
    raise exception 'invalid_split';
  end if;
  for x in select * from jsonb_array_elements(p_shares) loop
    v_t := public.olnu_rnd_uid_of(p_group_id, x->>'k');
    begin v_a := (x->>'amount')::int; exception when others then v_a := null; end;
    if v_t is null then raise exception 'invalid_member'; end if;
    if v_t = v_payer or v_t = any(v_seen) or v_a is null or v_a < 1 or v_a > 50000 then raise exception 'invalid_split'; end if;
    v_seen := v_seen || v_t; v_sum := v_sum + v_a; v_n := v_n + 1;
    if v_first is null then v_first := v_a; elsif v_first <> v_a then v_same := false; end if;
  end loop;
  if v_sum > p_total then raise exception 'invalid_split'; end if;
  if v_same then v_eq := v_first; end if;
  if v_what = '' then v_what := case v_kind when 'round' then 'Rundan' when 'taxi' then 'Taxin' else 'Notan' end; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_rnd:' || v_uid::text, 0));
  if exists (select 1 from public.rnd_expenses e where e.created_by = v_uid and e.created_at > now() - interval '5 seconds')
     or (select count(*) from public.rnd_expenses e where e.created_by = v_uid and e.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'slow_down';
  end if;
  v_name := public.olnu_rnd_name(p_group_id, v_payer);
  v_amt := case when v_eq is not null then v_eq::text || ' kr var' else p_total::text || ' kr' end;
  v_body := case v_kind
    when 'round' then '💸 ' || v_name || ' bjöd på ' || case when v_items > 0 then v_items::text || ' öl' else lower(v_what) end || ' · ' || v_amt
    when 'taxi'  then '🚕 ' || v_name || ' tog taxin · ' || v_amt
    else '🧾 ' || v_name || ' betalade ' || v_what || ' · ' || v_amt end;
  v_body := left(v_body, 140);
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_body, public.olnu_next_expiry()) returning id into v_msg;
  insert into public.rnd_expenses (group_id, created_by, payer, kind, what, items, total, equal_share, msg_id, night)
  values (p_group_id, v_uid, v_payer, v_kind, v_what, v_items, p_total, v_eq, v_msg, public.olnu_night_of(now()))
  returning id into v_id;
  for x in select * from jsonb_array_elements(p_shares) loop
    insert into public.rnd_shares (expense_id, user_id, amount)
    values (v_id, public.olnu_rnd_uid_of(p_group_id, x->>'k'), (x->>'amount')::int);
  end loop;
  return jsonb_build_object('id', v_id, 'msg_id', v_msg, 'body', v_body, 'equal_share', v_eq);
end; $function$;
