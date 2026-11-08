-- public.invite_add(p_id bigint, p_keys text[], p_group_ids uuid[], p_name text)
-- live md5(pg_get_functiondef) = 126eb24146f9ebe7d4e425771ad7f3fa
CREATE OR REPLACE FUNCTION public.invite_add(p_id bigint, p_keys text[] DEFAULT '{}'::text[], p_group_ids uuid[] DEFAULT '{}'::uuid[], p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  i public.invites;
  v_to uuid[];
  v_n int;
  v_added int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  select * into i from public.invites x where x.id = p_id
     and exists (select 1 from public.invite_people p where p.invite_id = x.id and p.user_id = v_uid)
   for update;
  if not found then raise exception 'invite_not_found'; end if;
  if i.status <> 'open' or i.ends_at <= now() then raise exception 'invite_over'; end if;
  v_to := public.olnu_inv_resolve(v_uid, p_keys, p_group_ids);
  select count(*) into v_n from public.invite_people p where p.invite_id = p_id and p.user_id <> i.creator;
  select count(*) into v_added from unnest(v_to) u
   where not exists (select 1 from public.invite_people p where p.invite_id = p_id and p.user_id = u);
  if v_added = 0 then raise exception 'no_invitees'; end if;
  if v_n + v_added > 60 then raise exception 'too_many'; end if;
  insert into public.invite_people (invite_id, user_id, invited_by)
  select p_id, u, v_uid from unnest(v_to) u on conflict do nothing;
  update public.invites set updated_at = now() where id = p_id;
  return public.olnu_inv_json(p_id, v_uid, true) || jsonb_build_object('added', v_added);
end; $function$;
