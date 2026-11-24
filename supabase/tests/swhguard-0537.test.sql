-- 0537 olnu_swh_guard merge test. LOCAL / CI copy only. One transaction, ROLLBACK at the end.
-- Needs: a database with bar_events, olnu_event_fix_log and the trigger olnu_swh_guard_ins (snapshot + release files, e.g. rh_lf).
-- Proves BOTH old behaviours in one text: the 0291 cases fail on the 0293 text, the 0293 cases fail on the 0291 text.
-- Rows use a start in the year 2099, so real rows never match.
-- usage: psql "$DB" -X -v ON_ERROR_STOP=1 -f supabase/tests/swhguard-0537.test.sql      Prints "name|ok|detail"; any "|f|" = fail.
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE swh_res (name text, ok boolean, detail text);

DO $t$
DECLARE
  s timestamptz := '2099-03-01 19:00+01'; e timestamptz := '2099-03-02 05:00+01';
  st text; st2 text; n int;
BEGIN
  -- the old importer's rows first (game id), while the game is visible: the swehockey row and its tv copy
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status)
  VALUES ('swehockey', 'swh:9001:2099-03-01', 'Lag A – Lag B', s, e, 'ok');
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status)
  VALUES ('tv', 'tv:swh:9001:2099-03-01', 'Lag A – Lag B', s, e, 'ok');
  -- 0291 A: a new-scheme row hides its old game-id twin (logged) and stays visible
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status)
  VALUES ('swehockey', 'swh:lag-a-lag-b:2099-03-01', 'Lag A – Lag B', s, e, 'ok');
  SELECT status INTO st FROM public.bar_events WHERE source_id = 'swh:9001:2099-03-01';
  SELECT status INTO st2 FROM public.bar_events WHERE source_id = 'swh:lag-a-lag-b:2099-03-01';
  SELECT count(*) INTO n FROM public.olnu_event_fix_log l JOIN public.bar_events b ON b.id = l.id
   WHERE b.source_id = 'swh:9001:2099-03-01' AND l.reason LIKE 'swh_guard: old game-id twin of %';
  INSERT INTO swh_res VALUES ('0291 slug row hides old game-id twin', st = 'hidden' AND st2 = 'ok' AND n = 1,
    'old=' || st || ' new=' || st2 || ' log=' || n);

  -- 0291 B: the same for the regional TV twin
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status)
  VALUES ('tv', 'tv:swh:lag-a-lag-b:2099-03-01', 'Lag A – Lag B', s, e, 'ok');
  SELECT status INTO st FROM public.bar_events WHERE source_id = 'tv:swh:9001:2099-03-01';
  SELECT status INTO st2 FROM public.bar_events WHERE source_id = 'tv:swh:lag-a-lag-b:2099-03-01';
  SELECT count(*) INTO n FROM public.olnu_event_fix_log l JOIN public.bar_events b ON b.id = l.id
   WHERE b.source_id = 'tv:swh:9001:2099-03-01' AND l.reason LIKE 'swh_guard: old game-id tv twin of %';
  INSERT INTO swh_res VALUES ('0291 slug tv row hides old game-id tv twin', st = 'hidden' AND st2 = 'ok' AND n = 1,
    'old=' || st || ' new=' || st2 || ' log=' || n);

  -- 0290/0293: an old-scheme row while a visible twin exists is hidden
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status)
  VALUES ('swehockey', 'swh:9002:2099-03-01', 'Lag A – Lag B', s, e, 'ok');
  SELECT status INTO st FROM public.bar_events WHERE source_id = 'swh:9002:2099-03-01';
  INSERT INTO swh_res VALUES ('0290 old-scheme twin of a visible game is hidden', st = 'hidden', 'status=' || st);

  -- 0293 C: the TV copy of a hidden game (women's lower league) is hidden
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status, league)
  VALUES ('swehockey', 'swh:lag-c-lag-d:2099-03-01', 'Lag C – Lag D', s, e, 'ok', 'HockeyTvåan Dam Norra');
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status)
  VALUES ('tv', 'tv:swh:lag-c-lag-d:2099-03-01', 'Lag C – Lag D', s, e, 'ok');
  SELECT status INTO st FROM public.bar_events WHERE source_id = 'swh:lag-c-lag-d:2099-03-01';
  SELECT status INTO st2 FROM public.bar_events WHERE source_id = 'tv:swh:lag-c-lag-d:2099-03-01';
  INSERT INTO swh_res VALUES ('0293 tv copy of a hidden game is hidden', st = 'hidden' AND st2 = 'hidden',
    'game=' || st || ' tv=' || st2);

  -- 0293 D: a Tickster copy of a visible swehockey game is hidden
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status)
  VALUES ('tickster', 'tickster:swh0537test', 'Lag A - Lag B', s, e, 'ok');
  SELECT status INTO st FROM public.bar_events WHERE source_id = 'tickster:swh0537test';
  INSERT INTO swh_res VALUES ('0293 tickster copy of a visible game is hidden', st = 'hidden', 'status=' || st);

  -- 0293 E: a second tv copy (other id) of a visible tv row is hidden
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status)
  VALUES ('tv', 'tv:swh:lag-a-lag-b-x:2099-03-01', 'Lag A – Lag B', s, e, 'ok');
  SELECT status INTO st FROM public.bar_events WHERE source_id = 'tv:swh:lag-a-lag-b-x:2099-03-01';
  INSERT INTO swh_res VALUES ('0293 second tv copy of a visible tv row is hidden', st = 'hidden', 'status=' || st);

  -- other sources are not touched
  INSERT INTO public.bar_events (source, source_id, title, starts_at, expires_at, status)
  VALUES ('user', null, 'Lag A – Lag B', s, e, 'ok');
  SELECT status INTO st FROM public.bar_events WHERE source = 'user' AND title = 'Lag A – Lag B' AND starts_at = s;
  INSERT INTO swh_res VALUES ('a user event is not touched', st = 'ok', 'status=' || st);
END $t$;

SELECT name || '|' || CASE WHEN ok THEN 't' ELSE 'f' END || '|' || coalesce(detail, '') FROM swh_res ORDER BY name;
ROLLBACK;
