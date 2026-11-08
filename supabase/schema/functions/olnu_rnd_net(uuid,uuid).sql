-- public.olnu_rnd_net(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 4a268c56231813ff04e07dc014105688
CREATE OR REPLACE FUNCTION public.olnu_rnd_net(p_group uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (
      coalesce((select sum(s.amount) from public.rnd_shares s join public.rnd_expenses e on e.id = s.expense_id
                 where e.group_id = p_group and e.cancelled_at is null and e.payer = p_uid and s.user_id <> p_uid), 0)
    - coalesce((select sum(s.amount) from public.rnd_shares s join public.rnd_expenses e on e.id = s.expense_id
                 where e.group_id = p_group and e.cancelled_at is null and s.user_id = p_uid and e.payer <> p_uid), 0)
    + coalesce((select sum(p.amount) from public.rnd_payments p
                 where p.group_id = p_group and p.from_user = p_uid and p.cancelled_at is null and p.rejected_at is null), 0)
    - coalesce((select sum(p.amount) from public.rnd_payments p
                 where p.group_id = p_group and p.to_user = p_uid and p.cancelled_at is null and p.rejected_at is null), 0)
  )::int;
$function$;
