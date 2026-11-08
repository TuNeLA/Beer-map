-- public.my_meriter(p_after_id bigint)
-- live md5(pg_get_functiondef) = dff1ce53f762d6b427fb1705e91f1365
CREATE OR REPLACE FUNCTION public.my_meriter(p_after_id bigint DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_m    int;
  v_last bigint;
  v_tn   int;
  v_wk   int;
  v_ev   jsonb := '[]'::jsonb;
  v_wstart timestamptz := ((public.olnu_week_start(now()) + interval '29 hours') at time zone 'Europe/Stockholm');
  r record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_m := public.olnu_meriter(v_uid);
  select coalesce(max(l.id), 0) into v_last from public.meriter_log l where l.user_id = v_uid;
  select coalesce(sum(l.pts) filter (where l.night = public.olnu_night_of(now())), 0)::int,
         coalesce(sum(l.pts) filter (where l.night >= v_wstart), 0)::int
    into v_tn, v_wk
    from public.meriter_log l where l.user_id = v_uid and l.night >= least(v_wstart, public.olnu_night_of(now()));
  if coalesce(p_after_id, 0) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'pts', e.pts, 'at', e.created_at) order by e.id), '[]'::jsonb)
      into v_ev
      from (select l.id, l.kind, l.pts, l.created_at from public.meriter_log l
             where l.user_id = v_uid and l.id > p_after_id and not l.bf
             order by l.id desc limit 40) e;
  end if;
  select * into r from public.olnu_rank_of(v_m);
  return jsonb_build_object('meriter', v_m, 'title', r.title, 'rank', r.idx, 'ranks', r.n, 'rank_at', r.at,
                            'next_title', r.next_title, 'next_at', r.next_at, 'tonight', v_tn, 'week', v_wk,
                            'last_id', v_last, 'events', v_ev);
end; $function$;
