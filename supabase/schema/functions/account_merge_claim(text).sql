-- public.account_merge_claim(p_ticket text)
-- live md5(pg_get_functiondef) = 017ac80f021a684bc9f476ec06bedd29
CREATE OR REPLACE FUNCTION public.account_merge_claim(p_ticket text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_t public.account_merge_tickets%rowtype;
  v_moved int := 0;
  v_skipped int := 0;
  v_names jsonb := '[]'::jsonb;
begin
  if coalesce((select u.is_anonymous from auth.users u where u.id = v_uid), true) then
    raise exception 'not_permanent';
  end if;
  if p_ticket is null or char_length(p_ticket) < 32 or char_length(p_ticket) > 80 then
    raise exception 'ticket_invalid';
  end if;
  select * into v_t from public.account_merge_tickets t
   where t.ticket_hash = encode(sha256(convert_to(p_ticket, 'UTF8')), 'hex')
     and t.used_at is null and t.expires_at > now()
   for update;
  if not found then
    raise exception 'ticket_invalid';
  end if;
  if v_t.from_uid <> v_uid then
    select coalesce(jsonb_agg(g.name), '[]'::jsonb) into v_names
      from public.group_members m join public.groups g on g.id = m.group_id
     where m.user_id = v_t.from_uid
       and not exists (select 1 from public.group_members b where b.group_id = m.group_id and b.user_id = v_uid);
    update public.group_members m set user_id = v_uid
     where m.user_id = v_t.from_uid
       and not exists (select 1 from public.group_members b where b.group_id = m.group_id and b.user_id = v_uid);
    get diagnostics v_moved = row_count;
    select count(*) into v_skipped from public.group_members m where m.user_id = v_t.from_uid;
    update public.groups g set created_by = v_uid where g.created_by = v_t.from_uid;
  end if;
  update public.account_merge_tickets
     set used_at = now(), to_uid = v_uid, groups_moved = v_moved, groups_skipped = v_skipped
   where id = v_t.id;
  return jsonb_build_object('moved', v_moved, 'skipped', v_skipped, 'groups', v_names);
end;
$function$;
