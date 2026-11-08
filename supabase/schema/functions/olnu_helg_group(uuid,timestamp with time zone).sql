-- public.olnu_helg_group(p_gid uuid, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 3f08b843068acf501e4e9af01dc1c326
CREATE OR REPLACE FUNCTION public.olnu_helg_group(p_gid uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cur    date := public.olnu_helg_week(p_now);
  v_from   date := public.olnu_helg_week(p_now) - 364;
  v_counts jsonb := '{}'::jsonb;
  v_w      date;
  v_n      int;
  v_streak int := 0;
  v_best   int := 0;
  v_this   int := 0;
  v_hist   jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_object_agg(x.week::text, x.n), '{}'::jsonb) into v_counts
    from (select w.week, count(distinct gm.user_id)::int as n
            from public.group_members gm, lateral public.olnu_helg_weeks(gm.user_id) w
           where gm.group_id = p_gid and w.week between v_from and v_cur
           group by w.week) x;
  v_w := v_from;
  while v_w < v_cur loop
    v_n := coalesce((v_counts->>(v_w::text))::int, 0);
    if v_n >= 3 then v_streak := v_streak + 1; else v_streak := 0; end if;
    v_best := greatest(v_best, v_streak);
    if v_w >= v_cur - 49 then v_hist := v_hist || jsonb_build_array(jsonb_build_object('w', v_w, 'n', v_n)); end if;
    v_w := v_w + 7;
  end loop;
  v_this := coalesce((v_counts->>(v_cur::text))::int, 0);
  v_hist := v_hist || jsonb_build_array(jsonb_build_object('w', v_cur, 'n', v_this, 'now', true));
  if v_this >= 3 then v_streak := v_streak + 1; end if;
  v_best := greatest(v_best, v_streak);
  return jsonb_build_object('week', v_cur, 'streak', v_streak, 'best', v_best, 'this_week', v_this, 'need', 3,
    'done', v_this >= 3, 'members', (select count(*) from public.group_members gm where gm.group_id = p_gid),
    'weeks', v_hist);
end;
$function$;
