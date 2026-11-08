-- public.olnu_rnd_exp_json(e rnd_expenses, p_uid uuid)
-- live md5(pg_get_functiondef) = 80d565703b4c4c09734456a28346ff50
CREATE OR REPLACE FUNCTION public.olnu_rnd_exp_json(e rnd_expenses, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', e.id, 'msg_id', e.msg_id, 'kind', e.kind, 'what', e.what, 'items', e.items, 'total', e.total,
    'equal_share', e.equal_share, 'created_at', e.created_at, 'night', e.night,
    'cancelled', e.cancelled_at is not null,
    'payer', public.olnu_rnd_k(e.group_id, e.payer), 'payer_name', public.olnu_rnd_name(e.group_id, e.payer),
    'payer_me', e.payer = p_uid, 'by_me', e.created_by = p_uid,
    'can_cancel', e.cancelled_at is null and (e.created_by = p_uid or e.payer = p_uid),
    'payer_swish', public.olnu_rnd_swish_of(e.group_id, e.payer),
    'shares', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_rnd_k(e.group_id, s.user_id), 'name', public.olnu_rnd_name(e.group_id, s.user_id),
        'is_me', s.user_id = p_uid, 'amount', s.amount,
        'paid', coalesce((select sum(p.amount) from public.rnd_payments p
                           where p.expense_id = e.id and p.from_user = s.user_id and p.to_user = e.payer
                             and p.cancelled_at is null and p.rejected_at is null), 0) >= s.amount,
        'confirmed', exists (select 1 from public.rnd_payments p
                              where p.expense_id = e.id and p.from_user = s.user_id and p.to_user = e.payer
                                and p.cancelled_at is null and p.rejected_at is null and p.confirmed_at is not null),
        'pay_id', (select max(p.id) from public.rnd_payments p
                    where p.expense_id = e.id and p.from_user = s.user_id and p.to_user = e.payer
                      and p.cancelled_at is null and p.rejected_at is null))
      order by s.amount desc, public.olnu_rnd_name(e.group_id, s.user_id))
      from public.rnd_shares s where s.expense_id = e.id), '[]'::jsonb));
$function$;
