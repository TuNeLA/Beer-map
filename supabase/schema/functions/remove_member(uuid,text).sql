-- public.remove_member(p_group_id uuid, p_user_id text)
-- live md5(pg_get_functiondef) = f1e040e56b3b73ea81ce5acb8fff5021
CREATE OR REPLACE FUNCTION public.remove_member(p_group_id uuid, p_user_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := public.olnu_uid();
  v_target uuid;
  v_block  text;
  v_chief  uuid;
  v_owner  uuid;
  v_sub    text;
  v_claims text;
  v_cl     jsonb;
  m        public.group_members;
  v_gname  text;
begin
  if not public.olnu_chief_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_chief:' || p_group_id::text, 0));
  select * into m from public.group_members x
   where x.group_id = p_group_id
     and (public.olnu_chief_k(p_group_id, x.user_id) = btrim(coalesce(p_user_id, ''))
          or x.user_id::text = lower(btrim(coalesce(p_user_id, ''))))
   limit 1;
  if not found then raise exception 'not_member'; end if;
  v_target := m.user_id;
  v_block := public.olnu_remove_block(p_group_id, v_uid, v_target);
  if v_block is not null then raise exception '%', v_block; end if;
  if (select count(*) from public.group_members_removed r where r.removed_by = v_uid and r.removed_at > now() - interval '1 hour') >= 20 then
    raise exception 'slow_down';
  end if;

  v_chief := public.olnu_chief_of(p_group_id);
  v_owner := (select g.created_by from public.groups g where g.id = p_group_id);
  select g.name into v_gname from public.groups g where g.id = p_group_id;

  -- Archive first.
  insert into public.group_members_removed (group_id, user_id, display_name, joined_at, group_name, removed_by)
  values (p_group_id, v_target, m.display_name, m.joined_at, v_gname, v_uid);
  -- Roles go with the membership.
  update public.group_vices v set active = false, updated_at = now(), set_by = v_uid
   where v.group_id = p_group_id and v.user_id = v_target and v.active;
  if v_target = v_chief then
    insert into public.group_chiefs (group_id, user_id, set_by, updated_at)
    values (p_group_id, coalesce(public.olnu_owner_of(p_group_id), v_uid), v_uid, now())
    on conflict (group_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, updated_at = now();
  end if;

  -- Free the membership row with the existing leave_group(), run as the target for this one call.
  v_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  begin
    v_cl := coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb);
  exception when others then
    v_cl := '{}'::jsonb;
  end;
  perform set_config('request.jwt.claim.sub', v_target::text, true);
  perform set_config('request.jwt.claims', jsonb_set(v_cl, '{sub}', to_jsonb(v_target::text), true)::text, true);
  perform public.leave_group(p_group_id);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  if public.olnu_uid() is distinct from v_uid then raise exception 'internal_error'; end if;
  if public.olnu_chief_member(p_group_id, v_target) then raise exception 'internal_error'; end if;

  return jsonb_build_object('ok', true, 'name', m.display_name, 'group_name', v_gname,
    'state', public.olnu_chief_json(p_group_id, v_uid));
end; $function$;
