-- 0497 · OWNERFIX item 7 — EVENT TIPS: AUTO RULES (owner decision 11 Nov 22:03). OWNER-RUN at release, AFTER 0496.
-- Additive: one new column, one new table, new functions, CREATE OR REPLACE of submit_event / owner_events /
-- owner_set_event (full bodies from the live snapshot + the new rules; same signatures, same grants).
-- No statement removes rows or objects. CR-safe: no multi-line text literals; olnu_strip_cr() (0436) at the end.
-- Safe to run many times.
--
-- Rules for a user tip (submit_event):
--   (a) status 'ok' AT ONCE when the event is at a KNOWN bar (a bar id, or a bar within ~100 m) AND one of:
--       - the sender is trusted: a saved account (e-mail, not anonymous), OR >= 1 earlier tip that was 'ok' in 30 days
--         and none 'hidden' in 30 days;
--       - a SECOND different user tipped the same event (same bar or <= 100 m, start +- 2 h, a fuzzy title match):
--         the first tip turns 'ok' (reason 'confirmed') and no second row is made (no duplicate in the list).
--   (b) max 3 tips per user per Stockholm day → error 'tip_limit' (the 30 s 'slow_down' stays).
--   (c) "Stämmer inte?" (report_event_tip): 3 different reporters hide a user event (status 'hidden', reason 'reports').
--       1–2 reports on an 'ok' event: reason 'reported' → it shows in the owner's "Väntar" list (it stays visible).
--   (d) everything else stays 'pending' for the owner, with a reason: not_bar · new_user · penalty.
--   (e) a user with 2 hidden tips in 30 days (owner or reports; not counting 'dup') is pending-only again.
-- bar_events.status_reason: auto:account · auto:history · confirmed · not_bar · new_user · penalty · reported · reports · owner.

alter table public.bar_events add column if not exists status_reason text;
create index if not exists bar_events_user_tips_idx on public.bar_events (created_by, created_at desc) where source = 'user';

