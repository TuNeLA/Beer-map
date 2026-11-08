-- 0330 PNLOG · usage events + check-in validation (position) log + owner analytics. ADDITIVE ONLY (new tables, new functions,
-- one new flag table, one new cron job). Client: docs/js/pnlog.js. Owner panel: docs/stats-pnlog.js. Idempotent.
--
-- Server flag pn_log_flags.key = 'beta_logging' (one switch for the whole log):
--   'on'    = beta period (default): full usage events + position log, ON by default, user switch in Inställningar turns it off.
--   'optin' = store launch: only error/crash events for everyone; full events + position log only for a user who said yes
--             on the one-screen ask (client sends cons = true).
--   'off'   = only error/crash events (no usage events, no position).
--   'none'  = nothing is stored at all.
--   Change it:  update public.pn_log_flags set value = 'optin', updated_at = now() where key = 'beta_logging';
--
-- Storage: pn_events = ONE row per batch (jsonb array, max 300 events, max 1 batch per ~60 s per phone).
--          pn_loclog = one row per reading / decision / check-in (max 60 per batch).
--          pn_event_daily = rollup per night + event + key (no user id). Kept after the raw rows are emptied.
-- Retention (job 'pnlog-retention', 03:27 UTC): after 30 days the raw rows are emptied with UPDATE (ev, user id, position
--   set to null). The rows stay (no row-removing statement, same rule as 0210). A user's own rows also go with
--   the "Radera mina data" function from 0209 (its generic sweep covers every public uuid column named user_id).
-- Access: RLS on, no policies, no grants: only these SECURITY DEFINER functions read or write the tables.

create extension if not exists pg_cron;

-- own flag table (app_store_flags has a fixed key list and only on/off values)
create table if not exists public.pn_log_flags (
  key        text primary key check (key in ('beta_logging')),
  value      text not null check (value in ('on', 'optin', 'off', 'none')),
  updated_at timestamptz not null default now()
);
alter table public.pn_log_flags enable row level security;
revoke all on public.pn_log_flags from public, anon, authenticated;
insert into public.pn_log_flags (key, value) values ('beta_logging', 'on') on conflict (key) do nothing;

create table if not exists public.pn_events (
  id      bigint generated always as identity primary key,
  user_id uuid,
  day     date not null,                       -- the night (Europe/Stockholm, 05:00 → 05:00)
  at      timestamptz not null default now(),  -- server receive time
  ver     text,
  ch      text,                                -- 'stable' | 'beta' | 'store'
  sess    text,                                -- random id per app start (not stored on the phone)
  sq      int,
  n       int not null default 0,
  bytes   int not null default 0,
  ev      jsonb                                -- [{t, n, p}]
);
create index if not exists pn_events_day_idx on public.pn_events (day);
create index if not exists pn_events_user_idx on public.pn_events (user_id, at);
alter table public.pn_events enable row level security;
revoke all on public.pn_events from public, anon, authenticated;

create table if not exists public.pn_loclog (
  id      bigint generated always as identity primary key,
  user_id uuid,
  day     date not null,
  at      timestamptz not null,                -- phone time of the reading / decision (clamped)
  recv_at timestamptz not null default now(),
  sess    text,
  kind    text not null,                       -- fix | eval | ask | answer | auto_in | auto_out | ci | co | beer | notice
  lat     double precision,
  lng     double precision,
  acc     real,
  bar_id  text,
  ci      text,                                -- the bar the user was checked in at when this was logged
  d       jsonb                                -- detail: nearest spots [{id, m, bl}], decision, answer …
);
create index if not exists pn_loclog_day_idx on public.pn_loclog (day);
create index if not exists pn_loclog_user_idx on public.pn_loclog (user_id, at);
alter table public.pn_loclog enable row level security;
revoke all on public.pn_loclog from public, anon, authenticated;

create table if not exists public.pn_event_daily (
  day   date not null,
  name  text not null,
  k     text not null default '',
  n     bigint not null default 0,
  users int not null default 0,
  primary key (day, name, k)
);
alter table public.pn_event_daily enable row level security;
revoke all on public.pn_event_daily from public, anon, authenticated;

