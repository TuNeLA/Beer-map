-- 0349 tx02b STORE RULES v2 (owner 2026-11-08): beers are the app. In store mode a logged drink gives meriter again,
-- with a nightly cap (5 each for the first 4 drinks of a night, then 0), and the tjänst medals (m10…m1000) count logged
-- drinks again. Still off in store mode: per-night quantity medals (het 5 / medevac 10), drink leaderboards (kung, liga).
-- Everything here is behind olnu_store_on() (app_store_flags.store_mode = 'off' today): the live app scores exactly as
-- before. Anchored text edits of the live bodies (same as 0211): an anchor must exist once or nothing changes. Re-running
-- is safe (an edited body is skipped). Plus my_meriter gets one more key, drink_cap (4 in store mode, null otherwise).
-- No row-removing or object-removing statement in this file. Applied live 2026-11-08.
do $mig$
declare
  d text;
  a text;
begin
  -- 1. meriter: 5 per drink for the first 4 drinks of a night in store mode (was 0 per drink in store mode, 0211)
  d := pg_get_functiondef('public.olnu_mer_beers_tg'::regproc);
  if position('then least(v_new, 4) else' in d) = 0 then
    a := 'case when public.olnu_store_on() then v_old else least(v_new, v_old + 20) end';
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception '0349 anchor 1 missing in olnu_mer_beers_tg'; end if;
    d := replace(d, a, 'case when public.olnu_store_on() then least(v_new, 4) else least(v_new, v_old + 20) end');
    d := replace(d, '-- 0211: 0 per drink in store mode', '-- 0349: store mode = 5 each for the first 4 drinks of a night');
    execute d;
  end if;

  -- 2. medals: the tjänst series (m10…m1000) counts logged drinks in store mode too (0211 made it count skål)
  d := pg_get_functiondef('public.olnu_medal_eval'::regproc);
  if position('-- 0349' in d) = 0 then
    a := 'if v_store then v_total := coalesce(v_sg, 0) + coalesce(v_sr, 0); end if;   -- 0211';
    if position(a in d) = 0 then raise exception '0349 anchor 2 missing in olnu_medal_eval'; end if;
    d := replace(d, a, 'null;   -- 0349: tjänst medals count logged drinks in every mode (was skål in store mode, 0211)');
    execute d;
  end if;

  -- 3. my_meriter: drink_cap next to drink_pts (0346)
  d := pg_get_functiondef('public.my_meriter(bigint)'::regprocedure);
  if position('drink_cap' in d) = 0 then
    a := '''drink_pts'', case when public.olnu_store_on() then 0 else 5 end';
    if position(a in d) = 0 then raise exception '0349 anchor 3 missing in my_meriter (needs 0346)'; end if;
    d := replace(d, a, '''drink_pts'', 5, ''drink_cap'', case when public.olnu_store_on() then 4 end');
    execute d;
  end if;
end $mig$;
