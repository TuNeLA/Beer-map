-- public.account_merge_ticket()
-- live md5(pg_get_functiondef) = 74e8aa97ae468994711eb51a65f1d18f
CREATE OR REPLACE FUNCTION public.account_merge_ticket()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_ticket text;
  v_groups jsonb;
begin
  if not coalesce((select u.is_anonymous from auth.users u where u.id = v_uid), false) then
    raise exception 'not_anonymous';
  end if;
  if (select count(*) from public.account_merge_tickets t where t.from_uid = v_uid and t.created_at > now() - interval '1 hour') >= 6 then
    raise exception 'rate_limited';
  end if;
  v_ticket := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.account_merge_tickets (from_uid, ticket_hash)
    values (v_uid, encode(sha256(convert_to(v_ticket, 'UTF8')), 'hex'));
  select coalesce(jsonb_agg(g.name order by m.joined_at desc), '[]'::jsonb) into v_groups
    from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = v_uid;
  return jsonb_build_object('ticket', v_ticket, 'groups', v_groups, 'n', jsonb_array_length(v_groups));
end;
$function$;
