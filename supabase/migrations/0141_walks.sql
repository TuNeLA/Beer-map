-- Öl Nu — 🏠 FÖLJ MIG HEM (live walk home; CONTRACT "📸 KROGBILDER · ☀️ UTEVÄDER · 🏠 FÖLJ MIG HEM · 🔍 HITTA KOMPIS").
-- Additive only. Needs 0001 (olnu_uid, groups, group_members, group_msgs), 0045 (olnu_friend_name, olnu_friend_setname),
-- 0080 (olnu_inv_resolve: friends + group-mates only, never a stranger), olnu_next_expiry.
-- Rows are never removed: a walk ends with ended_at / end_reason; the position is cleared (set to null) when it ends.
-- Privacy:
--   * Only the people the walker picks (friends / members of a shared group, max 30) see the walk.
--   * The home point is stored rounded to 3 decimals (≈ 110 m), so viewers see roughly where it ends, never the door.
--   * The live position is ONE row per walk, overwritten (no track history), and cleared when the walk ends.
--   * Max 2 h. A walk that is not pinged for 15 min counts as over for viewers ("📡 signal lost"), ends at 2 h.
--   * "Radera allt om mig" (0016 sweep moves user_id): trigger ends the walk and clears the points.

create table if not exists public.walks (
  id            bigserial primary key,
  user_id       uuid not null,
  group_id      uuid,
  viewers       uuid[] not null default '{}',
  home_lat      double precision,
  home_lng      double precision,
  started_at    timestamptz not null default now(),
  ends_at       timestamptz not null,
  ended_at      timestamptz,
  end_reason    text check (end_reason is null or end_reason in ('home', 'stop', 'timeout', 'replaced')),
  lat           double precision,
  lng           double precision,
  acc           int,
  pos_at        timestamptz,
  start_dist    int,
  notified      boolean not null default false,
  home_notified boolean not null default false,
  msg_id        bigint
);
create index if not exists walks_user_idx on public.walks (user_id, started_at desc);
create index if not exists walks_live_idx on public.walks (ends_at) where ended_at is null;
create index if not exists walks_viewers_idx on public.walks using gin (viewers);

create table if not exists public.walk_views (
  walk_id  bigint not null references public.walks (id),
  user_id  uuid not null,
  seen_at  timestamptz not null default now(),
  primary key (walk_id, user_id)
);

alter table public.walks enable row level security;
alter table public.walk_views enable row level security;
revoke all on public.walks, public.walk_views from anon, authenticated;
revoke all on sequence public.walks_id_seq from anon, authenticated;
grant all on public.walks, public.walk_views to service_role;
grant usage, select on sequence public.walks_id_seq to service_role;

create or replace function public.olnu_walk_anon_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id then
    new.ended_at := coalesce(new.ended_at, now());
    new.end_reason := coalesce(new.end_reason, 'stop');
    new.lat := null; new.lng := null; new.acc := null; new.home_lat := null; new.home_lng := null;
  end if;
  return new;
end; $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'walks_anon') then
    create trigger walks_anon before update of user_id on public.walks for each row execute function public.olnu_walk_anon_tg();
  end if;
end $$;

-- Ends walks that ran past 2 h (called by every walk RPC; cheap: partial index).
create or replace function public.olnu_walk_sweep()
returns void language sql security definer set search_path = public as $$
  update public.walks set ended_at = ends_at, end_reason = 'timeout', lat = null, lng = null, acc = null
   where ended_at is null and ends_at < now();
$$;

create or replace function public.olnu_walk_name(p_uid uuid, p_group uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid),
    public.olnu_friend_name(p_uid), 'En kompis');
$$;

-- The walker's own view.
create or replace function public.olnu_walk_mine(w public.walks)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', w.id, 'live', w.ended_at is null and w.ends_at > now(),
    'started_at', w.started_at, 'ends_at', w.ends_at, 'ended_at', w.ended_at, 'end_reason', w.end_reason,
    'group_id', w.group_id, 'group_name', (select g.name from public.groups g where g.id = w.group_id),
    'n', coalesce(array_length(w.viewers, 1), 0),
    'watching', (select count(*) from public.walk_views v where v.walk_id = w.id and v.seen_at > now() - interval '90 seconds'),
    'seen_by', (select count(*) from public.walk_views v where v.walk_id = w.id),
    'pos_at', w.pos_at, 'msg_id', w.msg_id);
$$;

