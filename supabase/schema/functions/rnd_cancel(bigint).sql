-- public.rnd_cancel(p_expense_id bigint)
-- live md5(pg_get_functiondef) = 66e34d278ca48c7271136e85a75b770c
CREATE OR REPLACE FUNCTION public.rnd_cancel(p_expense_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  e public.rnd_expenses;
begin
  select * into e from public.rnd_expenses x where x.id = p_expense_id for update;
  if not found or not public.olnu_rnd_member(e.group_id, v_uid) then raise exception 'expense_not_found'; end if;
  if e.created_by <> v_uid and e.payer <> v_uid then raise exception 'not_yours'; end if;
  if e.cancelled_at is null then
    update public.rnd_expenses x set cancelled_at = now(), cancelled_by = v_uid where x.id = e.id;
    -- Payments already made stay: money that moved still counts in the balance.
  end if;
  return jsonb_build_object('ok', true);
end; $function$;
