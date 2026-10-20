-- Öl Nu — ➕ "Lägg till ställe här" (map long-press): user suggestions of missing bars / restaurants / cafés.
-- Additive. Rows are never removed: status pending → ok | rejected. Approve = upsert into bars_lite (active) with a
-- stable id 'u-<slug>-<id>', so pins snap to it and check-ins work. Reject only hides (and switches off an approved one).
-- The submitter sees the pending place at once (user_places, mine=true). Others see it only when approved.

create table if not exists public.place_suggestions (
  id         bigserial primary key,
  user_id    uuid not null,
  name       text not null check (char_length(name) between 2 and 60),
  type       text not null check (type in ('bar', 'pub', 'restaurant', 'cafe', 'nightclub', 'other')),
  note       text check (note is null or char_length(note) <= 200),
  lat        double precision not null,
  lng        double precision not null,
  bar_id     text not null unique,
  status     text not null default 'pending' check (status in ('pending', 'ok', 'rejected')),
  created_at timestamptz not null default now(),
  status_at  timestamptz
);
create index if not exists place_sugg_user_idx on public.place_suggestions (user_id, created_at desc);
create index if not exists place_sugg_pos_idx on public.place_suggestions (lat, lng);
alter table public.place_suggestions enable row level security;
revoke all on public.place_suggestions from anon, authenticated;
revoke all on sequence public.place_suggestions_id_seq from anon, authenticated;
grant all on public.place_suggestions to service_role;

create or replace function public.olnu_place_slug(p text)
returns text language sql immutable set search_path = public as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(
           translate(lower(coalesce(p, '')), 'åäöéèüæøáàíóú', 'aaoeeuaoaaiou'), '[^a-z0-9]+', '-', 'g')), 30), ''), 'stalle');
$$;

create or replace function public.suggest_place(p_name text, p_type text, p_lat double precision, p_lng double precision,
                                                p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_name text := public.olnu_inv_clean(p_name, 60);
  v_note text := public.olnu_inv_clean(p_note, 200);
  v_type text := lower(coalesce(p_type, ''));
  v_id bigint;
  v_bar text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_type := case v_type when 'restaurang' then 'restaurant' when 'café' then 'cafe' when 'nattklubb' then 'nightclub'
                        when 'annat' then 'other' else v_type end;
  if v_type not in ('bar', 'pub', 'restaurant', 'cafe', 'nightclub', 'other') then raise exception 'invalid_place'; end if;
  if v_name is null or char_length(v_name) < 2 or public.olnu_inv_haslink(v_name) or public.olnu_inv_haslink(v_note) then
    raise exception 'invalid_place';
  end if;
  if p_lat is null or p_lng is null or p_lat <> p_lat or p_lng <> p_lng or abs(p_lat) > 85 or abs(p_lng) > 180 then
    raise exception 'outside_sweden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-place:' || v_uid::text, 0));
  if exists (select 1 from public.place_suggestions s where s.user_id = v_uid and s.created_at > now() - interval '20 seconds')
     or (select count(*) from public.place_suggestions s where s.user_id = v_uid and s.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'slow_down';
  end if;
  v_id := nextval('public.place_suggestions_id_seq');
  v_bar := 'u-' || public.olnu_place_slug(v_name) || '-' || v_id;
  insert into public.place_suggestions (id, user_id, name, type, note, lat, lng, bar_id)
  values (v_id, v_uid, v_name, v_type, v_note, round(p_lat::numeric, 6)::float8, round(p_lng::numeric, 6)::float8, v_bar);
  return jsonb_build_object('id', v_id, 'bar_id', v_bar, 'status', 'pending', 'name', v_name, 'type', v_type);
end; $$;

-- Approved places near (lat, lng) (~40 km box) + my own pending ones anywhere (max 300).
create or replace function public.user_places(p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.bar_id, 'name', s.name, 'type', s.type, 'lat', s.lat, 'lng', s.lng,
             'pending', s.status = 'pending', 'mine', s.user_id = v_uid) order by s.id)
    from (select * from public.place_suggestions x
           where (x.status = 'ok' and (p_lat is null or (x.lat between p_lat - 0.4 and p_lat + 0.4 and x.lng between p_lng - 0.8 and p_lng + 0.8)))
              or (x.status = 'pending' and x.user_id = v_uid)
           order by x.id desc limit 300) s), '[]'::jsonb);
end; $$;

create or replace function public.owner_places(p_key text, p_status text default 'pending')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select x.status s, count(*) n from public.place_suggestions x group by 1) c),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'bar_id', s.bar_id, 'name', s.name, 'type', s.type, 'note', s.note,
                 'lat', s.lat, 'lng', s.lng, 'status', s.status, 'created_at', s.created_at,
                 'town', public.olnu_town_of(s.lat, s.lng),
                 'by_n', (select count(*) from public.place_suggestions y where y.user_id = s.user_id),
                 'near', (select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'm', round((sqrt(power((b.lat - s.lat) * 111195, 2) + power((b.lng - s.lng) * 111195 * cos(radians(s.lat)), 2)))::numeric)))
                            from (select * from public.bars_lite b0 where b0.active and b0.id <> s.bar_id
                                    and b0.lat between s.lat - 0.0009 and s.lat + 0.0009 and b0.lng between s.lng - 0.0018 and s.lng + 0.0018 limit 5) b))
               order by s.created_at desc)
              from (select * from public.place_suggestions x where v_s = 'all' or x.status = v_s order by x.created_at desc limit 200) s), '[]'::jsonb));
end; $$;

create or replace function public.owner_set_place(p_key text, p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s text := lower(btrim(coalesce(p_status, '')));
  s public.place_suggestions;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('pending', 'ok', 'rejected') then raise exception 'invalid_status'; end if;
  update public.place_suggestions x set status = v_s, status_at = now() where x.id = p_id returning * into s;
  if not found then raise exception 'place_not_found'; end if;
  if v_s = 'ok' then
    insert into public.bars_lite (id, name, lat, lng, type, active, updated_at)
    values (s.bar_id, s.name, s.lat, s.lng, case when s.type = 'other' then 'bar' else s.type end, true, now())
    on conflict (id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng, type = excluded.type,
                                   active = true, updated_at = now();
  else
    update public.bars_lite b set active = false, updated_at = now() where b.id = s.bar_id and b.active;
  end if;
  return jsonb_build_object('ok', true, 'status', v_s, 'bar_id', s.bar_id);
end; $$;

do $$
begin
  execute 'revoke all on function public.olnu_place_slug(text) from public';
  execute 'revoke all on function public.suggest_place(text, text, double precision, double precision, text), public.user_places(double precision, double precision) from public';
  execute 'revoke all on function public.owner_places(text, text), public.owner_set_place(text, bigint, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_place_slug(text), public.suggest_place(text, text, double precision, double precision, text), public.user_places(double precision, double precision) from anon';
    -- owner panels run on stats.html with the anon key + the owner key (same as owner_events)
    execute 'grant execute on function public.owner_places(text, text), public.owner_set_place(text, bigint, text) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_place_slug(text) from authenticated';
    execute 'grant execute on function public.suggest_place(text, text, double precision, double precision, text), public.user_places(double precision, double precision) to authenticated';
    execute 'grant execute on function public.owner_places(text, text), public.owner_set_place(text, bigint, text) to authenticated';
  end if;
end $$;
