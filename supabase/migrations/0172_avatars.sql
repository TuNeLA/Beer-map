-- 0172 👤 AVATAR (own little character: face in a circle + shoulders; owner 2026-11-07).
-- The character is a small JSON spec (≤ 1 KB, whitelisted keys, small integers) drawn client-side (docs/js/avatar.js).
-- Items unlock by real data: meriter rank (olnu_rank_of), medals (user_medals), best weekend streak (olnu_helg_calc),
-- bars in the passport (medal_checkins), towns (after_nights), events said yes to (invite_people). Nothing is bought.
-- The lock table olnu_avatar_locks() is the SAME as AVATAR.LOCKS in avatar.js (key "slot:index").
-- Users without a spec get a default character from `seed` (md5 of the user id; never the id itself).
-- Additive: one new table, new functions. No row is ever removed. Needs 0012 (user_medals), 0036 (meriter),
-- 0045 (friendships), 0080 (invites), 0136 (dm_threads), helg (olnu_helg_calc), 0030 (olnu_chief_k), 0080 (olnu_inv_key).

create table if not exists public.avatars (
  user_id    uuid primary key,
  spec       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.avatars enable row level security;
revoke all on table public.avatars from public, anon, authenticated;

-- Max index per slot (0..max). md = pinned medal ids (max 6), ms = show medals 0/1, v = version.
create or replace function public.olnu_avatar_max()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{"sk":7,"fs":2,"ey":6,"br":4,"mt":6,"hr":10,"hc":8,"fh":8,"hw":13,"gl":10,"up":8,"uc":7,"bg":11,"ms":1}'::jsonb;
$$;

-- Locked items: r = rank index ≥, m = medal owned, s = best weekend streak ≥, b = bars ≥, t = towns ≥, e = events ≥.
create or replace function public.olnu_avatar_locks()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{
    "sk:7":{"r":6},
    "ey:6":{"r":8},
    "mt:6":{"m":"radio"},
    "hr:9":{"r":5}, "hr:10":{"b":5},
    "hc:7":{"m":"sr10"}, "hc:8":{"s":3},
    "fh:7":{"r":7}, "fh:8":{"t":2},
    "hw:5":{"r":3}, "hw:6":{"r":4}, "hw:7":{"r":6}, "hw:8":{"r":9}, "hw:9":{"e":1}, "hw:10":{"t":3},
    "hw:11":{"r":12}, "hw:12":{"m":"lucia"}, "hw:13":{"m":"kung"},
    "gl:5":{"r":7}, "gl:6":{"r":5}, "gl:7":{"e":1}, "gl:8":{"m":"uggla"}, "gl:9":{"r":14}, "gl:10":{"r":17},
    "up:3":{"m":"sg10"}, "up:4":{"r":4}, "up:5":{"r":12}, "up:6":{"r":20}, "up:7":{"r":25}, "up:8":{"s":4},
    "bg:8":{"r":3}, "bg:9":{"s":2}, "bg:10":{"t":2}, "bg:11":{"r":15}
  }'::jsonb;
$$;

create or replace function public.olnu_avatar_seed(p_uid uuid)
returns text language sql immutable set search_path to 'public' as $$
  select substr(md5(p_uid::text || ':olnu-avatar'), 1, 8);
$$;

-- The unlock facts of one user.
create or replace function public.olnu_avatar_facts(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_m int := 0; v_r int := 1; v_n int := 42; v_title text; v_next text; v_next_at int;
  v_s int := 0; v_b int := 0; v_t int := 0; v_e int := 0; v_md jsonb := '[]'::jsonb;
begin
  begin v_m := coalesce(public.olnu_meriter(p_uid), 0); exception when others then v_m := 0; end;
  begin
    select ro.idx, ro.n, ro.title, ro.next_title, ro.next_at into v_r, v_n, v_title, v_next, v_next_at from public.olnu_rank_of(v_m) ro;
  exception when others then v_r := 1; end;
  begin v_s := coalesce((public.olnu_helg_calc(p_uid, now())->>'best')::int, 0); exception when others then v_s := 0; end;
  begin select count(distinct mc.bar_id)::int into v_b from public.medal_checkins mc where mc.user_id = p_uid; exception when others then v_b := 0; end;
  begin select count(distinct an.town)::int into v_t from public.after_nights an where an.user_id = p_uid and an.town is not null; exception when others then v_t := 0; end;
  begin
    select count(*)::int into v_e from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.user_id = p_uid and p.answer = 'yes' and i.creator <> p_uid and i.starts_at < now();
  exception when others then v_e := 0; end;
  select coalesce(jsonb_agg(um.medal order by um.earned_at desc), '[]'::jsonb) into v_md
    from public.user_medals um where um.user_id = p_uid;
  return jsonb_build_object('mer', v_m, 'r', coalesce(v_r, 1), 'n', coalesce(v_n, 42), 'title', v_title,
    'next_title', v_next, 'next_at', v_next_at, 's', v_s, 'b', v_b, 't', v_t, 'e', v_e, 'm', v_md);
end; $$;

-- Validate + clean a spec for one user. Raises invalid_avatar / locked.
create or replace function public.olnu_avatar_clean(p_uid uuid, p_spec jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_max jsonb := public.olnu_avatar_max();
  v_locks jsonb := public.olnu_avatar_locks();
  v_f jsonb := public.olnu_avatar_facts(p_uid);
  v_out jsonb := jsonb_build_object('v', 1);
  k text; val jsonb; n int; lk jsonb; md jsonb := '[]'::jsonb; x jsonb;
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or octet_length(p_spec::text) > 1024 then
    raise exception 'invalid_avatar';
  end if;
  for k, val in select * from jsonb_each(p_spec) loop
    if k = 'v' then continue; end if;
    if k = 'md' then
      if jsonb_typeof(val) <> 'array' or jsonb_array_length(val) > 6 then raise exception 'invalid_avatar'; end if;
      for x in select * from jsonb_array_elements(val) loop
        if jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 24 or (x #>> '{}') in ('het', 'medevac')
           or not (v_f->'m') ? (x #>> '{}') then raise exception 'invalid_avatar'; end if;
        if not md ? (x #>> '{}') then md := md || jsonb_build_array(x); end if;
      end loop;
      continue;
    end if;
    if not v_max ? k or jsonb_typeof(val) <> 'number' then raise exception 'invalid_avatar'; end if;
    n := (val #>> '{}')::numeric::int;
    if n::numeric <> (val #>> '{}')::numeric or n < 0 or n > (v_max->>k)::int then raise exception 'invalid_avatar'; end if;
    lk := v_locks->(k || ':' || n);
    if lk is not null then
      if (lk ? 'r' and coalesce((v_f->>'r')::int, 1) < (lk->>'r')::int)
         or (lk ? 'm' and not (v_f->'m') ? (lk->>'m'))
         or (lk ? 's' and coalesce((v_f->>'s')::int, 0) < (lk->>'s')::int)
         or (lk ? 'b' and coalesce((v_f->>'b')::int, 0) < (lk->>'b')::int)
         or (lk ? 't' and coalesce((v_f->>'t')::int, 0) < (lk->>'t')::int)
         or (lk ? 'e' and coalesce((v_f->>'e')::int, 0) < (lk->>'e')::int) then
        raise exception 'locked';
      end if;
    end if;
    v_out := v_out || jsonb_build_object(k, n);
  end loop;
  if jsonb_array_length(md) > 0 then v_out := v_out || jsonb_build_object('md', md); end if;
  return v_out;
end; $$;

-- What other people see of one user: spec (or null), seed, rank index, medal ids for the chest (max 6).
create or replace function public.olnu_avatar_pub(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_spec jsonb; v_r int := 1; v_md jsonb := '[]'::jsonb;
begin
  select a.spec into v_spec from public.avatars a where a.user_id = p_uid;
  begin select ro.idx into v_r from public.olnu_rank_of(coalesce(public.olnu_meriter(p_uid), 0)) ro; exception when others then v_r := 1; end;
  if coalesce((v_spec->>'ms')::int, 1) = 1 then
    if jsonb_typeof(v_spec->'md') = 'array' and jsonb_array_length(v_spec->'md') > 0 then
      -- pinned medals the user still owns (always true: medals are never taken back)
      select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_md
        from jsonb_array_elements_text(v_spec->'md') with ordinality t(x, o)
       where exists (select 1 from public.user_medals um where um.user_id = p_uid and um.medal = t.x);
    else
      select coalesce(jsonb_agg(z.medal order by z.earned_at desc), '[]'::jsonb) into v_md
        from (select um.medal, um.earned_at from public.user_medals um
               where um.user_id = p_uid and um.medal not in ('het', 'medevac')
               order by um.earned_at desc limit 5) z;
    end if;
  end if;
  return jsonb_build_object('seed', public.olnu_avatar_seed(p_uid), 'a', v_spec, 'r', coalesce(v_r, 1), 'md', v_md);
end; $$;

-- my_avatar() -> {v, spec|null, seed, facts:{mer, r, n, title, next_title, next_at, s, b, t, e, m:[medal ids]}}
create or replace function public.my_avatar()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_spec jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select a.spec into v_spec from public.avatars a where a.user_id = v_uid;
  return jsonb_build_object('v', 1, 'spec', v_spec, 'seed', public.olnu_avatar_seed(v_uid),
                            'facts', public.olnu_avatar_facts(v_uid));
end; $$;

-- set_my_avatar(p_spec) -> {ok, spec}. Errors: invalid_avatar, locked, slow_down (1 save / 2 s).
create or replace function public.set_my_avatar(p_spec jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_clean jsonb; v_at timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select a.updated_at into v_at from public.avatars a where a.user_id = v_uid;
  if v_at is not null and v_at > now() - interval '2 seconds' then raise exception 'slow_down'; end if;
  v_clean := public.olnu_avatar_clean(v_uid, p_spec);
  insert into public.avatars(user_id, spec, updated_at) values (v_uid, v_clean, now())
  on conflict (user_id) do update set spec = excluded.spec, updated_at = now();
  return jsonb_build_object('ok', true, 'spec', v_clean);
end; $$;

-- avatars_for(p_group_id) -> {v, people:[{k, name, is_me, seed, a, r, md}]}
--   group / event chat / DM: everyone the caller may see in that chat (members, DM pair, live senders);
--   name = the same name group_msgs gives (display name, or friend name in temp/DM chats); k = 0030 member key.
--   null: me + my accepted friends; k = friend_list key (olnu_inv_key).
create or replace function public.avatars_for(p_group_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v jsonb; v_temp boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_group_id is null then
    with u as (
      select v_uid as uid
      union
      select case when f.a = v_uid then f.b else f.a end from public.friendships f
       where (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
      limit 300
    )
    select coalesce(jsonb_agg(jsonb_build_object('k', case when u.uid = v_uid then 'me' else public.olnu_inv_key(v_uid, u.uid) end,
             'name', public.olnu_friend_name(u.uid), 'is_me', u.uid = v_uid) || public.olnu_avatar_pub(u.uid)), '[]'::jsonb)
      into v from u where u.uid is not null;
    return jsonb_build_object('v', 1, 'people', v);
  end if;
  if not public.olnu_chat_can(p_group_id, v_uid, false) then raise exception 'not_member'; end if;
  v_temp := public.olnu_is_temp_group(p_group_id);
  with u as (
    select m.user_id as uid from public.group_members m where m.group_id = p_group_id
    union select t.a from public.dm_threads t where t.group_id = p_group_id
    union select t.b from public.dm_threads t where t.group_id = p_group_id
    union select gm.user_id from public.group_msgs gm where gm.group_id = p_group_id and gm.expires_at > now()
    union select v_uid
    limit 200
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_chief_k(p_group_id, u.uid),
           'name', coalesce((select mm.display_name from public.group_members mm where mm.group_id = p_group_id and mm.user_id = u.uid),
                            case when v_temp then public.olnu_friend_name(u.uid) end),
           'is_me', u.uid = v_uid) || public.olnu_avatar_pub(u.uid)), '[]'::jsonb)
    into v from u where u.uid is not null;
  return jsonb_build_object('v', 1, 'people', v);
end; $$;

revoke all on function public.olnu_avatar_facts(uuid) from public, anon, authenticated;
revoke all on function public.olnu_avatar_clean(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.olnu_avatar_pub(uuid) from public, anon, authenticated;
revoke all on function public.my_avatar() from public, anon;
revoke all on function public.set_my_avatar(jsonb) from public, anon;
revoke all on function public.avatars_for(uuid) from public, anon;
grant execute on function public.my_avatar() to authenticated;
grant execute on function public.set_my_avatar(jsonb) to authenticated;
grant execute on function public.avatars_for(uuid) to authenticated;
