-- Öl Nu v26 — 📅 EVENTS ("Ikväll i stan"): pub quiz, live music, DJ … per bar / town. Additive.
-- Sources: users (submit_event → owner approves with the owner key, like owner_stats), and the importer
-- scripts/import-events.mjs (GitHub Actions, service role → import_events). Facebook is never scraped.
-- Rows are never removed: status flags ('pending' | 'ok' | 'hidden') and expires_at filter every read.
-- Needs: olnu_uid, olnu_world_ok, olnu_town_of, bars_lite, olnu_towns, olnu_wd_owner_ok (0031), owner_key_fails.

create table if not exists public.bar_events (
  id          bigserial primary key,
  source      text not null default 'user',              -- user | owner | ticketmaster | ical | jsonld
  source_id   text,                                      -- id in the source (upsert key with source)
  url         text,
  title       text not null check (char_length(title) between 3 and 80),
  kind        text not null default 'other',             -- quiz | live | dj | karaoke | sport | standup | party | other
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  bar_id      text,
  place       text check (place is null or char_length(place) <= 60),
  lat         float8,
  lng         float8,
  town        text,
  status      text not null default 'pending' check (status in ('pending', 'ok', 'hidden')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  status_at   timestamptz,
  expires_at  timestamptz not null
);
create unique index if not exists bar_events_src_uq on public.bar_events (source, source_id) where source_id is not null;
create index if not exists bar_events_time_ix on public.bar_events (starts_at) where status = 'ok';
create index if not exists bar_events_user_ix on public.bar_events (created_by, created_at);
alter table public.bar_events enable row level security;
revoke all on public.bar_events from anon, authenticated;
revoke all on sequence public.bar_events_id_seq from anon, authenticated;

-- One line of plain text: control chars → space, trimmed, inner runs of spaces collapsed.
create or replace function public.olnu_ev_clean(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '');
$$;

create or replace function public.olnu_ev_kind(p_title text, p_kind text)
returns text language sql immutable set search_path = public as $$
  select case
    when lower(coalesce(p_kind, '')) in ('quiz', 'live', 'dj', 'karaoke', 'sport', 'standup', 'party', 'other') then lower(p_kind)
    when p_title ~* '(quiz|frågesport|trivia|bingo)' then 'quiz'
    when p_title ~* '(karaoke|sjung)' then 'karaoke'
    when p_title ~* '(stand.?up|komik|comedy)' then 'standup'
    when p_title ~* '(\mdj\M|klubb|club night|disco)' then 'dj'
    when p_title ~* '(match|fotboll|hockey|shl|allsvensk|premier league|champions league|\mvm\M|\mem\M|ufc|f1)' then 'sport'
    when p_title ~* '(live|konsert|concert|spelar|band|trubadur|akustisk|jazz|blues|rock)' then 'live'
    when p_title ~* '(fest|party|afterwork|\maw\M|release)' then 'party'
    else 'other' end;
$$;

-- Nearest active real bar within 75 m (bars only, not restaurants), or null.
create or replace function public.olnu_ev_bar(p_lat float8, p_lng float8)
returns text language sql stable set search_path = public as $$
  select b.id from public.bars_lite b
   where b.active and b.type in ('bar', 'pub', 'nightclub', 'biergarten', 'restaurant')
     and b.lat between p_lat - 0.001 and p_lat + 0.001 and b.lng between p_lng - 0.002 and p_lng + 0.002
     and (power((b.lat - p_lat) * 111320, 2) + power((b.lng - p_lng) * 111320 * cos(radians(p_lat)), 2)) <= 75 * 75
   order by power(b.lat - p_lat, 2) + power((b.lng - p_lng) * cos(radians(p_lat)), 2) limit 1;
$$;

-- events_near(lat, lng, days) → live events within 30 km from now − 3 h (still running) to now + days (1–14).
-- Approved events for everyone; the caller's own pending events too (pending = true).
create or replace function public.events_near(p_lat float8, p_lng float8, p_days int default 1)
returns table (id bigint, title text, kind text, starts_at timestamptz, ends_at timestamptz, bar_id text, place text,
               lat float8, lng float8, town text, url text, source text, is_mine boolean, pending boolean, km float8)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(14, coalesce(p_days, 1)));
