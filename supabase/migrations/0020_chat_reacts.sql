-- 0020 Chat reactions (additive). Long-press a message → 🍻 😂 🔥 ❤️. One reaction per user per message
-- (same emoji again = remove, other emoji = switch). 0019 like_msg/msg_likes stay for old app versions.
create table if not exists public.group_msg_reacts (
  msg_id     bigint not null,
  user_id    uuid   not null,
  emoji      text   not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (msg_id, user_id)
);
alter table public.group_msg_reacts enable row level security;
revoke all on public.group_msg_reacts from anon, authenticated;

create or replace function public.react_msg(p_msg_id bigint, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_gid uuid;
  v_old text;
  v_act boolean;
begin
  if p_emoji not in ('🍻','😂','🔥','❤️') then raise exception 'invalid_emoji'; end if;
  select gm.group_id into v_gid from public.group_msgs gm where gm.id = p_msg_id and gm.expires_at > now();
  if v_gid is null then raise exception 'msg_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select r.emoji, r.active into v_old, v_act from public.group_msg_reacts r where r.msg_id = p_msg_id and r.user_id = v_uid;
  if v_old is null then
    insert into public.group_msg_reacts (msg_id, user_id, emoji) values (p_msg_id, v_uid, p_emoji);
    return jsonb_build_object('emoji', p_emoji);
  elsif v_old = p_emoji and v_act then
    update public.group_msg_reacts set active = false, created_at = now() where msg_id = p_msg_id and user_id = v_uid;
    return jsonb_build_object('emoji', null);
  else
    update public.group_msg_reacts set emoji = p_emoji, active = true, created_at = now() where msg_id = p_msg_id and user_id = v_uid;
    return jsonb_build_object('emoji', p_emoji);
  end if;
end;
$$;

create or replace function public.msg_reacts(p_group_id uuid)
returns table (msg_id bigint, emoji text, n int, mine bool, names text[])
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
  select r.msg_id, r.emoji, count(*)::int, bool_or(r.user_id = v_uid),
         array_agg(coalesce(mm.display_name, '?') order by r.created_at)
    from public.group_msg_reacts r
    join public.group_msgs gm on gm.id = r.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = r.user_id
   where r.active
   group by r.msg_id, r.emoji;
end;
$$;

revoke all on function public.react_msg(bigint, text) from public, anon;
revoke all on function public.msg_reacts(uuid) from public, anon;
grant execute on function public.react_msg(bigint, text) to authenticated;
grant execute on function public.msg_reacts(uuid) to authenticated;