create table if not exists public.event_tip_reports (
  event_id   bigint not null,
  user_id    uuid not null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_tip_reports_user_idx on public.event_tip_reports (user_id, created_at desc);
alter table public.event_tip_reports enable row level security;
revoke all on table public.event_tip_reports from public, anon, authenticated;

-- 2 hidden tips in 30 days (e)
create or replace function public.olnu_ev_tip_penalty(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select count(*) from public.bar_events e
           where e.created_by = p_uid and e.source = 'user' and e.status = 'hidden' and coalesce(e.status_reason, '') <> 'dup'
             and coalesce(e.status_at, e.created_at) > now() - interval '30 days') >= 2;
$$;

-- 'account' | 'history' | null (not trusted)
create or replace function public.olnu_ev_tip_trust(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_uid is null or public.olnu_ev_tip_penalty(p_uid) then null
    when exists (select 1 from auth.users u where u.id = p_uid and not coalesce(u.is_anonymous, true) and coalesce(u.email, '') <> '') then 'account'
    when exists (select 1 from public.bar_events e where e.created_by = p_uid and e.source = 'user' and e.status = 'ok'
                  and e.created_at > now() - interval '30 days')
     and not exists (select 1 from public.bar_events e where e.created_by = p_uid and e.source = 'user' and e.status = 'hidden'
                  and coalesce(e.status_reason, '') <> 'dup' and coalesce(e.status_at, e.created_at) > now() - interval '30 days') then 'history'
    else null end;
$$;

-- a bar id that is a known active bar, or a known bar within ~100 m
create or replace function public.olnu_ev_known_bar(p_bar text, p_lat double precision, p_lng double precision)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_bar is not null and exists (select 1 from public.bars_lite b where b.id = p_bar and b.active), false)
      or coalesce(p_lat is not null and p_lng is not null and exists (
           select 1 from public.bars_lite b
            where b.active and b.type in ('bar', 'pub', 'nightclub', 'biergarten', 'restaurant')
              and b.lat between p_lat - 0.0013 and p_lat + 0.0013 and b.lng between p_lng - 0.0026 and p_lng + 0.0026
              and (power((b.lat - p_lat) * 111320, 2) + power((b.lng - p_lng) * 111320 * cos(radians(p_lat)), 2)) <= 100 * 100), false);
$$;

-- the same event title, fuzzy: half the words in common (olnu_ev_words), or one name inside the other
create or replace function public.olnu_ev_tip_same(a text, b text)
returns boolean language sql immutable set search_path = public as $$
  with w as (select public.olnu_ev_words(a) aw, public.olnu_ev_words(b) bw),
  n as (select array_to_string(aw, '') an, array_to_string(bw, '') bn, aw, bw from w)
  select coalesce(
       (cardinality(array(select unnest(aw) intersect select unnest(bw)))::float8 / nullif(greatest(cardinality(aw), cardinality(bw)), 0) >= 0.5)
    or (least(length(an), length(bn)) >= 4 and (position(an in bn) > 0 or position(bn in an) > 0)), false)
    from n;
$$;

create or replace function public.submit_event(p_title text, p_starts_at timestamp with time zone, p_bar_id text default null::text,
  p_place text default null::text, p_lat double precision default null::double precision, p_lng double precision default null::double precision,
  p_kind text default null::text, p_url text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_title text := public.olnu_ev_clean(p_title);
  v_place text := left(public.olnu_ev_clean(p_place), 60);
  v_url text := public.olnu_ev_clean(p_url);
  v_bar text := left(public.olnu_ev_clean(p_bar_id), 80);
  v_lat float8 := p_lat; v_lng float8 := p_lng;
  b record; d record; v_id bigint; v_day timestamptz;
  v_known boolean; v_trust text; v_status text; v_reason text;
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
  perform pg_advisory_xact_lock(hashtextextended('olnu-evtip:' || coalesce(v_uid::text, ''), 0));
  if exists (select 1 from public.bar_events e where e.created_by = v_uid and e.created_at > now() - interval '30 seconds') then
    raise exception 'slow_down';
  end if;
  if (select count(*) from public.bar_events e where e.created_by = v_uid and e.source = 'user' and e.created_at >= v_day) >= 3 then   -- (b)
    raise exception 'tip_limit';
  end if;
  v_known := public.olnu_ev_known_bar(v_bar, v_lat, v_lng);
  -- (a) a second different user, same event: the first tip turns ok, no duplicate row
  if v_known and not public.olnu_ev_tip_penalty(v_uid) then
    select e.id, e.status, e.bar_id into d from public.bar_events e
     where e.source = 'user' and e.created_by is distinct from v_uid and e.status in ('pending', 'ok') and e.expires_at > now()
       and abs(extract(epoch from (e.starts_at - p_starts_at))) <= 7200
       and ((v_bar is not null and e.bar_id = v_bar)
         or (e.lat is not null and (power((e.lat - v_lat) * 111320, 2) + power((e.lng - v_lng) * 111320 * cos(radians(v_lat)), 2)) <= 100 * 100))
       and public.olnu_ev_tip_same(e.title, v_title)
     order by (e.status = 'ok') desc, e.created_at
     limit 1;
    if found then
      if d.status = 'pending' then
        update public.bar_events e set status = 'ok', status_reason = 'confirmed', status_at = now(), updated_at = now() where e.id = d.id;
      end if;
      return jsonb_build_object('id', d.id, 'status', 'ok', 'bar_id', d.bar_id, 'reason', 'confirmed', 'dup', true);
    end if;
  end if;
  v_trust := public.olnu_ev_tip_trust(v_uid);
  if v_known and v_trust is not null then v_status := 'ok'; v_reason := 'auto:' || v_trust;
  else
    v_status := 'pending';
    v_reason := case when not v_known then 'not_bar' when public.olnu_ev_tip_penalty(v_uid) then 'penalty' else 'new_user' end;
  end if;
  insert into public.bar_events (source, title, kind, starts_at, bar_id, place, lat, lng, town, url, status, status_reason, status_at, created_by, expires_at)
  values ('user', v_title, public.olnu_ev_kind(v_title, p_kind), p_starts_at, v_bar, v_place, round(v_lat::numeric, 5), round(v_lng::numeric, 5),
          public.olnu_town_of(v_lat, v_lng), v_url, v_status, v_reason, case when v_status = 'ok' then now() end, v_uid, p_starts_at + interval '5 hours')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', v_status, 'bar_id', v_bar, 'reason', v_reason);
end; $function$;

-- (c) "Stämmer inte?" on a user event. → {ok, n, hidden}
create or replace function public.report_event_tip(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  e record; v_n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select x.id, x.status, x.source, x.created_by into e from public.bar_events x where x.id = p_id and x.expires_at > now();
  if not found or e.source <> 'user' then raise exception 'invalid_target'; end if;
  if e.created_by = v_uid then raise exception 'own_event'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-evrep:' || p_id::text, 0));
  if (select count(*) from public.event_tip_reports r where r.user_id = v_uid and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.event_tip_reports (event_id, user_id) values (p_id, v_uid) on conflict do nothing;
  select count(*) into v_n from public.event_tip_reports r where r.event_id = p_id;
  if v_n >= 3 and e.status <> 'hidden' then
    update public.bar_events x set status = 'hidden', status_reason = 'reports', status_at = now(), updated_at = now() where x.id = p_id;
    return jsonb_build_object('ok', true, 'n', v_n, 'hidden', true);
  end if;
  if e.status = 'ok' then
    update public.bar_events x set status_reason = 'reported', updated_at = now() where x.id = p_id and coalesce(x.status_reason, '') <> 'reported';
  end if;
  return jsonb_build_object('ok', true, 'n', v_n, 'hidden', e.status = 'hidden');
end; $$;

-- owner list: + reason + reports; the default "pending" list also holds reported events that are still visible
create or replace function public.owner_events(p_key text, p_status text default 'pending'::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select e.status s, count(*) n from public.bar_events e where e.expires_at > now() group by 1) c),
    'reported', (select count(*) from public.bar_events e where e.expires_at > now() and e.status = 'ok' and e.status_reason = 'reported'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'kind', e.kind, 'starts_at', e.starts_at, 'place', e.place,
                 'bar_id', e.bar_id, 'town', e.town, 'url', e.url, 'source', e.source, 'status', e.status, 'created_at', e.created_at,
                 'reason', e.status_reason, 'reports', (select count(*) from public.event_tip_reports r where r.event_id = e.id)) order by e.starts_at)
              from (select * from public.bar_events x where x.expires_at > now()
                      and (v_s = 'all' or x.status = v_s or (v_s = 'pending' and x.status = 'ok' and x.status_reason = 'reported'))
                     order by x.starts_at limit 300) e), '[]'::jsonb));
