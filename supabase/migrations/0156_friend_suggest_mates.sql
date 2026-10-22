-- 0156 friends2: 👋 Du kanske känner now also suggests people in MY groups who are not my friends (group sharing no
-- longer makes a friend, 0154). Group-mates rank first and get `group` = the name of one shared group (the viewer is
-- in that group, so nothing new leaks). Friends-of-friends stay as in 0126.
-- Never suggested: me, accepted friends, pending either way, declined in the last 30 days, a friendship I removed
-- (for good), a friendship the other person removed (30 days), hidden (friend_suggest_hidden), no name, test users
-- for real users (0149).
-- friend_suggest -> {v, people:[{k, name (first name), mutual, group (text|null)}]} (additive field `group`).
-- friend_suggest_add: same as 0126, target from olnu_sug_rows2, via 'group' for a group-mate.
-- olnu_sug_rows (0126) stays as it was (not used by these two any more). Needs 0045, 0126, 0149.

create or replace function public.olnu_sug_rows2(p_uid uuid)
returns table(uid uuid, mutual integer, bars integer, g text)
language sql stable security definer set search_path to 'public' as $$
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
$$;

create or replace function public.friend_suggest()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_sug_k(v_uid, s.uid),
           'name', public.olnu_card_first(public.olnu_friend_name(s.uid)), 'mutual', s.mutual, 'group', s.g)
           order by s.score desc, s.mutual desc), '[]'::jsonb)
    into v
    from (select r.*, (case when r.g is not null then 6 else 0 end) + r.mutual * 2 + least(r.bars, 3) as score
            from public.olnu_sug_rows2(v_uid) r
           order by (case when r.g is not null then 6 else 0 end) + r.mutual * 2 + least(r.bars, 3) desc limit 8) s;
  return jsonb_build_object('v', 1, 'people', v);
end;
$$;

create or replace function public.friend_suggest_add(p_k text, p_name text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := public.olnu_uid();
  v_k text := left(regexp_replace(coalesce(p_k, ''), '[^0-9a-f]', '', 'g'), 16);
  v_t uuid; v_g text;
  f public.friendships;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select r.uid, r.g into v_t, v_g from public.olnu_sug_rows2(v_uid) r where public.olnu_sug_k(v_uid, r.uid) = v_k limit 1;
  if v_t is null then raise exception 'invalid_target'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_friend:' || least(v_uid, v_t)::text || greatest(v_uid, v_t)::text, 0));
  if (select count(*) from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'accepted') >= 300 then
    raise exception 'friend_limit';
  end if;
  if (select count(*) from public.friendships x where x.requester = v_uid and x.updated_at > now() - interval '1 hour'
        and x.status in ('pending', 'cancelled', 'declined')) >= 30 then
    raise exception 'slow_down';
  end if;
  select * into f from public.friendships x
   where least(x.a, x.b) = least(v_uid, v_t) and greatest(x.a, x.b) = greatest(v_uid, v_t);
  if f.id is not null then
    update public.friendships x set status = 'pending', requester = v_uid, via = case when v_g is not null then 'group' else 'code' end,
           notified = (x.updated_at > now() - interval '24 hours'), updated_at = now(), accepted_at = null, ended_by = null
     where x.id = f.id returning * into f;
  else
    insert into public.friendships (a, b, requester, status, via)
    values (least(v_uid, v_t), greatest(v_uid, v_t), v_uid, 'pending', case when v_g is not null then 'group' else 'code' end) returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_card_first(public.olnu_friend_name(v_t)));
end;
$$;

revoke all on function public.olnu_sug_rows2(uuid) from public;
revoke all on function public.friend_suggest() from public;
revoke all on function public.friend_suggest_add(text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_sug_rows2(uuid) from anon';
    execute 'revoke all on function public.friend_suggest() from anon';
    execute 'revoke all on function public.friend_suggest_add(text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_sug_rows2(uuid) from authenticated';
    execute 'grant execute on function public.friend_suggest() to authenticated';
    execute 'grant execute on function public.friend_suggest_add(text, text) to authenticated';
  end if;
end $$;
