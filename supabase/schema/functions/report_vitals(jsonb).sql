-- public.report_vitals(p jsonb)
-- live md5(pg_get_functiondef) = b2adf9367dc375ad3e53daa807c87b78
CREATE OR REPLACE FUNCTION public.report_vitals(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := public.olnu_uid(); new_id bigint;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.client_vitals v where v.user_id = me and v.created_at > now() - interval '3 hours') then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;
  insert into public.client_vitals (user_id, night, ver, model, browser, standalone, w, h, dpr, load_ms, fps_med, fps_min, fps_n,
    long_n, long_ms, errors, err_first, mapstyle, mins, detail)
  values (me, public.olnu_night_of(now()),
    left(p->>'ver', 40), left(p->>'model', 60), left(p->>'browser', 60), coalesce((p->>'standalone')::boolean, false),
    least(greatest(coalesce((p->>'w')::int, 0), 0), 10000), least(greatest(coalesce((p->>'h')::int, 0), 0), 10000),
    least(greatest(coalesce((p->>'dpr')::numeric, 0), 0), 10),
    least(greatest(coalesce((p->>'load_ms')::int, 0), 0), 600000),
    least(greatest(coalesce((p->>'fps_med')::int, 0), 0), 240), least(greatest(coalesce((p->>'fps_min')::int, 0), 0), 240),
    least(greatest(coalesce((p->>'fps_n')::int, 0), 0), 1000),
    least(greatest(coalesce((p->>'long_n')::int, 0), 0), 100000), least(greatest(coalesce((p->>'long_ms')::int, 0), 0), 10000000),
    least(greatest(coalesce((p->>'errors')::int, 0), 0), 100000), left(p->>'err_first', 200),
    left(p->>'mapstyle', 30), least(greatest(coalesce((p->>'mins')::int, 0), 0), 100000),
    case when jsonb_typeof(p->'detail') = 'object' and length((p->'detail')::text) < 4000 then p->'detail' else null end);
  return jsonb_build_object('ok', true);
end $function$;
