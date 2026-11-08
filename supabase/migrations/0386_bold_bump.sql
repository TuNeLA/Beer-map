-- 0386 (bold, owner OK 2026-11-08, flag bold_bump): 🍻 SKÅL! — two (or more) friends near each other press SKÅL at the
-- same time; the server matches the taps. Counts meetings between people, never drinks. Owner decision C: "Nära dig nu".
--   Match: taps within 3.0 s (server clock), friends (same group or accepted friendship), not blocked, and
--   distance d ≤ 30 m when both accuracies ≤ 30 m, else d ≤ min(80, accA + accB), else the same bar (both checked in there,
--   or both sent the same bar id). Taps of 3+ people in the same window match as one group.
--   Caps: 1 tap per 2 s, 40 taps per night. A pair counts once per night: +2 meriter each (kind 'bump', max 10 a night).
--   Medal progress (bold_bump_stats): unique friend-nights — brons 3, silver 10, guld 25.
--   Position of a tap: used for the match only, set to null after 10 min (at the next tap anywhere). Never shown.
--   Presence ("Nära dig nu"): one row per user, 3 min life, only friends within 50 m see a coarse distance; never in
--   spökläge (ghost) — a ghost user is not stored and sees nobody.
-- bold_bump_pairs (0383) also feeds Kvällens krog (skål at the bar). Additive only.

create table if not exists public.bold_bumps (
  id          bigserial primary key,
  user_id     uuid not null,
  night       timestamptz not null,
  at          timestamptz not null default clock_timestamp(),
  lat         double precision,
  lng         double precision,
  acc         real,
  bar_id      text,
  match_group bigint
);
create index if not exists bold_bumps_night_at on public.bold_bumps (night, at);
create index if not exists bold_bumps_user on public.bold_bumps (user_id, at);
alter table public.bold_bumps enable row level security;
revoke all on table public.bold_bumps from public, anon, authenticated;

create table if not exists public.bold_presence (
  user_id uuid primary key,
  lat     double precision,
  lng     double precision,
  acc     real,
  at      timestamptz not null default now()
);
alter table public.bold_presence enable row level security;
revoke all on table public.bold_presence from public, anon, authenticated;

-- friends = share a group, or an accepted friendship; never a blocked pair
create or replace function public.olnu_bold_friends(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select p_a is not null and p_b is not null and p_a <> p_b and not public.olnu_ub_hidden(p_a, p_b)
     and (exists (select 1 from public.group_members x join public.group_members y on y.group_id = x.group_id
                   where x.user_id = p_a and y.user_id = p_b)
          or exists (select 1 from public.friendships f where f.status = 'accepted'
                      and ((f.a = p_a and f.b = p_b) or (f.a = p_b and f.b = p_a))));
$function$;
revoke all on function public.olnu_bold_friends(uuid, uuid) from public, anon, authenticated;

create or replace function public.olnu_bold_name(p_viewer uuid, p_uid uuid)
returns text language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select min(m.display_name) from public.group_members m join public.group_members me on me.group_id = m.group_id and me.user_id = p_viewer
                    where m.user_id = p_uid), (select min(m.display_name) from public.group_members m where m.user_id = p_uid), 'Kompis');
$function$;
revoke all on function public.olnu_bold_name(uuid, uuid) from public, anon, authenticated;

create or replace function public.olnu_bold_ghost(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from public.beers b where b.user_id = p_uid and b.expires_at > now() and coalesce(b.ghost, false));
$function$;
revoke all on function public.olnu_bold_ghost(uuid) from public, anon, authenticated;

create or replace function public.bold_bump_stats()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_uid uuid := public.olnu_uid(); v_all int; v_night int; v_tier text; v_next int;
begin
  select count(*)::int into v_all from public.bold_bump_pairs p where p.a = v_uid or p.b = v_uid;
  select count(*)::int into v_night from public.bold_bump_pairs p where (p.a = v_uid or p.b = v_uid) and p.night = public.olnu_night_of(now());
  v_tier := case when v_all >= 25 then 'guld' when v_all >= 10 then 'silver' when v_all >= 3 then 'brons' else null end;
  v_next := case when v_all < 3 then 3 when v_all < 10 then 10 when v_all < 25 then 25 else null end;
  return jsonb_build_object('v', 1, 'total', v_all, 'tonight', v_night, 'tier', v_tier, 'next', v_next);