-- walk_start(...) → mine json. p_keys = friend_list keys, p_group_ids = whole groups; p_group_id = where "✅ Hemma!" is posted.
create or replace function public.walk_start(
  p_home_lat double precision, p_home_lng double precision,
  p_keys text[] default '{}', p_group_ids uuid[] default '{}', p_group_id uuid default null,
  p_lat double precision default null, p_lng double precision default null, p_acc double precision default null,
  p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_to uuid[]; v_gid uuid := p_group_id; v_id bigint; w public.walks; v_ok boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  if p_home_lat is null or p_home_lng is null or p_home_lat <> p_home_lat or p_home_lng <> p_home_lng
     or abs(p_home_lat) > 85 or abs(p_home_lng) > 180 then
    raise exception 'invalid_home';
  end if;
  v_ok := p_lat is not null and p_lng is not null and p_lat = p_lat and p_lng = p_lng and abs(p_lat) <= 85 and abs(p_lng) <= 180;
  perform pg_advisory_xact_lock(hashtextextended('olnu-walk:' || v_uid::text, 0));
  if exists (select 1 from public.walks x where x.user_id = v_uid and x.started_at > now() - interval '10 seconds')
     or (select count(*) from public.walks x where x.user_id = v_uid and x.started_at > now() - interval '12 hours') >= 8 then
    raise exception 'slow_down';
  end if;
  v_to := public.olnu_inv_resolve(v_uid, p_keys, p_group_ids);
  if coalesce(array_length(v_to, 1), 0) = 0 then raise exception 'no_viewers'; end if;
  if array_length(v_to, 1) > 30 then raise exception 'too_many'; end if;
  if v_gid is null and coalesce(array_length(p_group_ids, 1), 0) = 1 then v_gid := p_group_ids[1]; end if;
  if v_gid is not null and (public.olnu_is_temp_group(v_gid)
       or not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid)) then
    v_gid := null;
  end if;
  perform public.olnu_walk_sweep();
  update public.walks set ended_at = now(), end_reason = 'replaced', lat = null, lng = null, acc = null
   where user_id = v_uid and ended_at is null;
  insert into public.walks (user_id, group_id, viewers, home_lat, home_lng, ends_at, lat, lng, acc, pos_at, start_dist)
  values (v_uid, v_gid, v_to, round(p_home_lat::numeric, 3)::float8, round(p_home_lng::numeric, 3)::float8,
          now() + interval '2 hours',
          case when v_ok then round(p_lat::numeric, 5)::float8 end, case when v_ok then round(p_lng::numeric, 5)::float8 end,
          case when v_ok and p_acc is not null and p_acc = p_acc then least(9999, greatest(0, round(p_acc)))::int end,
          case when v_ok then now() end,
          case when v_ok then least(2000000, round(public.olnu_bp_m(p_lat, p_lng, p_home_lat, p_home_lng)))::int end)
  returning * into w;
  return public.olnu_walk_mine(w);
end; $$;

-- walk_ping(p_id, lat, lng, acc) → {ok, live, ends_at, watching, n}. Overwrites the one position (max every 2 s).
create or replace function public.walk_ping(p_id bigint, p_lat double precision, p_lng double precision, p_acc double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); w public.walks;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_lat is null or p_lng is null or p_lat <> p_lat or p_lng <> p_lng or abs(p_lat) > 85 or abs(p_lng) > 180 then
    raise exception 'invalid_position';
  end if;
  perform public.olnu_walk_sweep();
  select * into w from public.walks x where x.id = p_id and x.user_id = v_uid;
  if not found then raise exception 'walk_not_found'; end if;
  if w.ended_at is null and (w.pos_at is null or w.pos_at < now() - interval '2 seconds') then
    update public.walks
       set lat = round(p_lat::numeric, 5)::float8, lng = round(p_lng::numeric, 5)::float8,
           acc = case when p_acc is not null and p_acc = p_acc then least(9999, greatest(0, round(p_acc)))::int end, pos_at = now()
     where id = w.id returning * into w;
  end if;
  return public.olnu_walk_mine(w) || jsonb_build_object('ok', w.ended_at is null);
end; $$;

