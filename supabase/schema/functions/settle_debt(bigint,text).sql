-- public.settle_debt(p_debt_id bigint, p_action text)
-- live md5(pg_get_functiondef) = f517adbab7c8cbac372ceded1d6eb897
CREATE OR REPLACE FUNCTION public.settle_debt(p_debt_id bigint, p_action text DEFAULT 'paid'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(btrim(coalesce(p_action, '')));
  d public.gang_debts;
begin
  if v_a not in ('paid', 'unpaid', 'cancel') then raise exception 'invalid_action'; end if;
  select * into d from public.gang_debts x where x.id = p_debt_id and x.cancelled_at is null;
  if not found or not public.olnu_gang_member(d.group_id, v_uid) then raise exception 'debt_not_found'; end if;
  if v_a = 'cancel' then
    if v_uid not in (d.created_by, d.creditor) then raise exception 'not_yours'; end if;
    update public.gang_debts x set cancelled_at = now(), cancelled_by = v_uid where x.id = d.id;
  elsif v_a = 'paid' then
    if v_uid not in (d.created_by, d.creditor, d.debtor) then raise exception 'not_yours'; end if;
    update public.gang_debts x set paid_at = coalesce(x.paid_at, now()), paid_by = coalesce(x.paid_by, v_uid) where x.id = d.id;
  else
    if v_uid not in (d.created_by, d.creditor, d.debtor) then raise exception 'not_yours'; end if;
    if d.paid_at is null or d.paid_at < now() - interval '1 day' then raise exception 'too_late'; end if;
    update public.gang_debts x set paid_at = null, paid_by = null where x.id = d.id;
  end if;
  return jsonb_build_object('ok', true);
end; $function$;