begin
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  return query
  select e.id, e.title, e.kind, e.starts_at, e.ends_at, e.bar_id, e.place, e.lat, e.lng, e.town,
         case when e.status = 'ok' then e.url else null end, e.source,
         (e.created_by = v_uid), (e.status = 'pending'),
         round((sqrt(power((e.lat - p_lat) * 111.32, 2) + power((e.lng - p_lng) * 111.32 * cos(radians(p_lat)), 2)))::numeric, 1)::float8
    from public.bar_events e
   where (e.status = 'ok' or (e.status = 'pending' and e.created_by = v_uid))
     and e.expires_at > now()
     and e.starts_at < now() + make_interval(days => v_days)
     and e.starts_at > now() - interval '12 hours'
     and e.lat between p_lat - 0.27 and p_lat + 0.27
     and e.lng between p_lng - 0.27 / greatest(0.2, cos(radians(p_lat))) and p_lng + 0.27 / greatest(0.2, cos(radians(p_lat)))
   order by e.starts_at, e.id
   limit 100;
end; $$;

-- submit_event: users add an event. Lands as 'pending' until the owner approves it (owner_set_event).
-- Errors: invalid_event (title 3–80, no links; time −1 h … +60 d; url http(s) ≤ 300), outside_sweden (= invalid
-- coordinates), slow_down (1 per 30 s, 5 per Stockholm day per user).
create or replace function public.submit_event(p_title text, p_starts_at timestamptz, p_bar_id text default null,
  p_place text default null, p_lat float8 default null, p_lng float8 default null, p_kind text default null, p_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_title text := public.olnu_ev_clean(p_title);
  v_place text := left(public.olnu_ev_clean(p_place), 60);
  v_url text := public.olnu_ev_clean(p_url);
  v_bar text := left(public.olnu_ev_clean(p_bar_id), 80);
  v_lat float8 := p_lat; v_lng float8 := p_lng;
  b record; v_id bigint; v_day timestamptz;
begin
  if v_title is null or char_length(v_title) < 3 or char_length(v_title) > 80 or v_title ~* '(https?://|www\.|\.(se|com|nu|net|org)\M)' then raise exception 'invalid_event'; end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 hour' or p_starts_at > now() + interval '60 days' then raise exception 'invalid_event'; end if;
  if v_url is not null and (v_url !~* '^https?://[^\s]+$' or char_length(v_url) > 300) then raise exception 'invalid_event'; end if;
  if v_bar is not null then
    select x.id, x.name, x.lat, x.lng into b from public.bars_lite x where x.id = v_bar and x.active;
    if found then v_lat := b.lat; v_lng := b.lng; v_place := coalesce(v_place, left(b.name, 60)); else v_bar := null; end if;
  end if;
  if v_lat is null or v_lng is null or not public.olnu_world_ok(v_lat, v_lng) then raise exception 'outside_sweden'; end if;
  if v_bar is null then v_bar := public.olnu_ev_bar(v_lat, v_lng); end if;
  v_day := (date_trunc('day', now() at time zone 'Europe/Stockholm')) at time zone 'Europe/Stockholm';
  if exists (select 1 from public.bar_events e where e.created_by = v_uid and e.created_at > now() - interval '30 seconds')
     or (select count(*) from public.bar_events e where e.created_by = v_uid and e.created_at >= v_day) >= 5 then
    raise exception 'slow_down';
  end if;
  insert into public.bar_events (source, title, kind, starts_at, bar_id, place, lat, lng, town, url, status, created_by, expires_at)
  values ('user', v_title, public.olnu_ev_kind(v_title, p_kind), p_starts_at, v_bar, v_place, round(v_lat::numeric, 5), round(v_lng::numeric, 5),
          public.olnu_town_of(v_lat, v_lng), v_url, 'pending', v_uid, p_starts_at + interval '5 hours')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending', 'bar_id', v_bar);
end; $$;

-- Owner (stats.html): list + approve / hide. Wrong key → 403 forbidden (logged), > 20 fails/h → rate_limited.
create or replace function public.owner_events(p_key text, p_status text default 'pending')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select e.status s, count(*) n from public.bar_events e where e.expires_at > now() group by 1) c),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'kind', e.kind, 'starts_at', e.starts_at, 'place', e.place,
                 'bar_id', e.bar_id, 'town', e.town, 'url', e.url, 'source', e.source, 'status', e.status, 'created_at', e.created_at) order by e.starts_at)
              from (select * from public.bar_events x where x.expires_at > now() and (v_s = 'all' or x.status = v_s) order by x.starts_at limit 300) e), '[]'::jsonb));
end; $$;

