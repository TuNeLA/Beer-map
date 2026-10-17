-- 0019 Chat likes (additive). A member can like any message in a group they are in (toggle).
-- msg_likes(p_group_id, p_after_id) returns like counts + who liked, for live messages.
create table if not exists public.group_msg_likes (
  msg_id     bigint not null,
  user_id    uuid   not null,
  liked      boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (msg_id, user_id)
);
alter table public.group_msg_likes enable row level security;
revoke all on public.group_msg_likes from anon, authenticated;

-- Toggle my like. Returns {likes, liked}. Errors: not_member, msg_not_found.
create or replace function public.like_msg(p_msg_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_gid uuid;
  v_liked boolean;
  v_n int;
begin
  select gm.group_id into v_gid from public.group_msgs gm where gm.id = p_msg_id and gm.expires_at > now();
  if v_gid is null then raise exception 'msg_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  insert into public.group_msg_likes as l (msg_id, user_id, liked) values (p_msg_id, v_uid, true)
  on conflict (msg_id, user_id) do update set liked = not l.liked, created_at = now()
  returning l.liked into v_liked;
  select count(*) into v_n from public.group_msg_likes where msg_id = p_msg_id and liked;
  return jsonb_build_object('likes', v_n, 'liked', v_liked);
end;
$$;

-- Likes for the live messages of a group (all, or with id > p_after_id - 200 to keep it small).
create or replace function public.msg_likes(p_group_id uuid)
returns table (msg_id bigint, likes int, liked bool, names text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select l.msg_id, count(*)::int, bool_or(l.user_id = v_uid),
         array_agg(coalesce(mm.display_name, '?') order by l.created_at)
    from public.group_msg_likes l
    join public.group_msgs gm on gm.id = l.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = l.user_id
   where l.liked
   group by l.msg_id;
end;
$$;

revoke all on function public.like_msg(bigint) from public, anon;
revoke all on function public.msg_likes(uuid) from public, anon;
grant execute on function public.like_msg(bigint) to authenticated;
grant execute on function public.msg_likes(uuid) to authenticated;
