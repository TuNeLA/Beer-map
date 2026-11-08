-- 0383 (bold, owner OK 2026-11-08, flag bold_krog): 👑 KVÄLLENS KROG — one crown per town per night.
-- Counts PEOPLE (distinct users with a check-in or a drink pin snapped to the bar tonight, from crew_tracks) and Skål!
-- meetings at the bar (bold_bump_pairs, filled by the Skål! feature later). NEVER drinks: no beer counts anywhere.
--   score = 3 × people + skål. Crown only with ≥ 5 people at the top bar and ≥ 2 active bars in the town.
--   Live 20:00–03:00 (Stockholm). At 03:00 the night's result is locked (bold_krog_nights) for LIVE + Din kväll.
--   Ghost nights, test users and the test zone are not counted. Strangers: counts only. Friends: names (max 3).
-- Cache: one computed board per town per 2 min (bold_krog_cache). Flag OFF → the RPC answers {off:true} at once.
-- Additive only.

create table if not exists public.bold_bump_pairs (
  night  timestamptz not null,
  a      uuid not null,
  b      uuid not null,
  at     timestamptz not null default now(),
  bar_id text,
  primary key (night, a, b)
);
alter table public.bold_bump_pairs enable row level security;
revoke all on table public.bold_bump_pairs from public, anon, authenticated;

create table if not exists public.bold_krog_cache (
  town  text not null,
  night timestamptz not null,
  at    timestamptz not null default now(),
  rows  jsonb not null default '[]'::jsonb,
  primary key (town, night)
);
alter table public.bold_krog_cache enable row level security;
revoke all on table public.bold_krog_cache from public, anon, authenticated;

create table if not exists public.bold_krog_nights (
  town      text not null,
  night     timestamptz not null,
  bar_id    text,
  bar_name  text,
  people    integer not null default 0,
  skal      integer not null default 0,
  locked_at timestamptz not null default now(),
  primary key (town, night)
);
alter table public.bold_krog_nights enable row level security;
revoke all on table public.bold_krog_nights from public, anon, authenticated;

