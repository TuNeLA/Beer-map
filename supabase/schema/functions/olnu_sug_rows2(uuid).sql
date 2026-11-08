-- public.olnu_sug_rows2(p_uid uuid)
-- live md5(pg_get_functiondef) = f6783fe7e68fd456adb5b395db25858b
CREATE OR REPLACE FUNCTION public.olnu_sug_rows2(p_uid uuid)
 RETURNS TABLE(uid uuid, mutual integer, bars integer, g text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with fr as (
    select case when f.a = p_uid then f.b else f.a end as fid
      from public.friendships f where (f.a = p_uid or f.b = p_uid) and f.status = 'accepted'
     limit 300
  ), via_f as (
    select case when f.a = fr.fid then f.b else f.a end as uid, fr.fid
      from fr join public.friendships f on (f.a = fr.fid or f.b = fr.fid) and f.status = 'accepted'
  ), via_g as (
    select m2.user_id as uid, fr.fid
      from fr join public.group_members m1 on m1.user_id = fr.fid
      join public.group_members m2 on m2.group_id = m1.group_id and m2.user_id <> fr.fid
  ), cand as (
    select x.uid, count(distinct x.fid)::int as mutual from (select * from via_f union all select * from via_g) x
     where x.uid <> p_uid
     group by x.uid
  ), mates as (
    select m2.user_id as uid, min(gr.name) as g
      from public.group_members m1
      join public.group_members m2 on m2.group_id = m1.group_id and m2.user_id <> p_uid
      join public.groups gr on gr.id = m1.group_id
     where m1.user_id = p_uid
     group by m2.user_id
  ), allc as (
    select coalesce(c.uid, mt.uid) as uid, coalesce(c.mutual, 0) as mutual, mt.g
      from cand c full join mates mt on mt.uid = c.uid
  )
  select c.uid, c.mutual,
         (select count(distinct public.olnu_night_of(a.created_at))::int
            from public.checkins a join public.checkins b on b.bar_id = a.bar_id
             and public.olnu_night_of(b.created_at) = public.olnu_night_of(a.created_at)
           where a.user_id = p_uid and b.user_id = c.uid and a.created_at > now() - interval '60 days') as bars,
         c.g
    from allc c
   where c.uid is not null and c.uid <> p_uid
     and not exists (select 1 from fr where fr.fid = c.uid)
     and not exists (select 1 from public.friendships f where least(f.a, f.b) = least(p_uid, c.uid) and greatest(f.a, f.b) = greatest(p_uid, c.uid)
                      and (f.status in ('pending', 'accepted')
                           or (f.status = 'declined' and f.updated_at > now() - interval '30 days')
                           or (f.status = 'removed' and (f.ended_by = p_uid or f.updated_at > now() - interval '30 days'))))
     and not exists (select 1 from public.friend_suggest_hidden h where h.user_id = p_uid and h.k = public.olnu_sug_k(p_uid, c.uid))
     and public.olnu_friend_name(c.uid) is not null
     and (not public.olnu_is_test_user(c.uid) or public.olnu_is_test_user(p_uid));
$function$;
