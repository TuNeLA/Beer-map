-- 0211 STORE-SAFE SCORING (owner decision 2, 2026-11-07). Nothing rewards drinking more.
-- Every change below is behind olnu_store_on() (app_store_flags.store_mode, 'off' today), so the live main app
-- scores exactly as before until release day. On release day one flag flips the server and the client together.
--   * Meriter: a drink gives 0 (kind 'drink' is no longer written). The squad check on a drink stays. Other actions stay.
--   * Gängkamp / duel: the winner is the side with the most Truppanda (check-ins, skål, photos; capped per member).
--     Drinks are still stored in duels.drinks_a/b for old cards, but they never decide a winner.
--   * Medals: m1…m1000 count SKÅL (given + received), m1 = first night out. "het" (5 in a night), "medevac"
--     (10 in a night) and "liga" (group with most drinks in a week) are not awarded any more. Earned medals stay.
-- Done as anchored text edits of the live function bodies (same as the patch scripts): each anchor must exist once,
-- or the migration stops with an error and changes nothing. Re-running is safe (an edited body is skipped).
-- No row-removing or object-removing statement in this file.

do $mig$
declare
  d text;
begin
  -- 1. Meriter: no points per drink in store mode.
  d := pg_get_functiondef('public.olnu_mer_beers_tg'::regproc);
  if position('olnu_store_on' in d) = 0 then
    if (length(d) - length(replace(d, 'for i in (v_old + 1)..least(v_new, v_old + 20) loop', ''))) / length('for i in (v_old + 1)..least(v_new, v_old + 20) loop') <> 1 then
      raise exception '0211 anchor 1 missing in olnu_mer_beers_tg';
    end if;
    d := replace(d, 'for i in (v_old + 1)..least(v_new, v_old + 20) loop',
                    'for i in (v_old + 1)..(case when public.olnu_store_on() then v_old else least(v_new, v_old + 20) end) loop   -- 0211: 0 per drink in store mode');
    execute d;
  end if;

  -- 2. Duel: Truppanda decides in store mode.
  d := pg_get_functiondef('public.olnu_duel_finish'::regproc);
  if position('olnu_store_on' in d) = 0 then
    if position('w := case' in d) = 0 then raise exception '0211 anchor 2 missing in olnu_duel_finish'; end if;
    d := replace(d, 'w := case',
      'w := case
         when public.olnu_store_on() then (case when (sa->>''spirit'')::int > (sb->>''spirit'')::int then ''a''
                                               when (sa->>''spirit'')::int < (sb->>''spirit'')::int then ''b'' else ''draw'' end)   -- 0211');
    execute d;
  end if;

  -- 3. Medals: m-series = skål in store mode; no medal for volume.
  d := pg_get_functiondef('public.olnu_medal_eval'::regproc);
  if position('olnu_store_on' in d) = 0 then
    if position('v_week date := public.olnu_week_start(now());' in d) = 0
       or position('(''m1'', case when v_total >= 1 then 1 else 0 end),' in d) = 0
       or position('(''het'', v_hot),' in d) = 0
       or position('(''medevac'', v_med)' in d) = 0
       or position('(''liga'', v_league),' in d) = 0
       or position('  return query' in d) = 0 then
      raise exception '0211 anchor 3 missing in olnu_medal_eval';
    end if;
    d := replace(d, 'v_week date := public.olnu_week_start(now());',
                    'v_week date := public.olnu_week_start(now());
  v_store boolean := public.olnu_store_on();   -- 0211');
    -- before "return query": in store mode the m-series counts skål, not drinks
    d := replace(d, '  return query', '  if v_store then v_total := coalesce(v_sg, 0) + coalesce(v_sr, 0); end if;   -- 0211
  return query');
    d := replace(d, '(''m1'', case when v_total >= 1 then 1 else 0 end),',
                    '(''m1'', case when (case when v_store then v_nights else v_total end) >= 1 then 1 else 0 end),');
    d := replace(d, '(''het'', v_hot),', '(''het'', case when v_store then 0 else v_hot end),');
    d := replace(d, '(''medevac'', v_med)', '(''medevac'', case when v_store then 0 else v_med end)');
    d := replace(d, '(''liga'', v_league),', '(''liga'', case when v_store then 0 else v_league end),');
    execute d;
  end if;
end $mig$;