end; $function$;

create or replace function public.owner_set_event(p_key text, p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_s text := lower(btrim(coalesce(p_status, '')));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('pending', 'ok', 'hidden') then raise exception 'invalid_status'; end if;
  update public.bar_events e set status = v_s, status_reason = 'owner', status_at = now(), updated_at = now() where e.id = p_id;
  if not found then raise exception 'event_not_found'; end if;
  return jsonb_build_object('ok', true, 'status', v_s);
end; $function$;

do $g$
begin
  execute 'revoke all on function public.olnu_ev_tip_penalty(uuid), public.olnu_ev_tip_trust(uuid), public.olnu_ev_known_bar(text, double precision, double precision), public.olnu_ev_tip_same(text, text), public.report_event_tip(bigint) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_ev_tip_penalty(uuid), public.olnu_ev_tip_trust(uuid), public.olnu_ev_known_bar(text, double precision, double precision), public.olnu_ev_tip_same(text, text), public.report_event_tip(bigint) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_ev_tip_penalty(uuid), public.olnu_ev_tip_trust(uuid), public.olnu_ev_known_bar(text, double precision, double precision), public.olnu_ev_tip_same(text, text) from authenticated';
    execute 'grant execute on function public.report_event_tip(bigint) to authenticated';
  end if;
end $g$;

-- CR-safe (0436): a CR LF paste leaves no CR in the stored text of the functions above.
do $cr$ begin
  if to_regproc('public.olnu_strip_cr') is not null then perform public.olnu_strip_cr(); end if;
end $cr$;