-- walk_end(p_id, 'home' | 'stop', p_line) → mine json + {msg_id, group_id}. 'home' posts "✅ …" to the walk's group.
create or replace function public.walk_end(p_id bigint, p_reason text default 'stop', p_line text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); w public.walks; v_r text := lower(coalesce(p_reason, 'stop'));
  v_body text; v_msg bigint; v_nm text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_r not in ('home', 'stop') then v_r := 'stop'; end if;
  select * into w from public.walks x where x.id = p_id and x.user_id = v_uid for update;
  if not found then raise exception 'walk_not_found'; end if;
  if w.ended_at is not null then return public.olnu_walk_mine(w); end if;
  if v_r = 'home' and w.group_id is not null
     and exists (select 1 from public.group_members m where m.group_id = w.group_id and m.user_id = v_uid) then
    v_nm := public.olnu_walk_name(v_uid, w.group_id);
    v_body := left(btrim(regexp_replace(coalesce(nullif(btrim(p_line), ''), '✅ {n} ä hemma! 🏠'), '[[:cntrl:]]+', ' ', 'g')), 120);
    if public.olnu_inv_haslink(v_body) or position('{n}' in v_body) = 0 then v_body := '✅ {n} ä hemma! 🏠'; end if;
    v_body := left(replace(v_body, '{n}', v_nm), 140);
    if left(v_body, 1) <> '✅' then v_body := left('✅ ' || v_body, 140); end if;
    insert into public.group_msgs (group_id, user_id, body, expires_at)
    values (w.group_id, v_uid, v_body, public.olnu_next_expiry()) returning id into v_msg;
  end if;
  update public.walks set ended_at = now(), end_reason = v_r, lat = null, lng = null, acc = null, msg_id = v_msg
   where id = w.id returning * into w;
  return public.olnu_walk_mine(w) || jsonb_build_object('group_id', w.group_id);
end; $$;

-- walk_poll() → {v, now, mine (live or ended < 10 min) | null, watching:[walks I may see: live, or ended < 15 min]}
create or replace function public.walk_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); v_mine jsonb; v_w jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_walk_sweep();
  select public.olnu_walk_mine(x) into v_mine from public.walks x
   where x.user_id = v_uid and (x.ended_at is null or x.ended_at > now() - interval '10 minutes')
   order by x.started_at desc limit 1;
  insert into public.walk_views (walk_id, user_id, seen_at)
  select x.id, v_uid, now() from public.walks x
   where v_uid = any (x.viewers) and x.ended_at is null and x.ends_at > now()
  on conflict (walk_id, user_id) do update set seen_at = excluded.seen_at;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'name', public.olnu_walk_name(x.user_id, x.group_id),
           'group_name', (select g.name from public.groups g where g.id = x.group_id),
           'live', x.ended_at is null,
           'lat', case when x.ended_at is null then x.lat end, 'lng', case when x.ended_at is null then x.lng end,
           'acc', case when x.ended_at is null then x.acc end,
           'pos_at', x.pos_at, 'age_s', case when x.pos_at is not null then extract(epoch from now() - x.pos_at)::int end,
           'home_lat', x.home_lat, 'home_lng', x.home_lng, 'start_dist', x.start_dist,
           'started_at', x.started_at, 'ends_at', x.ends_at, 'ended_at', x.ended_at, 'end_reason', x.end_reason)
         order by x.started_at desc), '[]'::jsonb)
    into v_w
    from (select * from public.walks x
           where v_uid = any (x.viewers) and x.user_id <> v_uid
             and (x.ended_at is null or x.ended_at > now() - interval '15 minutes')
           order by x.started_at desc limit 10) x;
  return jsonb_build_object('v', 1, 'now', now(), 'mine', v_mine, 'watching', v_w);
end; $$;

do $$ begin
  execute 'revoke all on function public.olnu_walk_anon_tg(), public.olnu_walk_sweep(), public.olnu_walk_name(uuid, uuid), public.olnu_walk_mine(public.walks), public.walk_start(double precision, double precision, text[], uuid[], uuid, double precision, double precision, double precision, text), public.walk_ping(bigint, double precision, double precision, double precision), public.walk_end(bigint, text, text), public.walk_poll() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_walk_anon_tg(), public.olnu_walk_sweep(), public.olnu_walk_name(uuid, uuid), public.olnu_walk_mine(public.walks), public.walk_start(double precision, double precision, text[], uuid[], uuid, double precision, double precision, double precision, text), public.walk_ping(bigint, double precision, double precision, double precision), public.walk_end(bigint, text, text), public.walk_poll() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_walk_anon_tg(), public.olnu_walk_sweep(), public.olnu_walk_name(uuid, uuid), public.olnu_walk_mine(public.walks) from authenticated';
    execute 'grant execute on function public.walk_start(double precision, double precision, text[], uuid[], uuid, double precision, double precision, double precision, text), public.walk_ping(bigint, double precision, double precision, double precision), public.walk_end(bigint, text, text), public.walk_poll() to authenticated';
  end if;
end $$;
