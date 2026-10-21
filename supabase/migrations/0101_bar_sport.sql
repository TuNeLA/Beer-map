-- Öl Nu — 📺 "VISAR SPORT" on bars (CONTRACT "SPORT + 📅 EVENT-KNAPPEN"). Additive: two new tables + new functions.
-- Users vote in the bar sheet ("📺 Visar dom sport här?" Ja / Nej, one vote per user per bar, changeable, rate-limited).
-- The app owner can force it on / off in stats.html (owner key, like owner_stats). A bar "shows sport" when the owner says so,
-- else when it has at least one yes and more yes than no. Rows are never removed: a withdrawn vote is yes = NULL, an owner reset is shows = NULL.
-- Needs olnu_uid, olnu_world_ok, olnu_wd_owner_ok (0031), bars_lite.

create table if not exists public.bar_sport_votes (
  bar_id     text not null,
  user_id    uuid not null,
  yes        boolean,                         -- true = shows sport, false = does not, null = withdrawn
  bar_lat    float8 not null,
  bar_lng    float8 not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bar_id, user_id)
);
create index if not exists bar_sport_votes_pos_ix on public.bar_sport_votes (bar_lat, bar_lng);
create index if not exists bar_sport_votes_user_ix on public.bar_sport_votes (user_id, updated_at);
alter table public.bar_sport_votes enable row level security;
revoke all on public.bar_sport_votes from anon, authenticated;

create table if not exists public.bar_sport_owner (
  bar_id   text primary key,
  shows    boolean,                           -- true / false = owner decision, null = back to the votes
  bar_lat  float8 not null,
  bar_lng  float8 not null,
  set_at   timestamptz not null default now()
);
create index if not exists bar_sport_owner_pos_ix on public.bar_sport_owner (bar_lat, bar_lng);
alter table public.bar_sport_owner enable row level security;
revoke all on public.bar_sport_owner from anon, authenticated;

-- One bar's state: {bar_id, yes, no, owner, shows, mine}
create or replace function public.olnu_sport_info(p_bar_id text, p_uid uuid)
returns jsonb language sql stable set search_path = public as $$
  with v as (select count(*) filter (where yes) y, count(*) filter (where yes = false) n
               from public.bar_sport_votes where bar_id = p_bar_id),
       o as (select shows from public.bar_sport_owner where bar_id = p_bar_id)
  select jsonb_build_object('bar_id', p_bar_id, 'yes', v.y, 'no', v.n, 'owner', (select shows from o),
           'shows', coalesce((select shows from o), v.y >= 1 and v.y > v.n),
           'mine', (select yes from public.bar_sport_votes where bar_id = p_bar_id and user_id = p_uid))
    from v;
$$;

