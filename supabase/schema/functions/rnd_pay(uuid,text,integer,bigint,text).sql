-- public.rnd_pay(p_group_id uuid, p_to text, p_amount integer, p_expense_id bigint, p_from text)
-- live md5(pg_get_functiondef) = 24767dbafcea96664fefa3ca70e18f48
CREATE OR REPLACE FUNCTION public.rnd_pay(p_group_id uuid, p_to text, p_amount integer, p_expense_id bigint DEFAULT NULL::bigint, p_from text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_to uuid; v_from uuid; v_id bigint;
begin
  if not public.olnu_rnd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  v_to := public.olnu_rnd_uid_of(p_group_id, p_to);
  if v_to is null then raise exception 'invalid_member'; end if;
  if coalesce(p_from, '') = '' then v_from := v_uid;
  else v_from := public.olnu_rnd_uid_of(p_group_id, p_from);
       if v_from is null then raise exception 'invalid_member'; end if;
  end if;
  if v_from <> v_uid and v_to <> v_uid then raise exception 'not_yours'; end if;
  if v_from = v_to then raise exception 'invalid_amount'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 50000 then raise exception 'invalid_amount'; end if;
  if p_expense_id is not null and not exists (select 1 from public.rnd_expenses e
       where e.id = p_expense_id and e.group_id = p_group_id and e.cancelled_at is null) then
    raise exception 'expense_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_rnd_pay:' || v_uid::text, 0));
  if exists (select 1 from public.rnd_payments p where p.created_by = v_uid and p.created_at > now() - interval '2 seconds')
     or (select count(*) from public.rnd_payments p where p.created_by = v_uid and p.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'slow_down';
  end if;
  if p_expense_id is not null then
    select p.id into v_id from public.rnd_payments p
     where p.expense_id = p_expense_id and p.from_user = v_from and p.to_user = v_to and p.cancelled_at is null and p.rejected_at is null
     limit 1;
    if v_id is not null then return jsonb_build_object('id', v_id, 'again', true); end if;
  end if;
  insert into public.rnd_payments (group_id, from_user, to_user, amount, expense_id, created_by, confirmed_at)
  values (p_group_id, v_from, v_to, p_amount, p_expense_id, v_uid, case when v_to = v_uid then now() end)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end; $function$;
