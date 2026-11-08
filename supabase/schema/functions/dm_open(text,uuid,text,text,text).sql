-- public.dm_open(p_key text, p_group_id uuid, p_k text, p_pin text, p_name text)
-- live md5(pg_get_functiondef) = 6503f32b9a0f32edbeae6af3f9a029fc
CREATE OR REPLACE FUNCTION public.dm_open(p_key text DEFAULT NULL::text, p_group_id uuid DEFAULT NULL::uuid, p_k text DEFAULT NULL::text, p_pin text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_o uuid;
  v_gid uuid;
  v_code text;
  v_try int := 0;
  v_beer bigint;
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  if nullif(btrim(coalesce(p_key, '')), '') is not null then
    select c.uid into v_o from public.olnu_inv_cands(v_uid) c where c.k = btrim(p_key) limit 1;
  elsif p_group_id is not null and nullif(btrim(coalesce(p_k, '')), '') is not null then
    if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    select m.user_id into v_o from public.group_members m
     where m.group_id = p_group_id and public.olnu_chief_k(p_group_id, m.user_id) = btrim(p_k) limit 1;
  elsif nullif(btrim(coalesce(p_pin, '')), '') is not null then
    v_beer := public.olnu_resolve_pin(v_uid, p_pin);
    if v_beer is not null then select b.user_id into v_o from public.beers b where b.id = v_beer; end if;
  end if;
  if v_o is null or v_o = v_uid then raise exception 'invalid_target'; end if;

  select t.group_id into v_gid from public.dm_threads t where t.a = least(v_uid, v_o) and t.b = greatest(v_uid, v_o);
  if v_gid is not null then return public.olnu_dm_json(v_gid, v_uid); end if;

  if not public.olnu_dm_friends(v_uid, v_o) then raise exception 'not_friends'; end if;
  if public.olnu_dm_blocked(v_uid, v_o) then raise exception 'blocked'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_dm:' || least(v_uid, v_o)::text || greatest(v_uid, v_o)::text, 0));
  select t.group_id into v_gid from public.dm_threads t where t.a = least(v_uid, v_o) and t.b = greatest(v_uid, v_o);
  if v_gid is not null then return public.olnu_dm_json(v_gid, v_uid); end if;
  if (select count(*) from public.dm_threads t where t.created_by = v_uid and t.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'slow_down';
  end if;
  loop
    v_try := v_try + 1;
    v_code := '';
    for k in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * 32)::int, 1);
    end loop;
    insert into public.groups (name, code, created_by) values ('💬 Direkt', v_code, null)
    on conflict (code) do nothing
    returning id into v_gid;
    exit when v_gid is not null;
    if v_try >= 20 then raise exception 'slow_down'; end if;
  end loop;
  insert into public.dm_threads (group_id, a, b, created_by) values (v_gid, least(v_uid, v_o), greatest(v_uid, v_o), v_uid);
  insert into public.dm_state (group_id, user_id) values (v_gid, v_uid), (v_gid, v_o) on conflict do nothing;
  return public.olnu_dm_json(v_gid, v_uid);
end; $function$;
