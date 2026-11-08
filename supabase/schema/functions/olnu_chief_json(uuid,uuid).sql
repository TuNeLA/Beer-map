-- public.olnu_chief_json(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 7d2eddca43de13de2e9e7d4facda0834
CREATE OR REPLACE FUNCTION public.olnu_chief_json(p_group uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (select public.olnu_chief_of(p_group) as uid),
  o as (select public.olnu_owner_of(p_group) as uid),
  act as (select public.olnu_acting_vice(p_group) as uid),
  pw as (select public.olnu_owner_powers(p_group, p_uid) as yes),
  last as (
    select r.* from public.status_reqs r where r.group_id = p_group order by r.created_at desc, r.id desc limit 1
  ), tonight as (
    select count(*)::int as n from public.status_reqs r where r.group_id = p_group and r.created_at >= public.olnu_chief_from()
  ), mem as (
    select m.user_id, m.display_name, m.joined_at, public.olnu_is_vice(p_group, m.user_id) as vice
      from public.group_members m where m.group_id = p_group
  )
  select jsonb_build_object(
    'group_id', p_group,
    'chief_k', (select public.olnu_chief_k(p_group, c.uid) from c),
    'chief_name', (select public.olnu_chief_name(p_group, c.uid) from c),
    'is_chief', (select c.uid = p_uid from c),
    'is_creator', exists (select 1 from public.groups g where g.id = p_group and g.created_by = p_uid),
    'can_hand', (select yes from pw),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_chief_k(p_group, m.user_id), 'name', m.display_name,
        'is_me', m.user_id = p_uid, 'is_chief', m.user_id = (select uid from c),
        'is_owner', m.user_id = (select uid from o), 'is_vice', m.vice,
        'is_acting', m.user_id = (select uid from act),
        'home_town', public.olnu_home_town(m.user_id),
        'can_remove', public.olnu_remove_block(p_group, p_uid, m.user_id) is null)
        order by m.joined_at, m.display_name)
        from mem m), '[]'::jsonb),
    'used', (select n from tonight),
    'max', 6,
    'next_at', greatest(now(), coalesce((select l.created_at + interval '20 minutes' from last l), now())),
    'req', (select public.olnu_status_json(l, p_uid) from last l where l.created_at > now() - interval '2 hours'),
    -- v25 (0034)
    'my_k', public.olnu_chief_k(p_group, p_uid),
    'owner_k', (select public.olnu_chief_k(p_group, o.uid) from o where o.uid is not null),
    'owner_name', (select public.olnu_chief_name(p_group, o.uid) from o),
    'is_owner', (select o.uid = p_uid from o),
    'is_vice', public.olnu_is_vice(p_group, p_uid),
    'owner_powers', (select yes from pw),
    'can_vice', (select yes from pw),
    'can_req', (select c.uid = p_uid from c) or public.olnu_is_vice(p_group, p_uid),
    'can_remove', exists (select 1 from mem m where public.olnu_remove_block(p_group, p_uid, m.user_id) is null),
    'vices', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_chief_k(p_group, m.user_id), 'name', m.display_name,
        'is_me', m.user_id = p_uid) order by m.joined_at) from mem m where m.vice), '[]'::jsonb),
    'chief_idle', public.olnu_chief_idle(p_group),
    'acting_k', (select public.olnu_chief_k(p_group, a.uid) from act a where a.uid is not null),
    'acting_name', (select public.olnu_chief_name(p_group, a.uid) from act a),
    'is_acting', (select a.uid = p_uid from act a),
    'chief_home', (select public.olnu_home_town(c.uid) from c),
    'owner_home', (select public.olnu_home_town(o.uid) from o));
$function$;
