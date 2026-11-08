-- 0360 PNLOG more (agent lgx, 2026-11-08). ADDITIVE: new tables pn_log_opts + pn_ping_daily, new functions, new versions of
-- pnlog_mode / pnlog_ingest (same signatures; they only accept more). Client: docs/js/pnlog.js + docs/js/pnlog-hooks.js.
-- Owner panel: docs/stats-logg.js (owner_pnlog_x). Idempotent.
--
-- Event classes (same rule as pnlog.js cls()):
--   err   = err.*                                     → every mode except 'none'
--   keep  = crash.*, dev, dev.*, net.*, sw.*, perf.(boot|load|fcp|lcp|cls|long|map|rpc|self|inp|ft|mem)
--           diagnostics, no usage, no position         → 'on', 'optin', 'lite'
--   heavy = tap, tap.*, sheet.view, map.cam, perf.sheet, set.ls, ac.eval
--           high-volume usage                          → like 'use' AND pn_log_opts heavy = 'on'
--   use   = everything else (usage)                    → 'on', or 'optin' + the user said yes
-- Modes: on | optin | lite (err + keep only) | off (err only) | none.
--   The mode comes from pn_log_opts key 'mode' when that row exists, else from pn_log_flags (0330).
--   Store launch:  insert into public.pn_log_opts (key, value) values ('mode', 'optin') on conflict (key) do update set value = excluded.value, updated_at = now();
--                  update public.pn_log_opts set value = 'off', updated_at = now() where key = 'heavy';
--   Diagnostics only:  ... values ('mode', 'lite') ...

create table if not exists public.pn_log_opts (
  key        text primary key check (key in ('mode', 'heavy')),
  value      text not null check ((key = 'mode' and value in ('on', 'optin', 'lite', 'off', 'none')) or (key = 'heavy' and value in ('on', 'off'))),
  updated_at timestamptz not null default now()
);
alter table public.pn_log_opts enable row level security;
revoke all on public.pn_log_opts from public, anon, authenticated;
insert into public.pn_log_opts (key, value) values ('heavy', 'on') on conflict (key) do nothing;

-- anonymous funnel counters before an account exists (day + key + count; no user, no id, no ip)
create table if not exists public.pn_ping_daily (
  day date not null,
  k   text not null,
  n   bigint not null default 0,
  primary key (day, k)
);
alter table public.pn_ping_daily enable row level security;
revoke all on public.pn_ping_daily from public, anon, authenticated;

create or replace function public.pnlog_mode() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select o.value from public.pn_log_opts o where o.key = 'mode'),
                  (select f.value from public.pn_log_flags f where f.key = 'beta_logging'), 'on') $$;
revoke all on function public.pnlog_mode() from public, anon, authenticated;

create or replace function public.pnlog_heavy() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select o.value from public.pn_log_opts o where o.key = 'heavy'), 'on') <> 'off' $$;
revoke all on function public.pnlog_heavy() from public, anon, authenticated;

create or replace function public.pnlog_class(n text) returns text
language sql immutable set search_path = public as $$
  select case when n like 'err.%' then 'err'
              when n ~ '^(crash\.|dev$|dev\.|net\.|sw\.|perf\.(boot|load|fcp|lcp|cls|long|map|rpc|self|inp|ft|mem)$)' then 'keep'
              when n ~ '^(tap$|tap\.|sheet\.view$|map\.cam$|perf\.sheet$|set\.ls$|ac\.eval$)' then 'heavy'
              else 'use' end $$;
revoke all on function public.pnlog_class(text) from public, anon, authenticated;

