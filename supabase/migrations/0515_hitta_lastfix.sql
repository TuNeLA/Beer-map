-- 0515 · Hitta: the last fix stays valid for the whole active find (lane hitta2, I-93, 13 Nov 2026). OWNER-RUN. Staging first.
-- A3-EXCEPTION: hotfix on the live find_ping (same as 0510): an exact anchored patch must land on today's live function AND on the release-model function later; a full CREATE OR REPLACE from one snapshot would undo the other. Coordinator dry-runs it on live in a rolled-back transaction first.
-- Check after the run (expect t, t):
--   select position('/*s515*/' in pg_get_functiondef('public.find_ping(text, double precision, double precision, double precision)'::regprocedure)) > 0,
--          position('/*s510*/' in pg_get_functiondef('public.olnu_find_allowed(uuid, uuid)'::regprocedure)) > 0;
--   (the 2nd one is t on live since 0510; on staging it is t only after 0510 ran there)
--
-- Why: a web page gets no GPS with the screen off. find_pos rows expire 2 min after the last ping, so the seeker lost the
-- found person 2 min after they put the phone in the pocket.
-- What changes (find_ping only, exact anchored text patch, marker /*s515*/, skipped when present):
--   1. The target's last fix is also returned after its 2 min, but ONLY when all of these hold:
--      the viewer is allowed (olnu_find_allowed: an accepted find or a share, never a blocked pair, 0510 unchanged),
--      a live find exists between the two (olnu_find_live: accepted or auto, until > now(): it ends EXACTLY when the find
--      ends or is cancelled), the fix was sent TO this viewer (target_uid), and the fix is from this find
--      (updated_at >= answered_at). Same precision as before (5 decimals). find_stop() (finder closed) still clears it at once.
--   2. target json gets 'live' (fix < 2 min) and 'bar': the target's check-in bar name when the check-in is near the fix
--      (about 150 m), as an anchor ("Senast sedd vid Pitchers").
-- No other function changes. olnu_find_resolve and olnu_find_allowed (with their /*s510*/ patches) are not touched.
-- Additive: one text patch with olnu_sec_patch (0430), no table change, no row is removed. Safe to run twice. CR LF safe.
-- Needs: olnu_sec_patch (0430), olnu_strip_cr (0436). Both are on live and staging.

select public.olnu_sec_patch('public.find_ping(text, double precision, double precision, double precision)', '/*s515*/',
  array[$a$me public.find_pos; v_allowed boolean;$a$,
        $a$select * into fp from public.find_pos x where x.user_id = t.uid and x.expires_at > now() and x.lat is not null;$a$,
        $a$'age_s', greatest(0, extract(epoch from now() - fp.updated_at))::int) end,$a$],
  array[$a$me public.find_pos; v_allowed boolean; v_bar text;$a$,
        $a$select * into fp from public.find_pos x where x.user_id = t.uid and x.lat is not null
       and (x.expires_at > now()
         or (x.target_uid = v_uid and r.id is not null and r.status in ('accepted', 'auto') and r.until > now()
             and x.updated_at >= coalesce(r.answered_at, r.created_at))) /*s515*/;
    if fp.user_id is not null then
      select c.bar_name into v_bar from public.checkins c
       where c.user_id = t.uid and c.expires_at > now() and abs(c.lat - fp.lat) < 0.0014 and abs(c.lng - fp.lng) < 0.0028;
    end if;$a$,
        $a$'age_s', greatest(0, extract(epoch from now() - fp.updated_at))::int, 'live', fp.expires_at > now(), 'bar', v_bar) end,$a$]);

select public.olnu_strip_cr();
