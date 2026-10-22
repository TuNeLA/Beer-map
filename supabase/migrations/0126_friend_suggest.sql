-- 0126 (social2) "Du kanske känner" (friend suggestions) in the Vänner tab.
-- Candidates = people connected to one of MY accepted friends (an accepted friendship with that friend, or a shared group
-- with that friend), who are NOT me, NOT in a group with me, and have no pending/accepted friendship with me.
-- mutual = how many of my friends connect us. Bonus: we checked in at the same bar the same night (last 60 days) –
-- only used for ranking, and only when mutual >= 1. Output: FIRST name + mutual count + an opaque key. Never a user
-- id, a place, a bar or a time. Hidden with "✕ Dölj" for good (friend_suggest_hidden).
-- friend_suggest_add(p_k, p_name) sends a normal friend request (same rules + limits as friend_request).
-- No row is ever removed by this file. Safe to run again.

create table if not exists public.friend_suggest_hidden (
  user_id    uuid not null,
  k          text not null,
  hidden_at  timestamptz not null default now(),
  primary key (user_id, k)
);
alter table public.friend_suggest_hidden enable row level security;
revoke all on table public.friend_suggest_hidden from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on table public.friend_suggest_hidden from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on table public.friend_suggest_hidden from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant all on table public.friend_suggest_hidden to service_role'; end if;
end $$;

-- the key the viewer sees for a candidate (stable per viewer, useless for anyone else)
create or replace function public.olnu_sug_k(p_viewer uuid, p_uid uuid)
returns text
language sql
immutable
set search_path = public
as $$ select left(md5(p_viewer::text || ':' || p_uid::text || ':olnu-sug'), 16); $$;

create or replace function public.olnu_sug_rows(p_uid uuid)
returns table (uid uuid, mutual int, bars int)
language sql
stable
security definer
set search_path = public
as $$
  with fr as (   -- my accepted friends
    select case when f.a = p_uid then f.b else f.a end as fid
      from public.friendships f where (f.a = p_uid or f.b = p_uid) and f.status = 'accepted'
     limit 300
  ), via_f as (  -- friends of my friends
    select case when f.a = fr.fid then f.b else f.a end as uid, fr.fid
      from fr join public.friendships f on (f.a = fr.fid or f.b = fr.fid) and f.status = 'accepted'
  ), via_g as (  -- people in a group with my friends
    select m2.user_id as uid, fr.fid
      from fr join public.group_members m1 on m1.user_id = fr.fid
      join public.group_members m2 on m2.group_id = m1.group_id and m2.user_id <> fr.fid
      left join public.temp_groups tg on tg.group_id = m1.group_id
     where tg.group_id is null
  ), cand as (
    select x.uid, count(distinct x.fid)::int as mutual from (select * from via_f union all select * from via_g) x
     where x.uid <> p_uid
     group by x.uid
  )
  select c.uid, c.mutual,
         (select count(distinct public.olnu_night_of(a.created_at))::int
            from public.checkins a join public.checkins b on b.bar_id = a.bar_id
             and public.olnu_night_of(b.created_at) = public.olnu_night_of(a.created_at)
           where a.user_id = p_uid and b.user_id = c.uid and a.created_at > now() - interval '60 days') as bars
    from cand c
   where not exists (select 1 from fr where fr.fid = c.uid)
     and not exists (select 1 from public.group_members m1 join public.group_members m2 on m2.group_id = m1.group_id
                      where m1.user_id = p_uid and m2.user_id = c.uid)
     and not exists (select 1 from public.friendships f where least(f.a, f.b) = least(p_uid, c.uid) and greatest(f.a, f.b) = greatest(p_uid, c.uid)
                      and (f.status in ('pending', 'accepted') or (f.status = 'declined' and f.updated_at > now() - interval '30 days')))
     and not exists (select 1 from public.friend_suggest_hidden h where h.user_id = p_uid and h.k = public.olnu_sug_k(p_uid, c.uid))
     and public.olnu_friend_name(c.uid) is not null;
$$;

create or replace function public.friend_suggest()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_sug_k(v_uid, s.uid),
           'name', public.olnu_card_first(public.olnu_friend_name(s.uid)), 'mutual', s.mutual)
           order by s.mutual * 2 + least(s.bars, 3) desc, s.mutual desc), '[]'::jsonb)
    into v
    from (select * from public.olnu_sug_rows(v_uid) r order by r.mutual * 2 + least(r.bars, 3) desc limit 8) s;
  return jsonb_build_object('v', 1, 'people', v);
end;
$$;

create or replace function public.friend_suggest_hide(p_k text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_k text := left(regexp_replace(coalesce(p_k, ''), '[^0-9a-f]', '', 'g'), 16);
begin
  if char_length(v_k) <> 16 then raise exception 'invalid_target'; end if;
  if (select count(*) from public.friend_suggest_hidden h where h.user_id = v_uid) >= 500 then return jsonb_build_object('ok', true); end if;
  insert into public.friend_suggest_hidden (user_id, k) values (v_uid, v_k)
  on conflict (user_id, k) do update set hidden_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.friend_suggest_add(p_k text, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_k text := left(regexp_replace(coalesce(p_k, ''), '[^0-9a-f]', '', 'g'), 16);
  v_t uuid;
  f public.friendships;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select r.uid into v_t from public.olnu_sug_rows(v_uid) r where public.olnu_sug_k(v_uid, r.uid) = v_k limit 1;
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
    update public.friendships x set status = 'pending', requester = v_uid, via = 'code',
           notified = (x.updated_at > now() - interval '24 hours'), updated_at = now(), accepted_at = null, ended_by = null
     where x.id = f.id returning * into f;
  else
    insert into public.friendships (a, b, requester, status, via)
    values (least(v_uid, v_t), greatest(v_uid, v_t), v_uid, 'pending', 'code') returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_card_first(public.olnu_friend_name(v_t)));
end;
$$;

revoke all on function public.olnu_sug_k(uuid, uuid) from public;
revoke all on function public.olnu_sug_rows(uuid) from public;
revoke all on function public.friend_suggest() from public;
revoke all on function public.friend_suggest_hide(text) from public;
revoke all on function public.friend_suggest_add(text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_sug_k(uuid, uuid) from anon';
    execute 'revoke all on function public.olnu_sug_rows(uuid) from anon';
    execute 'revoke all on function public.friend_suggest() from anon';
    execute 'revoke all on function public.friend_suggest_hide(text) from anon';
    execute 'revoke all on function public.friend_suggest_add(text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_sug_k(uuid, uuid) from authenticated';
    execute 'revoke all on function public.olnu_sug_rows(uuid) from authenticated';
    execute 'grant execute on function public.friend_suggest() to authenticated';
    execute 'grant execute on function public.friend_suggest_hide(text) to authenticated';
    execute 'grant execute on function public.friend_suggest_add(text, text) to authenticated';
  end if;
end $$;