-- props → only short scalar values under short lowercase keys; never names, text, positions, ids or e-mail
create or replace function public.pnlog_clean(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select k, v from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) as x(k, v)
     where k ~ '^[a-z][a-z0-9_]{0,15}$'
       and k <> all (array['lat','lng','lon','latitude','longitude','name','names','text','msg','body','email','mail','phone','code','title','q','query','uid','user'])
       and (jsonb_typeof(v) in ('number', 'boolean')
            or (jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 140
                and (v #>> '{}') !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}'
                and position('@' in (v #>> '{}')) = 0))
     limit 12) y $$;

create or replace function public.pnlog_mode() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select f.value from public.pn_log_flags f where f.key = 'beta_logging'), 'on') $$;

create or replace function public.pnlog_day(ts timestamptz) returns date
language sql immutable set search_path = public as $$ select ((ts at time zone 'Europe/Stockholm') - interval '5 hours')::date $$;
revoke all on function public.pnlog_mode() from public, anon, authenticated;
revoke all on function public.pnlog_clean(jsonb) from public, anon, authenticated;
revoke all on function public.pnlog_day(timestamptz) from public, anon, authenticated;

-- p = {v:1, t0 (phone epoch ms), ver, ch, sess, sq, cons (bool: said yes on the ask), ev:[{t,n,p}], loc:[{t,k,la,ln,a,b,ci,d}]}
create or replace function public.pnlog_ingest(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.olnu_uid();
  v_mode text := public.pnlog_mode();
  v_full boolean;
  v_t0 timestamptz;
  v_ev jsonb; v_ne int := 0; v_nl int := 0;
  v_sess text := left(coalesce(p->>'sess', ''), 16);
begin
  if v_mode = 'none' or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', true, 'mode', v_mode, 'ev', 0, 'loc', 0); end if;
  if length(p::text) > 120000 then return jsonb_build_object('ok', false, 'reason', 'too_big', 'mode', v_mode); end if;
  if (select count(*) from public.pn_events x where x.user_id = me and x.at > now() - interval '1 minute') >= 8 then
    return jsonb_build_object('ok', false, 'reason', 'too_soon', 'mode', v_mode);
  end if;
  v_full := v_mode = 'on' or (v_mode = 'optin' and coalesce((p->>'cons')::boolean, false));
  v_t0 := case when (p->>'t0') ~ '^\d{12,14}$' then to_timestamp((p->>'t0')::bigint / 1000.0) else now() end;
  if v_t0 > now() + interval '5 minutes' or v_t0 < now() - interval '36 hours' then v_t0 := now(); end if;

  select coalesce(jsonb_agg(jsonb_build_object('t', case when (e->>'t') ~ '^\d{1,9}$' then (e->>'t')::int else 0 end,
                                               'n', e->>'n', 'p', public.pnlog_clean(e->'p'))), '[]'::jsonb), count(*)
    into v_ev, v_ne
    from (select e from jsonb_array_elements(case when jsonb_typeof(p->'ev') = 'array' then p->'ev' else '[]'::jsonb end) e limit 300) z
   where (e->>'n') ~ '^[a-z][a-z0-9_.:-]{0,39}$' and (v_full or (e->>'n') like 'err.%');
  if v_ne > 0 then
    insert into public.pn_events (user_id, day, ver, ch, sess, sq, n, bytes, ev)
    values (me, public.pnlog_day(now()), left(p->>'ver', 24), left(p->>'ch', 12), v_sess,
            case when (p->>'sq') ~ '^\d{1,6}$' then (p->>'sq')::int else 0 end, v_ne, length(v_ev::text), v_ev);
  end if;

  if v_full and jsonb_typeof(p->'loc') = 'array' then
    insert into public.pn_loclog (user_id, day, at, sess, kind, lat, lng, acc, bar_id, ci, d)
    select me, public.pnlog_day(ts), ts, v_sess, l->>'k',
           case when (l->>'la') ~ '^-?\d{1,2}(\.\d+)?$' and abs((l->>'la')::float8) <= 90 then round((l->>'la')::numeric, 6)::float8 end,
           case when (l->>'ln') ~ '^-?\d{1,3}(\.\d+)?$' and abs((l->>'ln')::float8) <= 180 then round((l->>'ln')::numeric, 6)::float8 end,
           case when (l->>'a') ~ '^\d{1,6}(\.\d+)?$' then least((l->>'a')::real, 100000) end,
           left(l->>'b', 64), left(l->>'ci', 64),
           case when jsonb_typeof(l->'d') = 'object' and length((l->'d')::text) <= 2000 then l->'d' end
      from (select l, least(greatest(v_t0 + make_interval(secs => case when (l->>'t') ~ '^\d{1,9}$' then (l->>'t')::int / 1000.0 else 0 end),
                                     now() - interval '36 hours'), now() + interval '1 minute') ts
              from jsonb_array_elements(p->'loc') l limit 60) z
     where (l->>'k') in ('fix', 'eval', 'ask', 'answer', 'auto_in', 'auto_out', 'ci', 'co', 'beer', 'notice');
    get diagnostics v_nl = row_count;
  end if;
  return jsonb_build_object('ok', true, 'mode', v_mode, 'ev', v_ne, 'loc', v_nl);
end $$;
revoke all on function public.pnlog_ingest(jsonb) from public, anon;
grant execute on function public.pnlog_ingest(jsonb) to authenticated;

-- the user's switch "Spara position" off → the position log of this user is emptied at once (UPDATE, not removed)
create or replace function public.pnlog_forget_loc()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.olnu_uid(); n int;
begin
  update public.pn_loclog x set lat = null, lng = null, acc = null, d = null, bar_id = null, ci = null, user_id = null, sess = null
   where x.user_id = me;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n);
end $$;
revoke all on function public.pnlog_forget_loc() from public, anon;
grant execute on function public.pnlog_forget_loc() to authenticated;

-- nightly: rollup (no user ids) for finished nights, then empty raw rows older than 30 days
create or replace function public.pnlog_retention_run()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cut date := public.pnlog_day(now()) - 30; d0 date; nr int := 0; ne int; nl int;
begin
  for d0 in select distinct x.day from public.pn_events x
             where x.day < public.pnlog_day(now()) and x.day >= v_cut and x.ev is not null
               and not exists (select 1 from public.pn_event_daily r where r.day = x.day and r.name = '_rolled')
  loop
    insert into public.pn_event_daily (day, name, k, n, users)
    select d0, j->>'n', left(coalesce(j->'p'->>'k', j->'p'->>'s', j->'p'->>'fn', ''), 80), count(*), count(distinct x.user_id)
      from public.pn_events x cross join lateral jsonb_array_elements(x.ev) j
     where x.day = d0 and x.ev is not null
     group by 2, 3
    on conflict (day, name, k) do update set n = excluded.n, users = excluded.users;
    insert into public.pn_event_daily (day, name, k, n, users)
    select d0, '_rolled', '', count(*), count(distinct x.user_id) from public.pn_events x where x.day = d0
    on conflict (day, name, k) do update set n = excluded.n, users = excluded.users;
    nr := nr + 1;
  end loop;
  update public.pn_events x set ev = null, user_id = null, sess = null
   where x.day < v_cut and (x.ev is not null or x.user_id is not null);
  get diagnostics ne = row_count;
  update public.pn_loclog x set lat = null, lng = null, acc = null, d = null, user_id = null, sess = null
   where x.day < v_cut and (x.user_id is not null or x.lat is not null);
  get diagnostics nl = row_count;
  return jsonb_build_object('ok', true, 'rolled_days', nr, 'events_emptied', ne, 'loc_emptied', nl, 'cut', v_cut);
end $$;
revoke all on function public.pnlog_retention_run() from public, anon, authenticated;

select cron.schedule('pnlog-retention', '27 3 * * *', $c$select public.pnlog_retention_run()$c$)
 where not exists (select 1 from cron.job j where j.jobname = 'pnlog-retention');

-- ---------- owner panels (docs/stats-pnlog.js). Same owner key as every owner_* function. ----------
create or replace function public.owner_pnlog(p_key text, p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d int := least(greatest(coalesce(p_days, 7), 1), 30); v_from date; r jsonb;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  v_from := public.pnlog_day(now()) - (d - 1);
  with b as (select * from public.pn_events x where x.day >= v_from and x.ev is not null),
  e as (select b.user_id, b.day, b.sess, b.ver, b.ch, j->>'n' n, j->'p' p from b cross join lateral jsonb_array_elements(b.ev) j)
  select jsonb_build_object(
    'mode', public.pnlog_mode(),
    'days', d,
    'batches', (select count(*) from b),
    'bytes', (select coalesce(sum(bytes), 0) from b),
    'events', (select count(*) from e),
    'dau', coalesce((select jsonb_agg(x order by x.day) from (
        select day, count(distinct user_id) users, count(distinct sess) sessions, sum(n) events, sum(bytes) bytes from b group by day) x), '[]'),
    'wau', (select count(distinct user_id) from public.pn_events x where x.day >= public.pnlog_day(now()) - 6 and x.user_id is not null),
    'mau', (select count(distinct user_id) from public.pn_events x where x.day >= public.pnlog_day(now()) - 29 and x.user_id is not null),
    'screens', coalesce((select jsonb_agg(x) from (
        select p->>'s' s, count(*) n, count(distinct user_id) users,
               percentile_disc(0.5) within group (order by case when (p->>'ms') ~ '^\d+$' then (p->>'ms')::int end) ms50
          from e where n = 'sheet.open' group by 1 order by 2 desc limit 40) x), '[]'),
    'taps', coalesce((select jsonb_agg(x) from (
        select coalesce(p->>'s', '') s, p->>'k' k, count(*) n, count(distinct user_id) users
          from e where n = 'tap' group by 1, 2 order by 3 desc limit 60) x), '[]'),
    'features', coalesce((select jsonb_agg(x) from (
        select p->>'fn' fn, count(*) n, count(distinct user_id) users, sum(case when (p->>'ok') = 'false' then 1 else 0 end) fails
          from e where n = 'rpc' group by 1 order by 2 desc limit 40) x), '[]'),
    'errors', coalesce((select jsonb_agg(x) from (
        select n, coalesce(p->>'m', p->>'c', '') m, coalesce(p->>'f', p->>'fn', '') f, count(*) cnt, count(distinct user_id) users, max(ver) ver
          from e where n like 'err.%' group by 1, 2, 3 order by 4 desc limit 30) x), '[]'),
    'perf', coalesce((select jsonb_agg(x order by x.m) from (
        select n m, count(*) cnt,
               percentile_cont(0.5) within group (order by (p->>'v')::float8) p50,
               percentile_cont(0.95) within group (order by (p->>'v')::float8) p95
          from e where n like 'perf.%' and (p->>'v') ~ '^\d+(\.\d+)?$' group by 1) x), '[]'),
    'versions', coalesce((select jsonb_agg(x) from (
        select ver, ch, count(distinct user_id) users, count(*) batches from b group by 1, 2 order by 3 desc limit 15) x), '[]'),
    'sess_sec', (select jsonb_build_object('p50', percentile_cont(0.5) within group (order by (p->>'sec')::float8),
                                           'p90', percentile_cont(0.9) within group (order by (p->>'sec')::float8), 'n', count(*))
                   from e where n = 'app.hide' and (p->>'sec') ~ '^\d+(\.\d+)?$'),
    'funnel_beer', (select jsonb_build_object(
        'open', count(distinct sess) filter (where n = 'app.open'),
        'tap', count(distinct sess) filter (where n = 'tap' and p->>'k' = 'btn-beer'),
        'post', count(distinct sess) filter (where n = 'rpc' and p->>'fn' in ('post_beer_v2', 'post_beer') and coalesce(p->>'ok', 'true') <> 'false')) from e),
    'funnel_join', (select jsonb_build_object(
        'invite', count(distinct sess) filter (where n = 'tap' and (p->>'k') ~* 'invite|bjud|share'),
        'preview', count(distinct sess) filter (where n = 'rpc' and p->>'fn' in ('join_preview', 'ev_preview')),
        'join', count(distinct sess) filter (where n = 'rpc' and p->>'fn' in ('join_group', 'ev_join') and coalesce(p->>'ok', 'true') <> 'false')) from e),
    'daily', coalesce((select jsonb_agg(x order by x.day) from (
        select day, sum(n) filter (where name = 'app.open') opens, sum(n) filter (where name = 'tap') taps,
               sum(n) filter (where name like 'err.%') errors, max(users) filter (where name = '_rolled') users
          from public.pn_event_daily where day >= public.pnlog_day(now()) - 90 group by day) x), '[]')
  ) into r;
  return r;
end $$;
revoke all on function public.owner_pnlog(text, int) from public;
grant execute on function public.owner_pnlog(text, int) to anon, authenticated;

-- raw position / check-in rows for the "Auto-incheckning" quality view (the panel does the maths and the replay)
create or replace function public.owner_pnlog_loc(p_key text, p_days int default 7, p_limit int default 20000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int := least(greatest(coalesce(p_days, 7), 1), 30); lim int := least(greatest(coalesce(p_limit, 20000), 1), 50000);
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('mode', public.pnlog_mode(), 'rows', coalesce((select jsonb_agg(x order by x.u, x.at) from (
    select dense_rank() over (order by l.user_id) u, (extract(epoch from l.at) * 1000)::bigint at, l.kind k,
           l.lat la, l.lng ln, l.acc a, l.bar_id b, l.ci, l.d
      from public.pn_loclog l
     where l.day >= public.pnlog_day(now()) - (v_days - 1) and l.user_id is not null
     order by l.at desc limit lim) x), '[]'));
end $$;
revoke all on function public.owner_pnlog_loc(text, int, int) from public;
grant execute on function public.owner_pnlog_loc(text, int, int) to anon, authenticated;