create or replace function public.owner_set_event(p_key text, p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(btrim(coalesce(p_status, '')));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('pending', 'ok', 'hidden') then raise exception 'invalid_status'; end if;
  update public.bar_events e set status = v_s, status_at = now(), updated_at = now() where e.id = p_id;
  if not found then raise exception 'event_not_found'; end if;
  return jsonb_build_object('ok', true, 'status', v_s);
end; $$;

-- Importer (service role only). p_rows = [{source, source_id, title, starts_at, ends_at?, url?, place?, lat, lng, kind?}]
-- Upsert on (source, source_id). Imported rows are 'ok' (trusted feeds) unless the owner hid them (hidden stays hidden).
create or replace function public.import_events(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_ins int := 0; v_upd int := 0; v_skip int := 0;
  v_title text; v_src text; v_sid text; v_at timestamptz; v_end timestamptz; v_lat float8; v_lng float8; v_url text; v_place text; v_new boolean;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'invalid_rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_src := lower(left(public.olnu_ev_clean(r->>'source'), 20));
      v_sid := left(public.olnu_ev_clean(r->>'source_id'), 200);
      v_title := left(public.olnu_ev_clean(r->>'title'), 80);
      v_at := (r->>'starts_at')::timestamptz;
      v_end := nullif(r->>'ends_at', '')::timestamptz;
      v_lat := (r->>'lat')::float8; v_lng := (r->>'lng')::float8;
      v_url := public.olnu_ev_clean(r->>'url');
      v_place := left(public.olnu_ev_clean(r->>'place'), 60);
      if v_src is null or v_src = 'user' or v_sid is null or v_title is null or char_length(v_title) < 3 or v_at is null
         or v_at < now() - interval '12 hours' or v_at > now() + interval '90 days'
         or not public.olnu_world_ok(v_lat, v_lng) then v_skip := v_skip + 1; continue; end if;
      if v_url is not null and (v_url !~* '^https?://' or char_length(v_url) > 300) then v_url := null; end if;
      if v_end is not null and (v_end < v_at or v_end > v_at + interval '2 days') then v_end := null; end if;
      insert into public.bar_events as e (source, source_id, title, kind, starts_at, ends_at, bar_id, place, lat, lng, town, url, status, expires_at)
      values (v_src, v_sid, v_title, public.olnu_ev_kind(v_title, r->>'kind'), v_at, v_end, public.olnu_ev_bar(v_lat, v_lng), v_place,
              round(v_lat::numeric, 5), round(v_lng::numeric, 5), public.olnu_town_of(v_lat, v_lng), v_url, 'ok', coalesce(v_end, v_at + interval '5 hours'))
      on conflict (source, source_id) where source_id is not null do update
        set title = excluded.title, kind = excluded.kind, starts_at = excluded.starts_at, ends_at = excluded.ends_at, bar_id = excluded.bar_id,
            place = excluded.place, lat = excluded.lat, lng = excluded.lng, town = excluded.town, url = excluded.url,
            expires_at = excluded.expires_at, updated_at = now()
      returning (xmax = 0) into v_new;
      if v_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    exception when others then v_skip := v_skip + 1;
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip);
end; $$;

-- Towns for the importer (service role): [{name, lat, lng}]
create or replace function public.import_event_towns()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'lat', t.lat, 'lng', t.lng) order by t.name), '[]'::jsonb) from public.olnu_towns t;
$$;

revoke all on function public.olnu_ev_clean(text) from public, anon, authenticated;
revoke all on function public.olnu_ev_kind(text, text) from public, anon, authenticated;
revoke all on function public.olnu_ev_bar(float8, float8) from public, anon, authenticated;
revoke all on function public.events_near(float8, float8, int) from public, anon;
revoke all on function public.submit_event(text, timestamptz, text, text, float8, float8, text, text) from public, anon;
revoke all on function public.owner_events(text, text) from public;
revoke all on function public.owner_set_event(text, bigint, text) from public;
revoke all on function public.import_events(jsonb) from public, anon, authenticated;
revoke all on function public.import_event_towns() from public, anon, authenticated;
grant execute on function public.events_near(float8, float8, int) to authenticated;
grant execute on function public.submit_event(text, timestamptz, text, text, float8, float8, text, text) to authenticated;
grant execute on function public.owner_events(text, text) to anon, authenticated;
grant execute on function public.owner_set_event(text, bigint, text) to anon, authenticated;
grant execute on function public.import_events(jsonb) to service_role;
grant execute on function public.import_event_towns() to service_role;
grant all on public.bar_events to service_role;
grant usage, select on sequence public.bar_events_id_seq to service_role;
