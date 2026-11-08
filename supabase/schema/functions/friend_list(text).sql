-- public.friend_list(p_name text)
-- live md5(pg_get_functiondef) = 6f75dac9cc9b3c35acb88296e8434f0d
CREATE OR REPLACE FUNCTION public.friend_list(p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  with fr as (
    select public.olnu_friend_other(f, v_uid) as uid, f.id as fid, f.via
      from public.friendships f
     where (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
  ), gm as (
    select gm2.user_id as uid, gm.group_id
      from public.group_members gm
      join public.group_members gm2 on gm2.group_id = gm.group_id
     where gm.user_id = v_uid and gm2.user_id <> v_uid
  ), u as (
    select x.uid from (select uid from fr union select uid from gm) x where x.uid is not null and x.uid <> v_uid limit 400
  ), rows as (
    select u.uid,
           (select fr.fid from fr where fr.uid = u.uid limit 1) as fid,
           (select fr.via from fr where fr.uid = u.uid limit 1) as via,
           (select gm.group_id from gm join public.groups g on g.id = gm.group_id where gm.uid = u.uid order by g.name, g.id limit 1) as g1,
           coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                       from gm join public.groups g on g.id = gm.group_id where gm.uid = u.uid), '[]'::jsonb) as groups,
           public.olnu_friend_name(u.uid) as nm,
           po.is_out, po.town
      from u left join lateral public.olnu_friend_out(u.uid) po on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', public.olnu_inv_key(v_uid, r.uid),
           'name', coalesce(r.nm, '?'), 'home_town', public.olnu_home_town(r.uid),
           'out', coalesce(r.is_out, false), 'town', r.town,
           'friend_id', r.fid, 'friend', r.fid is not null, 'via', r.via,
           'groups', r.groups,
           'find_key', case when r.fid is not null then 'f' || r.fid
                            when r.g1 is not null then 'g' || r.g1 || ':' || public.olnu_chief_k(r.g1, r.uid) end,
           'add', case when r.fid is null and r.g1 is not null
                       then jsonb_build_object('g', r.g1, 'k', public.olnu_chief_k(r.g1, r.uid)) end)
         order by coalesce(r.is_out, false) desc, lower(coalesce(r.nm, '~'))), '[]'::jsonb)
    into v from rows r;
  return jsonb_build_object('v', 1, 'people', v,
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
                 'n', (select count(*) from public.group_members m2 where m2.group_id = g.id)) order by g.name)
              from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = v_uid), '[]'::jsonb));
end; $function$;