-- The board for one town and night: [{bar_id, name, people, skal, score}] best first (max 10). p_until = count only tracks before it.
create or replace function public.olnu_krog_board(p_town text, p_night timestamptz, p_until timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with t as (
    select x.user_id, x.bar_id, coalesce(bl.name, x.bar_name) as bar_name, coalesce(bl.lat, x.lat) as lat, coalesce(bl.lng, x.lng) as lng
      from public.crew_tracks x
      left join public.bars_lite bl on bl.id = x.bar_id
     where x.night = p_night and x.bar_id is not null
       and (p_until is null or x.at < p_until)
       and not public.olnu_is_test_zone(x.lat, x.lng)
       and not public.olnu_is_test_user(x.user_id)
       and not exists (select 1 from public.drink_log d where d.user_id = x.user_id and d.night = p_night and coalesce(d.ghost, false))
       and not exists (select 1 from public.beers b where b.user_id = x.user_id and b.expires_at = p_night and coalesce(b.ghost, false))
  ), bars as (
    select t.bar_id, min(t.bar_name) as name, min(t.lat) as lat, min(t.lng) as lng, count(distinct t.user_id)::int as people
      from t group by t.bar_id
  ), inb as (
    select b.* from bars b where public.olnu_town_of(b.lat, b.lng) = p_town
  ), sk as (
    select p.bar_id, count(*)::int as n from public.bold_bump_pairs p
     where p.night = p_night and p.bar_id is not null and (p_until is null or p.at < p_until) group by p.bar_id
  )
  select coalesce(jsonb_agg(z.o order by z.score desc, z.name), '[]'::jsonb)
    from (select jsonb_build_object('bar_id', i.bar_id, 'name', i.name, 'people', i.people, 'skal', coalesce(s.n, 0),
                                    'score', 3 * i.people + coalesce(s.n, 0)) as o,
                 3 * i.people + coalesce(s.n, 0) as score, i.name
            from inb i left join sk s on s.bar_id = i.bar_id
           order by 2 desc, 3 limit 10) z;
$function$;
revoke all on function public.olnu_krog_board(text, timestamptz, timestamptz) from public, anon, authenticated;

-- Lock the result of a night that has ended (after 03:00). Idempotent.
create or replace function public.olnu_krog_lock(p_town text, p_night timestamptz)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v jsonb; w jsonb;
begin
  if p_town is null or exists (select 1 from public.bold_krog_nights n where n.town = p_town and n.night = p_night) then return; end if;
  v := public.olnu_krog_board(p_town, p_night, p_night - interval '2 hours');
  w := v -> 0;
  if w is not null and (w ->> 'people')::int >= 5 and jsonb_array_length(v) >= 2 then
    insert into public.bold_krog_nights (town, night, bar_id, bar_name, people, skal)
    values (p_town, p_night, w ->> 'bar_id', w ->> 'name', (w ->> 'people')::int, (w ->> 'skal')::int)
    on conflict do nothing;
  else
    insert into public.bold_krog_nights (town, night, bar_id, bar_name, people, skal) values (p_town, p_night, null, null, 0, 0)
    on conflict do nothing;
  end if;
end; $function$;
revoke all on function public.olnu_krog_lock(text, timestamptz) from public, anon, authenticated;

-- Client RPC. p_lat/p_lng = the map centre (or my position). Returns the town board tonight + last night's result.
create or replace function public.bold_krog(p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_town text; v_now timestamptz := now(); v_night timestamptz := public.olnu_night_of(now());
  v_min int := extract(hour from (now() at time zone 'Europe/Stockholm'))::int * 60 + extract(minute from (now() at time zone 'Europe/Stockholm'))::int;
  v_live boolean; v_rows jsonb; c public.bold_krog_cache; v_last timestamptz; v_lastrow public.bold_krog_nights; v_friends jsonb := '{}'::jsonb;
  v_leader jsonb := null;
begin
  if not coalesce((select f.on_ from public.bold_flags f where f.key = 'bold_krog'), false) then
    return jsonb_build_object('v', 1, 'off', true);
  end if;
  if p_lat is null or p_lng is null or not public.olnu_world_ok(p_lat, p_lng) then return jsonb_build_object('v', 1, 'town', null); end if;
  v_town := public.olnu_town_of(p_lat, p_lng);
  if v_town is null then return jsonb_build_object('v', 1, 'town', null); end if;
  v_live := v_min >= 20 * 60 or v_min < 3 * 60;
  -- the night that ended last: before 05:00 it is tonight (locked from 03:00), after 05:00 it is yesterday's
  v_last := case when v_min < 5 * 60 then v_night else v_night - interval '1 day' end;
  if not v_live then perform public.olnu_krog_lock(v_town, v_last); end if;
  select * into v_lastrow from public.bold_krog_nights n where n.town = v_town and n.night = v_last;
  if v_live then
    select * into c from public.bold_krog_cache k where k.town = v_town and k.night = v_night;
    if found and c.at > v_now - interval '2 minutes' then
      v_rows := c.rows;
    else
      v_rows := public.olnu_krog_board(v_town, v_night, null);
      insert into public.bold_krog_cache as k (town, night, at, rows) values (v_town, v_night, v_now, v_rows)
      on conflict (town, night) do update set at = excluded.at, rows = excluded.rows;
    end if;
    if jsonb_array_length(v_rows) >= 2 and ((v_rows -> 0 ->> 'people')::int) >= 5 then v_leader := v_rows -> 0; end if;
    -- friends (same group or accepted friend) at the bars on the board tonight: count + up to 3 names
    select coalesce(jsonb_object_agg(q.bar_id, jsonb_build_object('n', q.n, 'names', q.names)), '{}'::jsonb) into v_friends
      from (select x.bar_id, count(distinct x.user_id)::int as n,
                   (array_agg(distinct coalesce((select min(gm.display_name) from public.group_members gm
                                                   join public.group_members me on me.group_id = gm.group_id and me.user_id = v_uid
                                                  where gm.user_id = x.user_id), 'Kompis')))[1:3] as names
              from public.crew_tracks x
             where x.night = v_night and x.bar_id in (select r ->> 'bar_id' from jsonb_array_elements(v_rows) r)
               and x.user_id <> v_uid and not public.olnu_ub_hidden(v_uid, x.user_id)
               and (exists (select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
                             where a.user_id = v_uid and b.user_id = x.user_id)
                    or exists (select 1 from public.friendships f where f.status = 'accepted'
                                and ((f.a = v_uid and f.b = x.user_id) or (f.b = v_uid and f.a = x.user_id))))
             group by x.bar_id) q;
  end if;
  return jsonb_build_object('v', 1, 'town', v_town, 'night', v_night, 'live', v_live, 'min_people', 5,
    'leader', v_leader, 'top', case when v_live then coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_rows) e limit 3) z), '[]'::jsonb) else '[]'::jsonb end,
    'friends', v_friends,
    'last', case when v_lastrow.bar_id is not null then jsonb_build_object('night', v_lastrow.night, 'bar_id', v_lastrow.bar_id,
              'name', v_lastrow.bar_name, 'people', v_lastrow.people, 'skal', v_lastrow.skal,
              'was_there', exists (select 1 from public.crew_tracks x where x.user_id = v_uid and x.night = v_lastrow.night and x.bar_id = v_lastrow.bar_id))
            else null end);
end; $function$;
revoke all on function public.bold_krog(double precision, double precision) from public, anon;
grant execute on function public.bold_krog(double precision, double precision) to authenticated, service_role;
