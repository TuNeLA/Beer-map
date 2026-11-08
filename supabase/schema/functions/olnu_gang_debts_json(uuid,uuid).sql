-- public.olnu_gang_debts_json(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 408aaa4bb61fb69b21a5abdaf6595429
CREATE OR REPLACE FUNCTION public.olnu_gang_debts_json(p_group uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mem as (select m.user_id, m.display_name from public.group_members m where m.group_id = p_group),
  open as (
    select d.* from public.gang_debts d
     where d.group_id = p_group and d.paid_at is null and d.cancelled_at is null
       and d.debtor in (select user_id from mem) and d.creditor in (select user_id from mem)
  ),
  paid as (
    select d.* from public.gang_debts d
     where d.group_id = p_group and d.paid_at is not null and d.cancelled_at is null and d.paid_at > now() - interval '14 days'
     order by d.paid_at desc limit 10
  ),
  net as (
    select u.user_id, sum(u.amt)::int as net from (
      select o.creditor as user_id, o.amount as amt from open o
      union all select o.debtor, -o.amount from open o) u group by u.user_id
  )
  select jsonb_build_object(
    'open', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'amount', o.amount, 'what', o.what, 'created_at', o.created_at,
        'debtor', public.olnu_gang_k(p_group, o.debtor), 'debtor_name', public.olnu_gang_name(p_group, o.debtor),
        'creditor', public.olnu_gang_k(p_group, o.creditor), 'creditor_name', public.olnu_gang_name(p_group, o.creditor),
        'by', public.olnu_gang_name(p_group, o.created_by),
        'i_owe', o.debtor = p_uid, 'owed_me', o.creditor = p_uid,
        'can_cancel', o.created_by = p_uid or o.creditor = p_uid) order by o.id desc) from open o), '[]'::jsonb),
    'paid', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'amount', o.amount, 'what', o.what, 'paid_at', o.paid_at,
        'debtor_name', public.olnu_gang_name(p_group, o.debtor), 'creditor_name', public.olnu_gang_name(p_group, o.creditor),
        'can_undo', (o.debtor = p_uid or o.creditor = p_uid or o.created_by = p_uid) and o.paid_at > now() - interval '1 day')
        order by o.paid_at desc) from paid o), '[]'::jsonb),
    'net', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group, n.user_id),
        'name', public.olnu_gang_name(p_group, n.user_id), 'is_me', n.user_id = p_uid, 'net', n.net) order by n.net desc)
        from net n where n.net <> 0), '[]'::jsonb),
    'swish', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group, s.user_id),
        'name', public.olnu_gang_name(p_group, s.user_id), 'is_me', s.user_id = p_uid, 'number', s.number))
        from public.gang_swish s where s.group_id = p_group and s.number is not null
         and s.user_id in (select user_id from mem)), '[]'::jsonb));
$function$;
