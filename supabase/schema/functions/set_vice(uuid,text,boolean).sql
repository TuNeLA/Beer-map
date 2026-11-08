-- public.set_vice(p_group_id uuid, p_k text, p_on boolean)
-- live md5(pg_get_functiondef) = 863d3597c5b0d29ef15008d7734f0464
CREATE OR REPLACE FUNCTION public.set_vice(p_group_id uuid, p_k text, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  m     public.group_members;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_chief:' || p_group_id::text, 0));
  if not public.olnu_owner_powers(p_group_id, v_uid) then raise exception 'not_allowed'; end if;
  select * into m from public.group_members x
   where x.group_id = p_group_id and public.olnu_chief_k(p_group_id, x.user_id) = p_k limit 1;
  if not found then raise exception 'invalid_member'; end if;
  if coalesce(p_on, true) then
    if m.user_id = public.olnu_chief_of(p_group_id)
       or m.user_id is not distinct from (select g.created_by from public.groups g where g.id = p_group_id) then
      raise exception 'invalid_member';
    end if;
    insert into public.group_vices (group_id, user_id, member_since, active, set_by, created_at, updated_at)
    values (p_group_id, m.user_id, m.joined_at, true, v_uid, now(), now())
    on conflict (group_id, user_id) do update
      set member_since = excluded.member_since, set_by = excluded.set_by,
          updated_at = case when public.group_vices.active and public.group_vices.member_since = excluded.member_since
                            then public.group_vices.updated_at else now() end,
          active = true;
  else
    update public.group_vices v set active = false, updated_at = now(), set_by = v_uid
     where v.group_id = p_group_id and v.user_id = m.user_id and v.active;
  end if;
  return public.olnu_chief_json(p_group_id, v_uid);
end; $function$;
