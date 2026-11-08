-- public.rnd_payment(p_payment_id bigint, p_action text)
-- live md5(pg_get_functiondef) = 77c821cbd30537f6bf4f9af97a9c1217
CREATE OR REPLACE FUNCTION public.rnd_payment(p_payment_id bigint, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  p public.rnd_payments;
begin
  select * into p from public.rnd_payments x where x.id = p_payment_id and x.cancelled_at is null for update;
  if not found or not public.olnu_rnd_member(p.group_id, v_uid) then raise exception 'payment_not_found'; end if;
  if p_action = 'confirm' then
    if p.to_user <> v_uid then raise exception 'not_yours'; end if;
    update public.rnd_payments x set confirmed_at = coalesce(x.confirmed_at, now()), rejected_at = null where x.id = p.id;
  elsif p_action = 'reject' then
    if p.to_user <> v_uid then raise exception 'not_yours'; end if;
    if p.confirmed_at is not null and p.confirmed_at < now() - interval '24 hours' then raise exception 'too_late'; end if;
    update public.rnd_payments x set rejected_at = now(), confirmed_at = null where x.id = p.id;
  elsif p_action = 'undo' then
    if p.created_by <> v_uid then raise exception 'not_yours'; end if;
    if p.created_at < now() - interval '24 hours' or (p.confirmed_at is not null and p.to_user <> v_uid) then raise exception 'too_late'; end if;
    update public.rnd_payments x set cancelled_at = now() where x.id = p.id;
  else
    raise exception 'invalid_action';
  end if;
  return jsonb_build_object('ok', true);
end; $function$;