end; $function$;
revoke all on function public.bold_bump_stats() from public, anon;
grant execute on function public.bold_bump_stats() to authenticated, service_role;

create or replace function public.olnu_bold_match_json(p_uid uuid, p_group bigint)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(distinct jsonb_build_object('name', public.olnu_bold_name(p_uid, b.user_id))), '[]'::jsonb)
    from public.bold_bumps b where p_group is not null and b.match_group = p_group and b.user_id <> p_uid;
$function$;
revoke all on function public.olnu_bold_match_json(uuid, bigint) from public, anon, authenticated;

create or replace function public.bold_bump(p_lat double precision, p_lng double precision, p_acc double precision, p_bar_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_acc real := least(greatest(coalesce(p_acc, 999), 0), 999)::real;
  v_bar text := nullif(btrim(coalesce(p_bar_id, '')), '');
  v_me public.bold_bumps; v_group bigint; v_new int := 0; v_pts int := 0; c record; v_mybar text;
begin
  if not public.olnu_bold_on('bold_bump') then raise exception 'feature_off'; end if;
  if p_lat is not null and (p_lat not between -85 and 85 or p_lng not between -180 and 180) then raise exception 'invalid_pos'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bold_bump:' || v_night::text, 0));   -- serial: a tap always sees the one before it
  if exists (select 1 from public.bold_bumps b where b.user_id = v_uid and b.at > clock_timestamp() - interval '2 seconds') then raise exception 'slow_down'; end if;
  if (select count(*) from public.bold_bumps b where b.user_id = v_uid and b.night = v_night) >= 40 then raise exception 'bump_limit'; end if;
  update public.bold_bumps b set lat = null, lng = null where b.night = v_night and b.at < clock_timestamp() - interval '10 minutes' and b.lat is not null;
  select c2.bar_id into v_mybar from public.checkins c2 where c2.user_id = v_uid and c2.expires_at > now();
  insert into public.bold_bumps (user_id, night, lat, lng, acc, bar_id) values (v_uid, v_night, p_lat, p_lng, v_acc, coalesce(v_bar, v_mybar))
  returning * into v_me;
  for c in
    select b.*, (select c3.bar_id from public.checkins c3 where c3.user_id = b.user_id and c3.expires_at > now()) as ci_bar
      from public.bold_bumps b
     where b.night = v_night and b.at > v_me.at - interval '3 seconds' and b.id <> v_me.id and b.user_id <> v_uid
       and public.olnu_bold_friends(v_uid, b.user_id)
     order by b.at
  loop
    if not (
         (c.lat is not null and p_lat is not null and v_acc <= 30 and c.acc <= 30 and public.olnu_dist_m(p_lat, p_lng, c.lat, c.lng) <= 30)
      or (c.lat is not null and p_lat is not null and public.olnu_dist_m(p_lat, p_lng, c.lat, c.lng) <= least(80, v_acc + c.acc))
      or (coalesce(c.bar_id, c.ci_bar) is not null and coalesce(c.bar_id, c.ci_bar) = coalesce(v_me.bar_id, v_mybar))
    ) then continue; end if;
    v_group := coalesce(v_group, c.match_group, c.id);
    update public.bold_bumps b set match_group = v_group where b.id in (c.id, v_me.id) and b.match_group is distinct from v_group;
    insert into public.bold_bump_pairs (night, a, b, bar_id)
    values (v_night, least(v_uid, c.user_id), greatest(v_uid, c.user_id), coalesce(v_me.bar_id, c.bar_id))
    on conflict do nothing;
    if found then
      v_new := v_new + 1;
      v_pts := v_pts + public.olnu_mer_add(v_uid, v_night, 'bump', 'u:' || c.user_id::text, 2, 10);
      perform public.olnu_mer_add(c.user_id, v_night, 'bump', 'u:' || v_uid::text, 2, 10);
    end if;
  end loop;
  return jsonb_build_object('v', 1, 'id', v_me.id, 'matched', public.olnu_bold_match_json(v_uid, v_group),
    'new_pairs', v_new, 'pts', v_pts, 'stats', public.bold_bump_stats());
end; $function$;
revoke all on function public.bold_bump(double precision, double precision, double precision, text) from public, anon;
grant execute on function public.bold_bump(double precision, double precision, double precision, text) to authenticated, service_role;

-- The first tapper asks here (every ~350 ms, max 4 s) whether someone matched its tap.
create or replace function public.bold_bump_wait(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := public.olnu_uid(); b public.bold_bumps; v_pts int;
begin
  select * into b from public.bold_bumps x where x.id = p_id and x.user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
  if b.match_group is null then return jsonb_build_object('v', 1, 'id', b.id, 'matched', '[]'::jsonb, 'done', clock_timestamp() > b.at + interval '4 seconds'); end if;
  select coalesce(sum(l.pts), 0)::int into v_pts from public.meriter_log l where l.user_id = v_uid and l.kind = 'bump' and l.created_at >= b.at - interval '1 second';
  return jsonb_build_object('v', 1, 'id', b.id, 'matched', public.olnu_bold_match_json(v_uid, b.match_group), 'pts', v_pts,
    'new_pairs', (select count(*) from public.bold_bump_pairs p where p.night = b.night and (p.a = v_uid or p.b = v_uid) and p.at >= b.at - interval '1 second'),
    'stats', public.bold_bump_stats(), 'done', true);
end; $function$;
revoke all on function public.bold_bump_wait(bigint) from public, anon;
grant execute on function public.bold_bump_wait(bigint) to authenticated, service_role;

-- "Nära dig nu": store my presence (not in ghost mode) and return friends within 50 m seen in the last 3 min.
create or replace function public.bold_presence_ping(p_lat double precision, p_lng double precision, p_acc double precision)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := public.olnu_uid(); v jsonb;
begin
  if not public.olnu_bold_on('bold_bump') then return jsonb_build_object('v', 1, 'off', true, 'near', '[]'::jsonb); end if;
  if public.olnu_bold_ghost(v_uid) or p_lat is null or p_lng is null or p_lat not between -85 and 85 or p_lng not between -180 and 180
     or coalesce(p_acc, 999) > 100 then
    update public.bold_presence x set lat = null, lng = null where x.user_id = v_uid;
    return jsonb_build_object('v', 1, 'near', '[]'::jsonb, 'ghost', public.olnu_bold_ghost(v_uid));
  end if;
  insert into public.bold_presence as x (user_id, lat, lng, acc, at) values (v_uid, p_lat, p_lng, p_acc, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, at = excluded.at;
  select coalesce(jsonb_agg(jsonb_build_object('name', public.olnu_bold_name(v_uid, q.user_id),
           'd', case when q.d < 15 then '~10 m' when q.d < 35 then '~25 m' else 'nära' end) order by q.d), '[]'::jsonb)
    into v
    from (select x.user_id, public.olnu_dist_m(p_lat, p_lng, x.lat, x.lng) as d from public.bold_presence x
           where x.user_id <> v_uid and x.at > now() - interval '3 minutes' and x.lat is not null
             and abs(x.lat - p_lat) < 0.002 and abs(x.lng - p_lng) < 0.004
             and not public.olnu_bold_ghost(x.user_id) and public.olnu_bold_friends(v_uid, x.user_id)) q
   where q.d <= 50 limit 8;
  return jsonb_build_object('v', 1, 'near', v);
end; $function$;
revoke all on function public.bold_presence_ping(double precision, double precision, double precision) from public, anon;
grant execute on function public.bold_presence_ping(double precision, double precision, double precision) to authenticated, service_role;
