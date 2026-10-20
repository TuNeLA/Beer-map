-- 0041 v27 SKÅLTIMMEN RPCs. Needs 0040. Push: notify-group {event:"skal_hour", hour_id}.
-- Random mode ("slumpad skåltimme"): no pg_cron. The first skal_poll() of a night by any member of a group with
-- random_on picks the secret moment (uniform 20:00-01:00 Europe/Stockholm; when the night's first poll comes after
-- 20:00: uniform from now + 2 min to 01:00). The first skal_poll() by any member after that moment fires it
-- (advisory lock, idempotent) and that member's app sends the push. Nothing runs for groups that nobody opens.
-- SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only. Rows are never removed.

-- Full skåltimme json for p_uid. Photos (photo_id) only when p_uid has posted in this skåltimme.
create or replace function public.olnu_skal_json(h public.skal_hours, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
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
$$;

-- Group block for p_uid: powers, random mode, limits, the newest skåltimme of the last 2 h.
create or replace function public.olnu_skal_state_json(p_group uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with last as (
    select x.* from public.skal_hours x where x.group_id = p_group order by x.created_at desc, x.id desc limit 1
  )
  select jsonb_build_object(
    'group_id', p_group,
    'can_start', public.olnu_skal_can(p_group, p_uid),
    'random_on', coalesce((select s.random_on from public.skal_settings s where s.group_id = p_group), false),
    'used', (select count(*) from public.skal_hours x where x.group_id = p_group and x.created_at >= public.olnu_skal_from())::int,
    'max', 4,
    'next_at', greatest(now(), coalesce((select l.created_at + interval '30 minutes' from last l), now())),
    'win_from', public.olnu_skal_win_from(public.olnu_night_of(now())),
    'win_to', public.olnu_skal_win_to(public.olnu_night_of(now())),
    'now', now(),
    'hour', (select public.olnu_skal_json(l, p_uid) from last l where l.created_at > now() - interval '2 hours'));
$$;

-- Insert a skåltimme when the limits allow it. Caller holds the group lock. Returns the row or null.
create or replace function public.olnu_skal_insert(p_group uuid, p_starter uuid, p_fired_by uuid, p_auto boolean)
returns public.skal_hours language plpgsql security definer set search_path = public as $$
declare
  h public.skal_hours;
begin
  if exists (select 1 from public.skal_hours x where x.group_id = p_group and x.created_at > now() - interval '30 minutes') then
    return null;
  end if;
  if (select count(*) from public.skal_hours x where x.group_id = p_group and x.created_at >= public.olnu_skal_from()) >= 4 then
    return null;
  end if;
  insert into public.skal_hours (group_id, started_by, fired_by, auto, night, created_at, ends_at)
  values (p_group, p_starter, p_fired_by, p_auto, public.olnu_night_of(now()), now(), now() + interval '3 minutes')
  returning * into h;
  return h;
end; $$;

-- Random mode for one group, called from skal_poll by a member. Makes tonight's plan, fires it when due.
create or replace function public.olnu_skal_auto(p_group uuid, p_uid uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_night timestamptz := public.olnu_night_of(now());
  v_from  timestamptz := public.olnu_skal_win_from(public.olnu_night_of(now()));
  v_to    timestamptz := public.olnu_skal_win_to(public.olnu_night_of(now()));
  v_at    timestamptz;
  p       public.skal_plans;
  h       public.skal_hours;
  v_last  timestamptz;
begin
  if now() >= v_to then return null; end if;
  select * into p from public.skal_plans x where x.group_id = p_group and x.night = v_night;
  if not found then
    if now() < v_from then
      v_at := v_from + random() * (v_to - v_from);
    else
      v_at := now() + interval '2 minutes' + random() * greatest(v_to - now() - interval '2 minutes', interval '0 seconds');
    end if;
    insert into public.skal_plans (group_id, night, plan_at) values (p_group, v_night, v_at)
    on conflict (group_id, night) do nothing;
    select * into p from public.skal_plans x where x.group_id = p_group and x.night = v_night;
  end if;
  if p.hour_id is not null or now() < p.plan_at then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_skal:' || p_group::text, 0));
  select * into p from public.skal_plans x where x.group_id = p_group and x.night = v_night;
  if p.hour_id is not null then return null; end if;
  h := public.olnu_skal_insert(p_group, null, p_uid, true);
  if h.id is not null then
    update public.skal_plans x set hour_id = h.id where x.group_id = p_group and x.night = v_night;
    return h.id;
  end if;
  -- Blocked by a limit: after a skåltimme in the last 30 min, try again 31 min after it (while in the window);
  -- 4 tonight already (or past 01:00), skip.
  select max(x.created_at) into v_last from public.skal_hours x where x.group_id = p_group and x.created_at > now() - interval '30 minutes';
  if v_last is not null and v_last + interval '31 minutes' < v_to
     and (select count(*) from public.skal_hours x where x.group_id = p_group and x.created_at >= public.olnu_skal_from()) < 4 then
    update public.skal_plans x set plan_at = v_last + interval '31 minutes' where x.group_id = p_group and x.night = v_night;
  else
    update public.skal_plans x set hour_id = 0 where x.group_id = p_group and x.night = v_night;
  end if;
  return null;
end; $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- skal_poll() -> jsonb {v, now, hours:[skåltimme json, my groups, last 70 min, newest first], fired:[ids to push]}.
-- Also runs the random mode for my groups (see the file head). fired = auto skåltimmar this call (or an earlier call
-- of mine in the last 3 min) created and nobody has pushed yet: the client sends notify-group {event:"skal_hour"}.
create or replace function public.skal_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  g record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  for g in select m.group_id from public.group_members m
             join public.skal_settings s on s.group_id = m.group_id and s.random_on
            where m.user_id = v_uid loop
    perform public.olnu_skal_auto(g.group_id, v_uid);
  end loop;
  return jsonb_build_object('v', 1, 'now', now(),
    'hours', coalesce((select jsonb_agg(public.olnu_skal_json(h, v_uid) order by h.created_at desc)
                         from public.skal_hours h
                         join public.group_members m on m.group_id = h.group_id and m.user_id = v_uid
                        where h.created_at > now() - interval '70 minutes'), '[]'::jsonb),
    'fired', coalesce((select jsonb_agg(h.id) from public.skal_hours h
                        where h.fired_by = v_uid and h.auto and not h.notified and h.created_at > now() - interval '3 minutes'), '[]'::jsonb));
end; $$;

-- skal_state(p_group_id) -> jsonb {group_id, can_start, random_on, used, max, next_at, win_from, win_to, now, hour}.
create or replace function public.skal_state(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return public.olnu_skal_state_json(p_group_id, v_uid);
end; $$;

-- skal_start(p_group_id) -> skåltimme json. Errors: not_member, not_allowed, skal_slow (30 min), skal_limit (4 per night).
create or replace function public.skal_start(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  h public.skal_hours;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if not public.olnu_skal_can(p_group_id, v_uid) then raise exception 'not_allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_skal:' || p_group_id::text, 0));
  if (select count(*) from public.skal_hours x where x.group_id = p_group_id and x.created_at >= public.olnu_skal_from()) >= 4 then
    raise exception 'skal_limit';
  end if;
  if exists (select 1 from public.skal_hours x where x.group_id = p_group_id and x.created_at > now() - interval '30 minutes') then
    raise exception 'skal_slow';
  end if;
  h := public.olnu_skal_insert(p_group_id, v_uid, v_uid, false);
  if h.id is null then raise exception 'skal_slow'; end if;
  return public.olnu_skal_json(h, v_uid);
end; $$;

-- skal_set_random(p_group_id, p_on) -> skal_state json. Errors: not_member, not_allowed, slow_down (1 per 3 s).
create or replace function public.skal_set_random(p_group_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if not public.olnu_skal_can(p_group_id, v_uid) then raise exception 'not_allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_skal_set:' || p_group_id::text, 0));
  if exists (select 1 from public.skal_settings s where s.group_id = p_group_id and s.changed_at > now() - interval '3 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.skal_settings as s (group_id, random_on, changed_by, changed_at)
  values (p_group_id, coalesce(p_on, false), v_uid, now())
  on conflict (group_id) do update set random_on = coalesce(p_on, false), changed_by = v_uid, changed_at = now();
  return public.olnu_skal_state_json(p_group_id, v_uid);
end; $$;

-- skal_hour(p_hour_id) -> skåltimme json (≤ 12 h old). Errors: skal_not_found, not_member.
create or replace function public.skal_hour(p_hour_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  h public.skal_hours;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into h from public.skal_hours x where x.id = p_hour_id and x.created_at > now() - interval '12 hours';
  if not found then raise exception 'skal_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = h.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return public.olnu_skal_json(h, v_uid);
end; $$;

-- skal_post(p_hour_id, p_b64, p_w, p_h) -> jsonb {photo_id, rank, in_time, sec, pts, hour}.
-- One photo per member per skåltimme; in time = within 3 min; late posts are taken until 60 min after the start.
-- Errors: skal_not_found, not_member, skal_closed, skal_posted, invalid_photo.
create or replace function public.skal_post(p_hour_id bigint, p_b64 text, p_w int default 0, p_h int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public.olnu_uid();
  h      public.skal_hours;
  v_ph   record;
  v_pid  bigint;
  v_rank int;
  v_in   boolean;
  v_sec  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into h from public.skal_hours x where x.id = p_hour_id and x.created_at > now() - interval '12 hours';
  if not found then raise exception 'skal_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = h.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if now() > h.created_at + interval '60 minutes' then raise exception 'skal_closed'; end if;
  select * into v_ph from public.olnu_snap_decode(p_b64, p_w, p_h);
  perform pg_advisory_xact_lock(hashtextextended('olnu_skal_p:' || p_hour_id::text, 0));
  if exists (select 1 from public.skal_hour_posts p where p.hour_id = p_hour_id and p.user_id = v_uid) then
    raise exception 'skal_posted';
  end if;
  perform public.olnu_snap_sweep();
  insert into public.snap_photos (kind, group_id, user_id, ref_id, night, mime, bytes, size, w, h, expires_at)
  values ('skal', h.group_id, v_uid, h.id, h.night, v_ph.o_mime, v_ph.o_bytes, octet_length(v_ph.o_bytes), p_w, p_h,
          public.olnu_snap_exp('skal', h.group_id, h.night, null))
  returning id into v_pid;
  v_in := now() <= h.ends_at;
  v_sec := greatest(0, floor(extract(epoch from (now() - h.created_at))))::int;
  select count(*)::int + 1 into v_rank from public.skal_hour_posts p where p.hour_id = p_hour_id;
  insert into public.skal_hour_posts (hour_id, user_id, group_id, night, photo_id, created_at, sec, in_time, rank, pts)
  values (h.id, v_uid, h.group_id, h.night, v_pid, now(), v_sec, v_in, v_rank, case when v_in then 5 else 0 end);
  return jsonb_build_object('photo_id', v_pid, 'rank', v_rank, 'in_time', v_in, 'sec', v_sec,
    'pts', case when v_in then 5 else 0 end, 'hour', public.olnu_skal_json(h, v_uid));
end; $$;

-- skal_photo(p_photo_id) -> jsonb {id, mime, w, h, b64}. Only for a member who posted in that skåltimme.
-- Errors: photo_not_found, not_member, skal_locked.
create or replace function public.skal_photo(p_photo_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.snap_photos sp
   where sp.id = p_photo_id and sp.kind = 'skal' and sp.bytes is not null and sp.expires_at > now();
  if not found then raise exception 'photo_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if not exists (select 1 from public.skal_hour_posts p where p.hour_id = v_row.ref_id and p.user_id = v_uid) then
    raise exception 'skal_locked';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end; $$;

do $$
declare
  v_h text := 'public.olnu_skal_json(public.skal_hours, uuid), public.olnu_skal_state_json(uuid, uuid), '
    || 'public.olnu_skal_insert(uuid, uuid, uuid, boolean), public.olnu_skal_auto(uuid, uuid)';
  v_r text := 'public.skal_poll(), public.skal_state(uuid), public.skal_start(uuid), public.skal_set_random(uuid, boolean), '
    || 'public.skal_hour(bigint), public.skal_post(bigint, text, integer, integer), public.skal_photo(bigint)';
begin
  execute 'revoke all on function ' || v_h || ' from public';
  execute 'revoke all on function ' || v_r || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_h || ' from anon';
    execute 'revoke all on function ' || v_r || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_h || ' from authenticated';
    execute 'grant execute on function ' || v_r || ' to authenticated';
  end if;
end $$;
