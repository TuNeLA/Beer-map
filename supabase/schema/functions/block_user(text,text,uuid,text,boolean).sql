-- public.block_user(p_kind text, p_ref text, p_group uuid, p_k text, p_on boolean)
-- live md5(pg_get_functiondef) = 8c8a41467f20d7e18b4066b0b61dc954
CREATE OR REPLACE FUNCTION public.block_user(p_kind text DEFAULT 'person'::text, p_ref text DEFAULT NULL::text, p_group uuid DEFAULT NULL::uuid, p_k text DEFAULT NULL::text, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); t record; v_name text;
begin
  if (select count(*) from public.user_blocks k where k.blocker = v_uid and k.updated_at > now() - interval '1 minute') >= 10 then
    raise exception 'slow_down';
  end if;
  select * into t from public.olnu_safety_target(v_uid, coalesce(p_kind, 'person'), p_ref, p_group, p_k);
  v_name := left(coalesce(public.olnu_friend_name(t.target), '?'), 30);
  insert into public.user_blocks as k (blocker, blocked, active, name)
  values (v_uid, t.target, coalesce(p_on, true), v_name)
  on conflict (blocker, blocked) do update set active = coalesce(p_on, true), name = coalesce(k.name, excluded.name), updated_at = now();
  if coalesce(p_on, true) then
    update public.friendships f set status = 'removed', ended_by = v_uid, updated_at = now()
     where ((f.a = v_uid and f.b = t.target) or (f.b = v_uid and f.a = t.target)) and f.status in ('accepted', 'pending');
  end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, true), 'name', v_name,
                            'id', substr(md5(v_uid::text || ':' || t.target::text || ':olnu-ub'), 1, 16));
end; $function$;
