-- 0475 fixJ T-21 · Barkungen ("Kung av en bar en hel vecka") needs a REAL week: only a FINISHED week counts.
-- Before: olnu_medal_eval ranked bar_taps of every week, the running week too, so the only guest at a bar this week got
-- the medal after 1 beer on the first night (test teams night3). Now the running week is left out (t.week < v_week).
-- The map crown (bar_kings, this week) does not change. Store mode still gives no "kung" (0213).
-- Anchored text edit of the live function body, like 0213 / 0403 / 0431: it stops if the anchor is gone, and a second run
-- changes nothing. Additive: no row or object is removed. Owner-run, AFTER 0430 and 0431.
-- Old medals: given ones stay (olnu_medal_store never lowers a count). See scratchpad/fixJ/OWNER-0475.md for the
-- optional, separate UPDATE that hides wrongly given ones (NOT part of this file).
do $mig$
declare
  d text;
  a constant text := 'where t.n > 0 and t.bar_id in (select x.bar_id from public.bar_taps x where x.user_id = p_uid)';
begin
  d := pg_get_functiondef('public.olnu_medal_eval'::regproc);
  if position('and t.week < v_week' in d) = 0 then
    if position(a in d) = 0 or position('v_week date' in d) = 0 then raise exception '0475 anchor missing (olnu_medal_eval v_king)'; end if;
    d := replace(d, a, a || ' and t.week < v_week');
    execute d;
  end if;
end $mig$;

select case when position('and t.week < v_week' in pg_get_functiondef('public.olnu_medal_eval'::regproc)) > 0
            then 'ok 0475 kung = finished weeks' else 'NOT APPLIED' end as result;
