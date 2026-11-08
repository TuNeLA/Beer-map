-- public.olnu_skal_json(h skal_hours, p_uid uuid)
-- live md5(pg_get_functiondef) = ef5ee7f2b238bb3dba4c112fe58d3259
CREATE OR REPLACE FUNCTION public.olnu_skal_json(h skal_hours, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mem as (
    select m.user_id, m.display_name, m.joined_at from public.group_members m where m.group_id = h.group_id
  ), po as (
    select p.*, sp.w, sp.h, (sp.bytes is not null and sp.expires_at > now()) as alive
      from public.skal_hour_posts p
      join mem on mem.user_id = p.user_id
      left join public.snap_photos sp on sp.id = p.photo_id
     where p.hour_id = h.id
  ), need as (
    select mem.* from mem where mem.joined_at <= h.created_at
  ), me as (
    select exists (select 1 from po where po.user_id = p_uid) as posted
  )
  select jsonb_build_object(
    'id', h.id, 'group_id', h.group_id,
    'group_name', (select g.name from public.groups g where g.id = h.group_id),
    'auto', h.auto,
    'by', case when h.started_by is null then null else public.olnu_gang_name(h.group_id, h.started_by) end,
    'by_me', h.started_by is not distinct from p_uid,
    'created_at', h.created_at, 'ends_at', h.ends_at, 'now', now(),
    'late_until', h.created_at + interval '60 minutes',
    'needed', (select count(*) from need)::int,
    'posted', (select count(*) from po where po.in_time and po.user_id in (select user_id from need))::int,
    'done', now() >= h.ends_at
            or ((select count(*) from need) > 0
                and (select count(*) from po where po.in_time and po.user_id in (select user_id from need))
                    >= (select count(*) from need)),
    'mine', (select posted from me),
    'posts', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_gang_k(h.group_id, po.user_id), 'name', public.olnu_gang_name(h.group_id, po.user_id),
        'is_me', po.user_id = p_uid, 'at', po.created_at, 'sec', po.sec, 'in_time', po.in_time, 'rank', po.rank,
        'photo_id', case when (select posted from me) and po.alive then po.photo_id end,
        'w', case when (select posted from me) then po.w end, 'h', case when (select posted from me) then po.h end,
        'gone', not coalesce(po.alive, false)) order by po.rank) from po), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_gang_k(h.group_id, n.user_id), 'name', n.display_name, 'is_me', n.user_id = p_uid)
        order by n.display_name)
        from need n where not exists (select 1 from po where po.user_id = n.user_id)), '[]'::jsonb));
$function$;
