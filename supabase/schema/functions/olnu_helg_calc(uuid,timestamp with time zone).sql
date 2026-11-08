-- public.olnu_helg_calc(p_uid uuid, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 1e6d174605d69cb94fc89d17fc1a768a
CREATE OR REPLACE FUNCTION public.olnu_helg_calc(p_uid uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cur    date := public.olnu_helg_week(p_now);
  v_weeks  date[];
  v_w      date;
  v_streak int := 0;
  v_best   int := 0;
  v_fr     int := 2;
  v_since  int := 0;
  v_used   int := 0;
  v_done   boolean;
  v_hist   jsonb := '[]'::jsonb;
  v_s      text;
begin
  select coalesce(array_agg(w.week order by w.week), '{}') into v_weeks from public.olnu_helg_weeks(p_uid) w
   where w.week <= v_cur and w.week >= v_cur - 728;
  v_done := v_cur = any (v_weeks);
  if array_length(v_weeks, 1) is not null then
    v_w := v_weeks[1];
    while v_w < v_cur loop
      if v_w = any (v_weeks) then
        v_streak := v_streak + 1; v_s := 'out';
      elsif v_streak > 0 and v_fr > 0 then
        v_fr := v_fr - 1; v_used := v_used + 1; v_s := 'frozen';
      else
        v_streak := 0; v_s := 'miss';
      end if;
      v_best := greatest(v_best, v_streak);
      if v_fr < 2 then
        v_since := v_since + 1;
        if v_since >= 4 then v_fr := v_fr + 1; v_since := 0; end if;
      else
        v_since := 0;
      end if;
      if v_w >= v_cur - 49 then v_hist := v_hist || jsonb_build_array(jsonb_build_object('w', v_w, 's', v_s)); end if;
      v_w := v_w + 7;
    end loop;
  end if;
  v_hist := v_hist || jsonb_build_array(jsonb_build_object('w', v_cur, 's', case when v_done then 'now_out' else 'now' end));
  if v_done then v_streak := v_streak + 1; end if;
  v_best := greatest(v_best, v_streak);
  return jsonb_build_object(
    'week', v_cur, 'streak', v_streak, 'best', v_best, 'freezes', v_fr, 'max_freezes', 2, 'used', v_used,
    'done', v_done, 'at_risk', (not v_done) and v_streak > 0 and v_fr = 0,
    'will_freeze', (not v_done) and v_streak > 0 and v_fr > 0,
    'next_freeze_in', case when v_fr < 2 then 4 - v_since else null end,
    'weeks', v_hist);
end;
$function$;
