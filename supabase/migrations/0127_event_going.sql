-- Öl Nu — 📅 GÅR (CONTRACT "📅 EVENT-ARKET 2: Går, Vänner går, detaljvy, karta"). Additive, needs 0001, 0045 (friendships,
-- olnu_friend_name), 0065 (bar_events). No row is ever removed: "Går" off = going false; reminders set reminded_at.
--   event_going(event_id, user_id, going, reminded_at, told_at, changes, created_at, updated_at) pk (event_id, user_id)
--   event_go(p_event_id, p_on default true)            -> jsonb event state (see olnu_evgo_json)
--   event_go_tell(p_event_id)                          -> jsonb {ok, first} — "Säg till gruppen?" once per event and person
--   events_going(p_ids bigint[] default null, p_days default 31)
--        -> jsonb {v, events:[state for p_ids that anybody goes to], friends:[upcoming events my friends / group mates go to]}
-- Visibility: names only for the caller's circle (accepted friends ∪ everyone in a shared group, like friend_list);
-- everyone else is only a number (total). Never user ids.

create table if not exists public.event_going (
  event_id    bigint not null references public.bar_events(id),
  user_id     uuid not null,
  going       boolean not null default true,
  reminded_at timestamptz,
  told_at     timestamptz,
  changes     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_going_user_idx on public.event_going (user_id, updated_at desc);
create index if not exists event_going_due_idx on public.event_going (event_id) where going and reminded_at is null;
alter table public.event_going enable row level security;
revoke all on table public.event_going from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on table public.event_going from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on table public.event_going from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant all on table public.event_going to service_role'; end if;
end $$;

-- The caller's circle: accepted friends ∪ everyone in a shared group (same rule as olnu_inv_cands, without the keys).
create or replace function public.olnu_evgo_circle(p_uid uuid)
returns table (uid uuid)
language sql stable security definer set search_path = public as $$
  select distinct x.uid from (
    select public.olnu_friend_other(f, p_uid) as uid
      from public.friendships f
     where (f.a = p_uid or f.b = p_uid) and f.status = 'accepted'
    union
    select gm2.user_id
      from public.group_members gm
      join public.group_members gm2 on gm2.group_id = gm.group_id
     where gm.user_id = p_uid and gm2.user_id <> p_uid
  ) x
  where x.uid is not null and x.uid <> p_uid
  limit 2000;
$$;

-- State of one event for a viewer: {id, mine, n (circle + me going), total (everyone going), who:[{name, me}] (me first, max 8),
-- remind (a 1 h reminder is still coming), told}
create or replace function public.olnu_evgo_json(p_id bigint, p_viewer uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me public.event_going;
  v_total int; v_n int; v_who jsonb; v_start timestamptz;
begin
  select * into v_me from public.event_going g where g.event_id = p_id and g.user_id = p_viewer;
  select count(*) into v_total from public.event_going g where g.event_id = p_id and g.going;
  with c as (select uid from public.olnu_evgo_circle(p_viewer)),
       w as (select g.user_id, g.updated_at, (g.user_id = p_viewer) as me
               from public.event_going g
              where g.event_id = p_id and g.going and (g.user_id = p_viewer or g.user_id in (select uid from c)))
  select count(*)::int,
         coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(public.olnu_friend_name(y.user_id), '?'), 'me', y.me) order by y.me desc, y.updated_at)
                     from (select * from w order by w.me desc, w.updated_at limit 8) y), '[]'::jsonb)
    into v_n, v_who from w;
  select e.starts_at into v_start from public.bar_events e where e.id = p_id;
  return jsonb_build_object('id', p_id, 'mine', coalesce(v_me.going, false), 'n', v_n, 'total', v_total, 'who', v_who,
    'remind', coalesce(v_me.going, false) and v_me.reminded_at is null and v_start > now() + interval '50 minutes',
    'told', v_me.told_at is not null);
end; $$;

create or replace function public.event_go(p_event_id bigint, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_on boolean := coalesce(p_on, true);
  v_row public.event_going;
  v_recent int;
begin
  if not exists (select 1 from public.bar_events e
                  where e.id = p_event_id and e.status = 'ok' and e.expires_at > now()
                    and e.starts_at < now() + interval '32 days') then
    raise exception 'event_not_found';
  end if;
  select * into v_row from public.event_going g where g.event_id = p_event_id and g.user_id = v_uid;
  if found then
    if v_row.going = v_on then return public.olnu_evgo_json(p_event_id, v_uid); end if;
    if v_row.updated_at > now() - interval '2 seconds' then raise exception 'slow_down'; end if;
  end if;
  select count(*) into v_recent from public.event_going g where g.user_id = v_uid and g.updated_at > now() - interval '10 minutes';
  if v_recent >= 40 then raise exception 'slow_down'; end if;
  insert into public.event_going as g (event_id, user_id, going) values (p_event_id, v_uid, v_on)
  on conflict (event_id, user_id) do update set going = excluded.going, updated_at = now(), changes = g.changes + 1;
  return public.olnu_evgo_json(p_event_id, v_uid);
end; $$;

create or replace function public.event_go_tell(p_event_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_n int;
begin
  update public.event_going g set told_at = now()
   where g.event_id = p_event_id and g.user_id = v_uid and g.going and g.told_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'first', v_n > 0);
end; $$;

create or replace function public.events_going(p_ids bigint[] default null, p_days int default 31)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_days int := greatest(1, least(31, coalesce(p_days, 31)));
  v_ids bigint[] := (select array_agg(distinct x) from (select unnest(coalesce(p_ids, '{}'::bigint[])) x limit 400) s);
  v_ev jsonb; v_fr jsonb;
begin
  select coalesce(jsonb_agg(public.olnu_evgo_json(d.event_id, v_uid) order by d.event_id), '[]'::jsonb) into v_ev
    from (select distinct g.event_id from public.event_going g
           where g.event_id = any(coalesce(v_ids, '{}'::bigint[])) and g.going) d;
  with c as (select uid from public.olnu_evgo_circle(v_uid)),
       f as (select distinct g.event_id from public.event_going g where g.going and g.user_id in (select uid from c))
  select coalesce(jsonb_agg(public.olnu_evgo_json(e.id, v_uid) || jsonb_build_object(
           'title', e.title, 'kind', e.kind, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'bar_id', e.bar_id, 'place', e.place,
           'lat', e.lat, 'lng', e.lng, 'town', e.town, 'sport', e.sport, 'league', e.league, 'home', e.home, 'away', e.away, 'tv', e.tv,
           'url', e.url, 'source', e.source, 'pending', false, 'is_mine', false,
           'ticket_url', coalesce(e.ticket_url, case when e.source in ('ticketmaster', 'tickster') then e.url end))
           order by e.starts_at, e.id), '[]'::jsonb) into v_fr
    from (select e.* from public.bar_events e join f on f.event_id = e.id
           where e.status = 'ok' and e.expires_at > now() and e.starts_at < now() + make_interval(days => v_days)
           order by e.starts_at, e.id limit 20) e;
  return jsonb_build_object('v', 1, 'events', v_ev, 'friends', v_fr);
end; $$;

do $$
declare
  v_pub text := 'public.event_go(bigint, boolean), public.event_go_tell(bigint), public.events_going(bigint[], int)';
  v_int text := 'public.olnu_evgo_circle(uuid), public.olnu_evgo_json(bigint, uuid)';
begin
  execute 'revoke all on function ' || v_pub || ', ' || v_int || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || v_pub || ', ' || v_int || ' from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_int || ' from authenticated';
    execute 'grant execute on function ' || v_pub || ' to authenticated';
  end if;
end $$;
