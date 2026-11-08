-- public.ikvall_status(p_group_id uuid)
-- live md5(pg_get_functiondef) = fc41ddf22facac6fb4a29b24682ffe6c
CREATE OR REPLACE FUNCTION public.ikvall_status(p_group_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_people jsonb;
begin
  if v_uid is null then raise exception 'not_authed'; end if;
  if p_group_id is not null and not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  with circle as (
    select m2.user_id as uid, min(m2.display_name) as nm, false as friend
      from public.group_members m1 join public.group_members m2 on m2.group_id = m1.group_id
     where m1.user_id = v_uid and m2.user_id <> v_uid and (p_group_id is null or m1.group_id = p_group_id)
     group by m2.user_id
    union all
    select public.olnu_friend_other(f, v_uid), public.olnu_friend_name(public.olnu_friend_other(f, v_uid)), true
      from public.friendships f
     where p_group_id is null and (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
  ), ppl as (
    select c.uid, max(c.nm) as nm, bool_or(c.friend) as friend from circle c group by c.uid
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(p.nm, 'Någon'), 'st', s.st, 'friend', p.friend, 'at', s.updated_at)
           order by case s.st when 'ute' then 0 when 'kanske' then 1 else 2 end, s.updated_at desc), '[]'::jsonb)
    into v_people
    from ppl p join public.ikvall_status s on s.user_id = p.uid and s.night = v_night
   limit 80;
  return jsonb_build_object('v', 1, 'night', v_night,
    'mine', (select s.st from public.ikvall_status s where s.user_id = v_uid and s.night = v_night),
    'counts', jsonb_build_object(
      'ute', (select count(*) from jsonb_array_elements(v_people) x where x->>'st' = 'ute'),
      'kanske', (select count(*) from jsonb_array_elements(v_people) x where x->>'st' = 'kanske'),
      'hemma', (select count(*) from jsonb_array_elements(v_people) x where x->>'st' = 'hemma')),
    'people', v_people);
end; $function$;