-- vote_bar_sport(bar, yes) — yes true / false, or null to withdraw. Errors: not_authenticated, invalid_bar,
-- slow_down (1 change per 3 s, 30 per 24 h per user). Returns olnu_sport_info.
create or replace function public.vote_bar_sport(p_bar_id text, p_yes boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_bar text := left(btrim(coalesce(p_bar_id, '')), 80);
  b record;
begin
  select x.id, x.lat, x.lng into b from public.bars_lite x where x.id = v_bar and x.active;
  if not found then raise exception 'invalid_bar'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-sportvote:' || v_uid::text, 0));
  if exists (select 1 from public.bar_sport_votes s where s.user_id = v_uid and s.updated_at > now() - interval '3 seconds')
     or (select count(*) from public.bar_sport_votes s where s.user_id = v_uid and s.updated_at > now() - interval '24 hours') >= 30 then
    raise exception 'slow_down';
  end if;
  insert into public.bar_sport_votes as s (bar_id, user_id, yes, bar_lat, bar_lng)
  values (v_bar, v_uid, p_yes, b.lat, b.lng)
  on conflict (bar_id, user_id) do update set yes = excluded.yes, bar_lat = excluded.bar_lat, bar_lng = excluded.bar_lng, updated_at = now();
  return public.olnu_sport_info(v_bar, v_uid) || jsonb_build_object('ok', true);
end; $$;

-- bar_sport_near(lat, lng) → jsonb {bars:[{bar_id, name, lat, lng, yes, no, owner, shows, mine, km}]}: bars within ~30 km with any
-- vote or owner decision. Sorted: shows first, then distance. Max 200.
create or replace function public.bar_sport_near(p_lat float8, p_lng float8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_cos float8;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  v_cos := greatest(0.2, cos(radians(p_lat)));
  return jsonb_build_object('bars', coalesce((
    select jsonb_agg(z.j order by (z.j->>'shows')::boolean desc, (z.j->>'km')::float8) from (
      select public.olnu_sport_info(ids.bar_id, v_uid)
             || jsonb_build_object('name', bl.name, 'lat', bl.lat, 'lng', bl.lng,
                  'km', round((sqrt(power((bl.lat - p_lat) * 111.32, 2) + power((bl.lng - p_lng) * 111.32 * cos(radians(p_lat)), 2)))::numeric, 2)::float8) j
        from (select s.bar_id from public.bar_sport_votes s
               where s.bar_lat between p_lat - 0.27 and p_lat + 0.27 and s.bar_lng between p_lng - 0.27 / v_cos and p_lng + 0.27 / v_cos
              union
              select o.bar_id from public.bar_sport_owner o
               where o.bar_lat between p_lat - 0.27 and p_lat + 0.27 and o.bar_lng between p_lng - 0.27 / v_cos and p_lng + 0.27 / v_cos) ids
        join public.bars_lite bl on bl.id = ids.bar_id and bl.active
       limit 200) z), '[]'::jsonb));
end; $$;

-- Owner (stats.html). Wrong key → 403 forbidden (logged by olnu_wd_owner_ok), too many fails → rate_limited.
create or replace function public.owner_sport_bars(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(), 'bars', coalesce((
    select jsonb_agg(public.olnu_sport_info(ids.bar_id, null) || jsonb_build_object('name', bl.name, 'lat', bl.lat, 'lng', bl.lng, 'last_at', ids.last_at)
                     order by ids.last_at desc)
      from (select bar_id, max(t) last_at from (
              select bar_id, updated_at t from public.bar_sport_votes union all select bar_id, set_at from public.bar_sport_owner) a
            group by bar_id order by 2 desc limit 300) ids
      join public.bars_lite bl on bl.id = ids.bar_id), '[]'::jsonb));
end; $$;

create or replace function public.owner_set_bar_sport(p_key text, p_bar_id text, p_shows boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select x.id, x.lat, x.lng into b from public.bars_lite x where x.id = p_bar_id;
  if not found then raise exception 'invalid_bar'; end if;
  insert into public.bar_sport_owner as o (bar_id, shows, bar_lat, bar_lng) values (b.id, p_shows, b.lat, b.lng)
  on conflict (bar_id) do update set shows = excluded.shows, set_at = now();
  return public.olnu_sport_info(b.id, null) || jsonb_build_object('ok', true);
end; $$;

-- Owner search to mark a bar nobody voted on yet: name contains p_q (2–40 chars), max 20, active bars/pubs first.
create or replace function public.owner_find_bars(p_key text, p_q text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_q text := btrim(coalesce(p_q, ''));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if char_length(v_q) < 2 or char_length(v_q) > 40 then return jsonb_build_object('bars', '[]'::jsonb); end if;
  return jsonb_build_object('bars', coalesce((
    select jsonb_agg(public.olnu_sport_info(x.id, null) || jsonb_build_object('name', x.name, 'type', x.type, 'lat', x.lat, 'lng', x.lng,
             'town', public.olnu_town_of(x.lat, x.lng)))
      from (select * from public.bars_lite b where b.active and b.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
             order by (b.type in ('bar', 'pub', 'nightclub')) desc, b.name limit 20) x), '[]'::jsonb));
end; $$;

revoke all on function public.olnu_sport_info(text, uuid) from public, anon, authenticated;
revoke all on function public.vote_bar_sport(text, boolean) from public, anon;
revoke all on function public.bar_sport_near(float8, float8) from public, anon;
revoke all on function public.owner_sport_bars(text) from public;
revoke all on function public.owner_set_bar_sport(text, text, boolean) from public;
revoke all on function public.owner_find_bars(text, text) from public;
grant execute on function public.vote_bar_sport(text, boolean) to authenticated;
grant execute on function public.bar_sport_near(float8, float8) to authenticated;
grant execute on function public.owner_sport_bars(text) to anon, authenticated;
grant execute on function public.owner_set_bar_sport(text, text, boolean) to anon, authenticated;
grant execute on function public.owner_find_bars(text, text) to anon, authenticated;
grant all on public.bar_sport_votes to service_role;
grant all on public.bar_sport_owner to service_role;