-- same contract as 0330; accepts events by class
create or replace function public.pnlog_ingest(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.olnu_uid();
  v_mode text := public.pnlog_mode();
  v_heavy_flag boolean := public.pnlog_heavy();
  v_full boolean; v_keep boolean; v_heavy boolean;
  v_t0 timestamptz;
  v_ev jsonb; v_ne int := 0; v_nl int := 0;
  v_sess text := left(coalesce(p->>'sess', ''), 16);
begin
  if v_mode = 'none' or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', true, 'mode', v_mode, 'heavy', v_heavy_flag, 'ev', 0, 'loc', 0); end if;
  if length(p::text) > 120000 then return jsonb_build_object('ok', false, 'reason', 'too_big', 'mode', v_mode, 'heavy', v_heavy_flag); end if;
  if (select count(*) from public.pn_events x where x.user_id = me and x.at > now() - interval '1 minute') >= 8 then
    return jsonb_build_object('ok', false, 'reason', 'too_soon', 'mode', v_mode, 'heavy', v_heavy_flag);
  end if;
  v_full := v_mode = 'on' or (v_mode = 'optin' and coalesce((p->>'cons')::boolean, false));
  v_keep := v_mode in ('on', 'optin', 'lite');
  v_heavy := v_full and v_heavy_flag;
  v_t0 := case when (p->>'t0') ~ '^\d{12,14}$' then to_timestamp((p->>'t0')::bigint / 1000.0) else now() end;
  if v_t0 > now() + interval '5 minutes' or v_t0 < now() - interval '36 hours' then v_t0 := now(); end if;

  select coalesce(jsonb_agg(jsonb_build_object('t', case when (e->>'t') ~ '^\d{1,9}$' then (e->>'t')::int else 0 end,
                                               'n', e->>'n', 'p', public.pnlog_clean(e->'p'))), '[]'::jsonb), count(*)
    into v_ev, v_ne
    from (select e from jsonb_array_elements(case when jsonb_typeof(p->'ev') = 'array' then p->'ev' else '[]'::jsonb end) e limit 300) z
   where (e->>'n') ~ '^[a-z][a-z0-9_.:-]{0,39}$'
     and (case public.pnlog_class(e->>'n') when 'err' then true when 'keep' then v_keep when 'heavy' then v_heavy else v_full end);
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
  return jsonb_build_object('ok', true, 'mode', v_mode, 'heavy', v_heavy_flag, 'ev', v_ne, 'loc', v_nl);
end $$;
revoke all on function public.pnlog_ingest(jsonb) from public, anon;
grant execute on function public.pnlog_ingest(jsonb) to authenticated;

-- anonymous counter (only in mode 'on', only known keys)
create or replace function public.pnlog_ping(p_k text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.pnlog_mode() <> 'on' or p_k is null or p_k !~ '^(ob|inv|pub)\.[a-z_.]{1,24}$' then return jsonb_build_object('ok', false); end if;
  insert into public.pn_ping_daily (day, k, n) values (public.pnlog_day(now()), p_k, 1)
  on conflict (day, k) do update set n = least(public.pn_ping_daily.n + 1, 1000000);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.pnlog_ping(text) from public;
grant execute on function public.pnlog_ping(text) to anon, authenticated;

-- RPC name → feature (for the "Funktioner" table)
create or replace function public.pnlog_feat(fn text) returns text
language sql immutable set search_path = public as $$
  select case
    when fn ~ '^(post_beer|undo_beer|stop_beer|set_beer_type)' then 'öl'
    when fn ~ '^post_other' then 'annat'
    when fn in ('check_in', 'check_out') then 'incheckning'
    when fn in ('post_group_msg', 'react_msg', 'react', 'react_v2') then 'chatt'
    when fn ~ '^(post_photo|bar_photo|group_photo|skal_photo|night_story_photo|film_)' then 'foto / kamera'
    when fn = 'post_voice' then 'röstklipp'
    when fn ~ '^skal' then 'skål'
    when fn = 'knuff_send' then 'knuffa'
    when fn ~ '^walk_' then 'följ mig hem'
    when fn ~ '^pickup_' then 'hämta mig'
    when fn in ('driver_set', 'ride_ask') then 'jag kör'
    when fn ~ '^(event_go|ev_join|submit_event|event_story|ev_link)' then 'event'
    when fn ~ '^(ikvall_|set_sugen|answer_status|status_report)' then 'ikväll'
    when fn in ('create_group', 'join_group', 'leave_group', 'remove_member') then 'grupper'
    when fn ~ '^(invite_|share_card|join_preview|ev_preview|link_preview)' then 'inbjudan / delning'
    when fn ~ '^(friend_|find_|set_find_share)' then 'vänner / hitta'
    when fn ~ '^dm_' then 'dm'
    when fn ~ '^(spel_|party_)' then 'spel (rum)'
    when fn ~ '^(duel_)' then 'duell'
    when fn ~ '^(game_|start_agent|vote_agent|guess_night|tick_bingo|evg_lek|mt_)' then 'lek'
    when fn ~ '^(crew_)' then 'truppen'
    when fn ~ '^(rnd_)' then 'rundan'
    when fn ~ '^(create_rally|answer_rally|close_rally)' then 'kom hit'
    when fn ~ '^(create_crawl|close_crawl)' then 'krogrunda'
    when fn ~ '^(set_my_avatar)' then 'avatar'
    when fn ~ '^(report_|block_user|unblock_user)' then 'rapportera / blockera'
    when fn ~ '^(account_|redeem_recovery|delete_my_data)' then 'konto'
    when fn ~ '^(save_push|set_push|delete_push)' then 'notiser'
    when fn ~ '^(pin_follow)' then 'följ pin'
    when fn ~ '^(golden_horse|claim_)' then 'meriter'
    when fn ~ '^(submit_wish|vote_wish|submit_feedback|suggest_place)' then 'tips / önskemål'
    else 'övrigt: ' || fn end $$;
revoke all on function public.pnlog_feat(text) from public, anon, authenticated;

-- ---------- owner panel "🧾 Logg" (docs/stats-logg.js). Same owner key as every owner_* function. ----------
create or replace function public.owner_pnlog_x(p_key text, p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d int := least(greatest(coalesce(p_days, 7), 1), 30); v_from date; v_today date := public.pnlog_day(now()); r jsonb;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  v_from := v_today - (d - 1);
  with b as (select * from public.pn_events x where x.day >= v_from and x.ev is not null),
  e as (select b.user_id u, b.day, b.sess, b.ver, b.ch, j->>'n' n, j->'p' p from b cross join lateral jsonb_array_elements(b.ev) j),
  dv as (select distinct on (sess) sess, p->>'os' os, coalesce(p->>'osv', '') osv, p->>'br' br, coalesce(nullif(p->>'mdl', ''), '?') mdl,
                case when (p->>'mem') ~ '^\d+(\.\d+)?$' then (p->>'mem')::numeric end mem
           from e where n = 'dev' order by sess),
  ed as (select e.*, coalesce(dv.os, '?') os, coalesce(dv.mdl, '?') mdl, dv.mem from e left join dv using (sess)),
  act as (   -- activity days for retention: log days + beer nights + check-ins
    select x.user_id u, x.day from public.pn_events x where x.user_id is not null
    union select bb.user_id, public.pnlog_day(bb.created_at) from public.beers bb where bb.created_at > now() - interval '60 days'
    union select c.user_id, public.pnlog_day(c.created_at) from public.checkins c where c.created_at > now() - interval '60 days'),
  coh as (select au.id u, public.pnlog_day(au.created_at) d0 from auth.users au where au.created_at > now() - interval '45 days'),
  ob as (select distinct u from e where n = 'ob.step')
  select jsonb_build_object(
    'mode', public.pnlog_mode(), 'heavy', public.pnlog_heavy(), 'days', d,
    'active', coalesce((select jsonb_agg(x order by x.day) from (
        select day, count(distinct user_id) users, count(distinct sess) sessions, sum(n) events,
               round(sum(bytes) / 1024.0 / greatest(count(distinct user_id), 1), 1) kb_user,
               (select round(max(s) / 1024.0, 1) from (select sum(y.bytes) s from public.pn_events y where y.day = b.day and y.ev is not null group by y.user_id) z) kb_max,
               (select count(distinct bb.user_id) from public.beers bb where public.pnlog_day(bb.created_at) = b.day) beer_users
          from b group by day) x), '[]'),
    'retention', coalesce((select jsonb_agg(x order by x.d0) from (
        select coh.d0, count(*) n,
               count(*) filter (where exists (select 1 from act a where a.u = coh.u and a.day = coh.d0 + 1)) d1,
               count(*) filter (where exists (select 1 from act a where a.u = coh.u and a.day between coh.d0 + 6 and coh.d0 + 8)) d7,
               count(*) filter (where exists (select 1 from act a where a.u = coh.u and a.day > coh.d0)) back
          from coh where coh.d0 >= v_today - 30 group by coh.d0) x), '[]'),
    'pings', coalesce((select jsonb_object_agg(k, n) from (select k, sum(n) n from public.pn_ping_daily where day >= v_from group by k) x), '{}'),
    'funnel_ob', jsonb_build_object(
        'intro', (select count(*) from ob),
        'done', (select count(distinct u) from e where n = 'ob.done'),
        'beer', (select count(distinct e.u) from e join ob using (u) where e.n = 'rpc' and e.p->>'fn' ~ '^post_beer' and coalesce(e.p->>'ok', 'true') <> 'false'),
        'group', (select count(distinct e.u) from e join ob using (u) where e.n = 'rpc' and e.p->>'fn' in ('join_group', 'create_group') and coalesce(e.p->>'ok', 'true') <> 'false'),
        'invite', (select count(distinct e.u) from e join ob using (u) where (e.n in ('share', 'copy') and e.p->>'k' in ('join', 'invite', 'ev', 'friend')) or (e.n = 'rpc' and e.p->>'fn' ~ '^(invite_create|invite_add|share_card)')),
        'steps', coalesce((select jsonb_agg(x) from (select p->>'k' k, count(distinct u) users from e where n = 'ob.step' group by 1 order by 2 desc) x), '[]')),
    'funnel_inv', coalesce((select jsonb_agg(x) from (
        select o.k, o.opened, o.had_acct, coalesce(a.c, 0) made_acct, coalesce(j.c, 0) joined
          from (select p->>'k' k, count(distinct sess) opened, count(distinct sess) filter (where coalesce(p->>'acct', 'false') = 'true') had_acct
                  from e where n = 'inv.open' group by 1) o
          left join (select p->>'k' k, count(distinct sess) c from e where n = 'inv.acct' group by 1) a using (k)
          left join (select p->>'k' k, count(distinct sess) c from e where n = 'inv.join' group by 1) j using (k)
         order by o.opened desc) x), '[]'),
    'shares', coalesce((select jsonb_agg(x) from (
        select n, p->>'k' k, coalesce(p->>'r', '') r, count(*) cnt, count(distinct u) users from e where n in ('share', 'copy') group by 1, 2, 3 order by 4 desc limit 20) x), '[]'),
    'features', coalesce((select jsonb_agg(x) from (
        select f, sum(cnt) cnt, max(users) users, sum(fails) fails from (
          select public.pnlog_feat(p->>'fn') f, count(*) cnt, count(distinct u) users, count(*) filter (where p->>'ok' = 'false') fails from e where n = 'rpc' group by 1
          union all select 'spel: ' || (p->>'k'), count(*), count(distinct u), 0 from e where n = 'game.start' group by 1
          union all select 'kamera', count(*), count(distinct u), count(*) filter (where p->>'a' <> 'ok') from e where n = 'cam' group by 1
          union all select 'dela / kopiera', count(*), count(distinct u), 0 from e where n in ('share', 'copy') group by 1
          union all select 'meny: ' || (p->>'s'), count(*), count(distinct u), 0 from e where n = 'sheet.open' and p->>'s' ~ '^(Topplista|🎖️|📊|🛂|🏠|🆘|🚕|📸|🎞️|⚔️|🧭|👥|Grupper|Profil|Min karaktär)' group by 1
        ) y group by f order by 2 desc limit 60) x), '[]'),
    'games', coalesce((select jsonb_agg(x) from (
        select p->>'k' k, count(*) filter (where n = 'game.start') starts, count(*) filter (where n = 'game.end') ends,
               count(*) filter (where n = 'game.quit') quits,
               round(avg((p->>'sec')::numeric) filter (where n = 'game.end' and (p->>'sec') ~ '^\d+$')) sec_end,
               round(avg((p->>'np')::numeric) filter (where n = 'game.start' and (p->>'np') ~ '^\d+$'), 1) players,
               jsonb_object_agg(coalesce(p->>'why', '-'), 1) filter (where n = 'game.quit') why
          from e where n like 'game.%' group by 1 order by 2 desc) x), '[]'),
    'flows', coalesce((select jsonb_agg(x) from (
        select f0.f, f0.started, f0.done, f0.quit,
               (select jsonb_agg(z) from (select e3.p->>'k' k, count(*) n from e e3 where e3.n = 'flow.quit' and e3.p->>'f' = f0.f group by 1 order by 2 desc limit 5) z) quit_at
          from (select p->>'f' f, count(distinct sess) filter (where n = 'flow.step') started, count(*) filter (where n = 'flow.done') done,
                       count(*) filter (where n = 'flow.quit') quit from e where n like 'flow.%' group by 1) f0) x), '[]'),
    'errors', coalesce((select jsonb_agg(x) from (
        select n, coalesce(p->>'m', p->>'c', '') m, coalesce(p->>'f', p->>'fn', '') f, count(*) cnt, count(distinct u) users, max(ver) ver,
               mode() within group (order by p->>'s') s, max(p->>'bc') bc
          from e where n like 'err.%' group by 1, 2, 3 order by 4 desc limit 30) x), '[]'),
    'crash', jsonb_build_object(
        'sessions', (select count(distinct sess) from e),
        'err_sessions', (select count(distinct sess) from e where n like 'err.%'),
        'reloads', (select count(*) from e where n = 'crash.reload')),
    'slow_rpc', coalesce((select jsonb_agg(x) from (
        select p->>'fn' fn, sum((p->>'n')::int) calls, sum(coalesce((p->>'e')::int, 0)) errs,
               percentile_cont(0.5) within group (order by (p->>'v')::float8) p95_med, max((p->>'v')::float8) p95_max
          from e where n = 'perf.rpc' and (p->>'v') ~ '^\d+(\.\d+)?$' and (p->>'n') ~ '^\d+$' group by 1 order by 4 desc limit 25) x), '[]'),
    'net', coalesce((select jsonb_agg(x) from (
        select p->>'k' k, sum((p->>'n')::int) n, sum((p->>'f')::int) f, sum((p->>'x')::int) x, sum((p->>'s')::int) slow, sum((p->>'r')::int) retry,
               percentile_cont(0.5) within group (order by (p->>'p95')::float8) p95
          from e where n = 'net.sum' and (p->>'n') ~ '^\d+$' group by 1 order by 2 desc) x), '[]'),
    'net_fail', coalesce((select jsonb_agg(x) from (
        select p->>'k' k, p->>'st' st, coalesce(p->>'fn', p->>'x', '') what, count(*) cnt, count(distinct u) users,
               count(*) filter (where p->>'on' = 'false') offline
          from e where n = 'net.fail' group by 1, 2, 3 order by 4 desc limit 20) x), '[]'),
    'offline', (select jsonb_build_object('n', count(*), 'p50', percentile_cont(0.5) within group (order by (p->>'sec')::float8)) from e where n = 'net.off' and (p->>'sec') ~ '^\d+$'),
    'jank', coalesce((select jsonb_agg(x) from (
        select os, mdl, p->>'c' c, count(distinct sess) sess, sum((p->>'n')::int) frames,
               round(avg((p->>'dr')::numeric), 1) jank_pct, round(avg((p->>'fps')::numeric)) fps, max((p->>'mx')::int) worst_ms
          from ed where n = 'perf.ft' and (p->>'n') ~ '^\d+$' group by 1, 2, 3 order by 6 desc nulls last limit 30) x), '[]'),
    'inp', coalesce((select jsonb_agg(x) from (
        select os, mdl, p->>'c' c, sum((p->>'n')::int) n, percentile_cont(0.75) within group (order by (p->>'v')::float8) v,
               sum(coalesce((p->>'n200')::int, 0)) n200
          from ed where n = 'perf.inp' and (p->>'v') ~ '^\d+(\.\d+)?$' group by 1, 2, 3 order by 5 desc limit 30) x), '[]'),
    'boot_dev', coalesce((select jsonb_agg(x) from (
        select os, mdl, count(*) n, percentile_cont(0.5) within group (order by (p->>'v')::float8) map_p50
          from ed where n = 'perf.map' and (p->>'v') ~ '^\d+(\.\d+)?$' group by 1, 2 order by 3 desc limit 20) x), '[]'),
    'devices', coalesce((select jsonb_agg(x) from (
        select os, osv, br, mdl, mem, count(distinct dv.sess) sessions from dv group by 1, 2, 3, 4, 5 order by 6 desc limit 25) x), '[]'),
    'ux', jsonb_build_object(
        'rage', coalesce((select jsonb_agg(x) from (select p->>'s' s, p->>'k' k, count(*) n, count(distinct u) users from e where n = 'ux.rage' group by 1, 2 order by 3 desc limit 15) x), '[]'),
        'dead', coalesce((select jsonb_agg(x) from (select p->>'s' s, p->>'k' k, sum((p->>'n')::int) n, count(distinct u) users from e where n = 'ux.dead' and (p->>'n') ~ '^\d+$' group by 1, 2 order by 3 desc limit 15) x), '[]'),
        'slow', coalesce((select jsonb_agg(x) from (select p->>'k' k, p->>'c' c, count(*) n, max((p->>'v')::int) worst from e where n = 'ux.slow' and (p->>'v') ~ '^\d+$' group by 1, 2 order by 3 desc limit 15) x), '[]'),
        'sheets', coalesce((select jsonb_agg(x) from (
            select p->>'s' s, count(*) n, count(*) filter (where p->>'qk' = '1') quick,
                   round(avg((p->>'sd')::numeric) filter (where (p->>'sd') ~ '^\d+$')) scroll,
                   percentile_cont(0.5) within group (order by (p->>'sec')::float8) sec50,
                   jsonb_object_agg(coalesce(p->>'h', '?'), 1) how
              from e where n = 'sheet.close' and (p->>'sec') ~ '^\d+$' group by 1 order by 2 desc limit 30) x), '[]'),
        'close_how', coalesce((select jsonb_object_agg(h, c) from (select coalesce(p->>'h', '?') h, count(*) c from e where n = 'sheet.close' group by 1) x), '{}'),
        'flow', coalesce((select jsonb_agg(x) from (select coalesce(p->>'fr', '?') fr, p->>'s' s, count(*) n, percentile_cont(0.5) within group (order by (p->>'dw')::float8) dw50
              from e where n = 'sheet.open' and (p->>'dw') ~ '^\d+$' group by 1, 2 order by 3 desc limit 30) x), '[]'),
        'back', (select count(*) from e where n = 'nav.back'),
        'search', coalesce((select jsonb_agg(x) from (select p->>'s' s, p->>'k' k, count(*) n, round(avg((p->>'len')::numeric), 1) len from e where n = 'srch' group by 1, 2 order by 3 desc limit 10) x), '[]')),
    'map', (select jsonb_build_object('sessions', count(distinct sess), 'zooms', sum((p->>'zm')::int), 'pans', sum((p->>'pan')::int), 'pinch', sum((p->>'pz')::int),
               'cluster', sum((p->>'cl')::int), 'bar', sum((p->>'bar')::int), 'pin', sum((p->>'pin')::int), 'bg', sum((p->>'bg')::int), 'longpress', sum((p->>'lp')::int),
               'ghost_sess', count(distinct sess) filter (where p->>'gh' = 'true'),
               'styles', (select jsonb_object_agg(sty, c) from (select coalesce(nullif(e2.p->>'sty', ''), '?') sty, count(distinct e2.sess) c from e e2 where e2.n = 'map.sum' group by 1) s2),
               'zoom', (select jsonb_object_agg(z, c) from (select split_part(zz, ':', 1) z, sum(split_part(zz, ':', 2)::int) c from e e3, unnest(string_to_array(e3.p->>'zh', ',')) zz where e3.n = 'map.sum' and zz ~ '^\d+:\d+$' group by 1) s3))
             from e where n = 'map.sum' and (p->>'zm') ~ '^\d+$'),
    'ntf', coalesce((select jsonb_agg(x) from (
        select n, coalesce(p->>'k', p->>'r', '') k, sum(case when (p->>'n') ~ '^\d+$' then (p->>'n')::int else 1 end) cnt, count(distinct u) users
          from e where n like 'ntf.%' group by 1, 2 order by 1, 3 desc limit 40) x), '[]'),
    'inst', coalesce((select jsonb_object_agg(k, c) from (select n || coalesce(':' || (p->>'r'), '') k, count(*) c from e where n like 'inst.%' group by 1) x), '{}'),
    'settings', coalesce((select jsonb_agg(x) from (
        select n, p->>'k' k, p->>'v' v, count(*) cnt, count(distinct u) users from e where n in ('set', 'set.ls', 'perm') group by 1, 2, 3 order by 4 desc limit 30) x), '[]'),
    'channels', coalesce((select jsonb_agg(x) from (select ch, count(distinct user_id) users, count(distinct sess) sessions from b group by 1) x), '[]'),
    'events', coalesce((select jsonb_agg(x) from (
        select n, public.pnlog_class(n) cls, count(*) cnt, count(distinct u) users from e group by 1 order by 3 desc limit 80) x), '[]')
  ) into r;
  return r;
end $$;
revoke all on function public.owner_pnlog_x(text, int) from public;
grant execute on function public.owner_pnlog_x(text, int) to anon, authenticated;
