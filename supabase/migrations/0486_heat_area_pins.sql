-- 0486 HEAT · a stranger's pin of a home beer sits at the town centre, like its heat (owner choice "Bars + town centre").
-- OWNER-RUN at release, AFTER 0485 (and 0430/0431/0436). OWNER DECISION: skip this file to keep today's stranger pins.
-- Additive: no row or object is removed. Safe to run twice (2nd run says "skip"). Safe to paste with CR LF line ends.
-- Why: the client draws a glow at every pin it gets (app.js heatData: pins + heat). A stranger got the pin of a home beer at
-- its ~550 m grid point (olnu_pins: snap_lat or the rounded position). So after 0485 a home beer in a small village still had
-- a marker + glow ~550 m from the house. This file changes only the stranger form of a pin in olnu_pins:
--   - at a bar (snap_bar set): as before, at the bar;
--   - else: at the centre of the nearest town with bars (beers.tlat / tlng, filled by 0485), 'snap' = 'area' as before;
--   - no town with bars within 60 km: strangers get no pin for it (it still counts in live_total).
-- Me, my group mates (known) and "Bara vänner" rules do not change. poll_v2, poll_public and live_beers all read olnu_pins.
-- Method: the CR-safe anchor patch of 0436 (olnu_sec_patch): it reads the DEPLOYED definition, each anchor must occur
-- exactly once, a definition with the marker 'heat0486' is skipped.
-- Check after the run (expect t):
--   select position('heat0486' in pg_get_functiondef('public.olnu_pins(uuid,float8,float8,float8,float8)'::regprocedure)) > 0;

do $c$ begin
  if to_regprocedure('public.olnu_sec_patch(regprocedure,text,text[],text[])') is null then
    raise exception '0486 needs 0436 (olnu_sec_patch). Run 0436 first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'beers' and column_name = 'tlat') then
    raise exception '0486 needs 0485 (beers.tlat). Run 0485 first.';
  end if;
end $c$;

select public.olnu_sec_patch('public.olnu_pins(uuid,double precision,double precision,double precision,double precision)'::regprocedure,
  'heat0486',
  array[
    $a$b.snap_lat, b.snap_lng, b.snap_bar, mm.uid is not null as known, mm.fname$a$,
    $a$b.snap_lat, b.snap_lng, b.snap_bar, true, mm.fname$a$,
    $a$and (not v_box or (b.lat between v_a and v_c and b.lng between v_b and v_d))$a$,
    $a$case when c.known then c.lat else coalesce(c.snap_lat, (round(c.lat::numeric / 0.005) * 0.005)::float8) end,$a$,
    $a$case when c.known then c.lng else coalesce(c.snap_lng, (round(c.lng::numeric / 0.01) * 0.01)::float8) end,$a$,
    $a$(coalesce(c.snap_lat, c.lat) between p_min_lat and p_max_lat$a$,
    $a$and coalesce(c.snap_lng, c.lng) between p_min_lng and p_max_lng))$a$,
    $a$and not public.olnu_ub_hidden(p_uid, c.user_id)$a$
  ],
  array[
    $a$b.snap_lat, b.snap_lng, b.snap_bar, mm.uid is not null as known, mm.fname, b.tlat, b.tlng$a$,
    $a$b.snap_lat, b.snap_lng, b.snap_bar, true, mm.fname, b.tlat, b.tlng$a$,
    $a$and (not v_box or (b.lat between v_a and v_c and b.lng between v_b and v_d)
            or (mm.uid is null and b.tlat between v_a and v_c and b.tlng between v_b and v_d))   -- heat0486: a stranger's town pin may be far from the home$a$,
    $a$case when c.known then c.lat when c.snap_bar is not null then c.snap_lat else c.tlat end,   -- heat0486: stranger = bar or town centre$a$,
    $a$case when c.known then c.lng when c.snap_bar is not null then c.snap_lng else c.tlng end,$a$,
    $a$((case when c.snap_bar is not null then c.snap_lat else c.tlat end) between p_min_lat and p_max_lat$a$,
    $a$and (case when c.snap_bar is not null then c.snap_lng else c.tlng end) between p_min_lng and p_max_lng))$a$,
    $a$and not public.olnu_ub_hidden(p_uid, c.user_id)
     and (c.known or c.snap_bar is not null or c.tlat is not null)   -- heat0486: no town with bars in 60 km = no stranger pin$a$
  ]) as result;

do $s$ begin
  if to_regprocedure('public.olnu_strip_cr()') is not null then perform public.olnu_strip_cr(); end if;
end $s$;
