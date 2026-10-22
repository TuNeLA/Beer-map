-- Öl Nu — 💬 PRIVATA MEDDELANDEN part 2: RPCs (CONTRACT "💬 MEDDELANDEN"). Additive only. Safe to run again.
-- Never user ids out. Targets: a friend_list key (0080 olnu_inv_key), a group member key (0030 olnu_chief_k) or a
-- map pin id (olnu_resolve_pin). Only friends (accepted friendship or a shared real group) can be messaged.
-- Needs 0136.

-- Thread json for a viewer (caller checked by the callers).
create or replace function public.olnu_dm_json(p_gid uuid, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_o uuid := public.olnu_dm_other(p_gid, p_uid);
  v_me public.dm_state;
  v_ot public.dm_state;
begin
  if v_o is null then return null; end if;
  select * into v_me from public.dm_state s where s.group_id = p_gid and s.user_id = p_uid;
  select * into v_ot from public.dm_state s where s.group_id = p_gid and s.user_id = v_o;
  return jsonb_build_object(
    'group_id', p_gid,
    'name', coalesce(left(public.olnu_friend_name(v_o), 40), '?'),
    'home_town', public.olnu_home_town(v_o),
    'can_write', public.olnu_dm_access(p_gid, p_uid) = 'write',
    'friends', public.olnu_dm_friends(p_uid, v_o),
    'blocked_by_me', exists (select 1 from public.dm_blocks k where k.blocker = p_uid and k.blocked = v_o and k.active),
    'blocked_me', exists (select 1 from public.dm_blocks k where k.blocker = v_o and k.blocked = p_uid and k.active),
    'muted', coalesce(v_me.muted, false),
    'my_seen_id', coalesce(v_me.seen_id, 0),
    -- "Sett": hidden while a block is on (either way)
    'other_seen_id', case when public.olnu_dm_blocked(p_uid, v_o) then 0 else coalesce(v_ot.seen_id, 0) end,
    'other_seen_at', case when public.olnu_dm_blocked(p_uid, v_o) then null else v_ot.seen_at end);
end; $$;

-- Open (or make) the 1:1 chat with a friend. One of p_key | p_group_id + p_k | p_pin.
create or replace function public.dm_open(p_key text default null, p_group_id uuid default null, p_k text default null,
                                          p_pin text default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_o uuid;
  v_gid uuid;
  v_code text;
  v_try int := 0;
  v_beer bigint;
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  if nullif(btrim(coalesce(p_key, '')), '') is not null then
    select c.uid into v_o from public.olnu_inv_cands(v_uid) c where c.k = btrim(p_key) limit 1;
  elsif p_group_id is not null and nullif(btrim(coalesce(p_k, '')), '') is not null then
    if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    select m.user_id into v_o from public.group_members m
     where m.group_id = p_group_id and public.olnu_chief_k(p_group_id, m.user_id) = btrim(p_k) limit 1;
  elsif nullif(btrim(coalesce(p_pin, '')), '') is not null then
    v_beer := public.olnu_resolve_pin(v_uid, p_pin);
    if v_beer is not null then select b.user_id into v_o from public.beers b where b.id = v_beer; end if;
  end if;
  if v_o is null or v_o = v_uid then raise exception 'invalid_target'; end if;

  select t.group_id into v_gid from public.dm_threads t where t.a = least(v_uid, v_o) and t.b = greatest(v_uid, v_o);
  if v_gid is not null then return public.olnu_dm_json(v_gid, v_uid); end if;

  if not public.olnu_dm_friends(v_uid, v_o) then raise exception 'not_friends'; end if;
  if public.olnu_dm_blocked(v_uid, v_o) then raise exception 'blocked'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_dm:' || least(v_uid, v_o)::text || greatest(v_uid, v_o)::text, 0));
  select t.group_id into v_gid from public.dm_threads t where t.a = least(v_uid, v_o) and t.b = greatest(v_uid, v_o);
  if v_gid is not null then return public.olnu_dm_json(v_gid, v_uid); end if;
  if (select count(*) from public.dm_threads t where t.created_by = v_uid and t.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'slow_down';
  end if;
  loop
    v_try := v_try + 1;
    v_code := '';
    for k in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * 32)::int, 1);
    end loop;
    insert into public.groups (name, code, created_by) values ('💬 Direkt', v_code, null)
    on conflict (code) do nothing
    returning id into v_gid;
    exit when v_gid is not null;
    if v_try >= 20 then raise exception 'slow_down'; end if;
  end loop;
  insert into public.dm_threads (group_id, a, b, created_by) values (v_gid, least(v_uid, v_o), greatest(v_uid, v_o), v_uid);
  insert into public.dm_state (group_id, user_id) values (v_gid, v_uid), (v_gid, v_o) on conflict do nothing;
  return public.olnu_dm_json(v_gid, v_uid);
end; $$;

-- My threads (newest activity first, max 50): only threads with a live message, or that I opened in the last hour.
create or replace function public.my_dms()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
  v_n int;
begin
  with t as (
    select d.group_id, d.created_by, d.created_at,
           case when d.a = v_uid then d.b else d.a end as other
      from public.dm_threads d where d.a = v_uid or d.b = v_uid
  ), x as (
    select t.*, lm.id as last_id, lm.body as last_body, lm.created_at as last_at, lm.user_id = v_uid as last_me,
           coalesce(s.seen_id, 0) as my_seen, coalesce(s.muted, false) as muted
      from t
      left join lateral (select m.id, m.body, m.created_at, m.user_id from public.group_msgs m
                          where m.group_id = t.group_id and m.expires_at > now() order by m.id desc limit 1) lm on true
      left join public.dm_state s on s.group_id = t.group_id and s.user_id = v_uid
     where lm.id is not null or (t.created_by = v_uid and t.created_at > now() - interval '1 hour')
     order by coalesce(lm.created_at, t.created_at) desc
     limit 50
  ), y as (
    select x.*, (select count(*) from (select 1 from public.group_msgs m
                   where m.group_id = x.group_id and m.expires_at > now() and m.user_id <> v_uid and m.id > x.my_seen limit 99) z)::int as unread
      from x
  )
  select coalesce(jsonb_agg(public.olnu_dm_json(y.group_id, v_uid) || jsonb_build_object(
           'last_id', y.last_id, 'last_body', left(y.last_body, 80), 'last_at', y.last_at, 'last_me', coalesce(y.last_me, false),
           'unread', y.unread, 'at', coalesce(y.last_at, y.created_at), 'out', coalesce((select po.is_out from public.olnu_friend_out(y.other) po limit 1), false))
         order by coalesce(y.last_at, y.created_at) desc), '[]'::jsonb),
         coalesce(sum(y.unread), 0)::int
    into v, v_n from y;
  return jsonb_build_object('v', 1, 'now', now(), 'unread', v_n, 'threads', v);
end; $$;

-- "Sett" + state poll while the chat is open: marks my seen id (never beyond the newest live message).
create or replace function public.dm_seen(p_group_id uuid, p_last_id bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_max bigint;
begin
  if public.olnu_dm_other(p_group_id, v_uid) is null then raise exception 'not_member'; end if;
  if coalesce(p_last_id, 0) > 0 then
    select max(m.id) into v_max from public.group_msgs m where m.group_id = p_group_id and m.id <= p_last_id;
    if v_max is not null then
      insert into public.dm_state as s (group_id, user_id, seen_id, seen_at) values (p_group_id, v_uid, v_max, now())
      on conflict (group_id, user_id) do update set seen_id = v_max, seen_at = now(), updated_at = now()
       where s.seen_id < v_max;
    end if;
  end if;
  return public.olnu_dm_json(p_group_id, v_uid);
end; $$;

-- 🚫 Blockera / Avblockera the other person of a thread.
create or replace function public.dm_block(p_group_id uuid, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_o uuid := public.olnu_dm_other(p_group_id, v_uid);
begin
  if v_o is null then raise exception 'not_member'; end if;
  if (select count(*) from public.dm_blocks k where k.blocker = v_uid and k.updated_at > now() - interval '1 minute') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into public.dm_blocks as k (blocker, blocked, active) values (v_uid, v_o, coalesce(p_on, true))
  on conflict (blocker, blocked) do update set active = coalesce(p_on, true), updated_at = now();
  return public.olnu_dm_json(p_group_id, v_uid);
end; $$;

-- 🔕 Tysta (no pushes for this thread).
create or replace function public.dm_mute(p_group_id uuid, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if public.olnu_dm_other(p_group_id, v_uid) is null then raise exception 'not_member'; end if;
  insert into public.dm_state as s (group_id, user_id, muted) values (p_group_id, v_uid, coalesce(p_on, true))
  on conflict (group_id, user_id) do update set muted = coalesce(p_on, true), updated_at = now();
  return public.olnu_dm_json(p_group_id, v_uid);
end; $$;

-- notify-group (service_role): who gets the push for a DM message / voice, and the sender's name.
-- {dm:false} = not a DM (the caller goes on as before); to = [] when the sender may not write or the other muted.
create or replace function public.dm_push_target(p_gid uuid, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_o uuid;
begin
  if not public.olnu_dm_is(p_gid) then return jsonb_build_object('dm', false); end if;
  v_o := public.olnu_dm_other(p_gid, p_uid);
  if v_o is null then return jsonb_build_object('dm', true, 'to', '[]'::jsonb, 'reason', 'not_member'); end if;
  if public.olnu_dm_access(p_gid, p_uid) <> 'write' then return jsonb_build_object('dm', true, 'to', '[]'::jsonb, 'reason', 'dm_closed'); end if;
  if exists (select 1 from public.dm_state s where s.group_id = p_gid and s.user_id = v_o and s.muted) then
    return jsonb_build_object('dm', true, 'to', '[]'::jsonb, 'reason', 'muted');
  end if;
  return jsonb_build_object('dm', true, 'to', jsonb_build_array(v_o),
    'name', coalesce(left(public.olnu_friend_name(p_uid), 24), 'Nån'));
end; $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_dm_json(uuid, uuid)';
  v_rpcs text := 'public.dm_open(text, uuid, text, text, text), public.my_dms(), public.dm_seen(uuid, bigint), '
    || 'public.dm_block(uuid, boolean), public.dm_mute(uuid, boolean)';
  v_svc text := 'public.dm_push_target(uuid, uuid)';
begin
  execute 'revoke all on function ' || v_helpers || ', ' || v_rpcs || ', ' || v_svc || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_helpers || ', ' || v_rpcs || ', ' || v_svc || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_helpers || ', ' || v_svc || ' from authenticated';
    execute 'grant execute on function ' || v_rpcs || ' to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ' || v_svc || ' to service_role';
  end if;
end $$;
