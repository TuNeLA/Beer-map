-- public.rnd_group(p_group_id uuid)
-- live md5(pg_get_functiondef) = 753f456f6d3d0cc67409586af6dde8f5
CREATE OR REPLACE FUNCTION public.rnd_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_rnd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  return jsonb_build_object(
    'v', 1, 'server_time', now(), 'night', public.olnu_night_of(now()),
    'me', public.olnu_rnd_k(p_group_id, v_uid),
    'my_swish', (select s.number from public.rnd_swish s where s.user_id = v_uid),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_rnd_k(p_group_id, m.user_id), 'name', m.display_name, 'is_me', m.user_id = v_uid,
        'out', exists (select 1 from public.beers b where b.user_id = m.user_id and b.expires_at > now() and not coalesce(b.stopped, false)),
        'swish', public.olnu_rnd_swish_of(p_group_id, m.user_id),
        'paid_n', public.olnu_rnd_paid_n(p_group_id, m.user_id),
        'net', public.olnu_rnd_net(p_group_id, m.user_id)) order by m.joined_at)
      from (select g.user_id, g.display_name, g.joined_at from public.group_members g where g.group_id = p_group_id
            union all
            select e.user_id, e.name, e.ord from public.olnu_evg_people(p_group_id) e
             where not exists (select 1 from public.group_members g2 where g2.group_id = p_group_id and g2.user_id = e.user_id)) m), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(public.olnu_rnd_exp_json(x, v_uid) order by x.id desc) from (
        select e.* from public.rnd_expenses e
         where e.group_id = p_group_id and e.created_at > now() - interval '14 days'
         order by e.id desc limit 40) x), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'from', public.olnu_rnd_k(p_group_id, p.from_user), 'from_name', public.olnu_rnd_name(p_group_id, p.from_user),
        'to', public.olnu_rnd_k(p_group_id, p.to_user), 'to_name', public.olnu_rnd_name(p_group_id, p.to_user),
        'amount', p.amount, 'expense_id', p.expense_id, 'created_at', p.created_at,
        'confirmed', p.confirmed_at is not null, 'rejected', p.rejected_at is not null,
        'from_me', p.from_user = v_uid, 'to_me', p.to_user = v_uid,
        'can_undo', p.created_by = v_uid and p.confirmed_at is null and p.rejected_at is null and p.created_at > now() - interval '24 hours',
        'can_confirm', p.to_user = v_uid and p.confirmed_at is null and p.rejected_at is null) order by p.id desc)
      from (select * from public.rnd_payments q
             where q.group_id = p_group_id and q.cancelled_at is null and q.created_at > now() - interval '14 days'
             order by q.id desc limit 40) p), '[]'::jsonb));
end; $function$;
