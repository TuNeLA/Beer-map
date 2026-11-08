-- public.add_debt(p_group_id uuid, p_debtor text, p_creditor text, p_amount integer, p_what text)
-- live md5(pg_get_functiondef) = a84117286ecf939aa0a60184aedfe518
CREATE OR REPLACE FUNCTION public.add_debt(p_group_id uuid, p_debtor text, p_creditor text, p_amount integer, p_what text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_d uuid; v_c uuid;
  v_what text := left(public.olnu_gang_clean(p_what), 40);
  v_id bigint;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  v_d := public.olnu_gang_uid_of(p_group_id, p_debtor);
  v_c := public.olnu_gang_uid_of(p_group_id, p_creditor);
  if v_d is null or v_c is null or v_d = v_c or p_amount is null or p_amount < 1 or p_amount > 50000 or v_what = '' then
    raise exception 'invalid_debt';
  end if;
  perform public.olnu_gang_rl('debt:' || v_uid::text);
  if exists (select 1 from public.gang_debts d where d.created_by = v_uid and d.created_at > now() - interval '3 seconds')
     or (select count(*) from public.gang_debts d where d.created_by = v_uid and d.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'slow_down';
  end if;
  insert into public.gang_debts (group_id, created_by, debtor, creditor, amount, what)
  values (p_group_id, v_uid, v_d, v_c, p_amount, v_what) returning id into v_id;
  return jsonb_build_object('id', v_id);
end; $function$;
