-- public.owner_vitals(p_key text, p_days integer)
-- live md5(pg_get_functiondef) = aed8020f45a5b8d3ef713eaca7533afc
CREATE OR REPLACE FUNCTION public.owner_vitals(p_key text, p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d int := least(greatest(coalesce(p_days, 7), 1), 60);
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object(
    'by_model', coalesce((select jsonb_agg(x order by x.n desc) from (
       select coalesce(model, '?') model, count(*) n, count(distinct user_id) users,
              percentile_disc(0.5) within group (order by fps_med) fps_med, min(nullif(fps_min, 0)) fps_min,
              percentile_disc(0.5) within group (order by load_ms) load_ms, sum(errors) errors, sum(long_ms) long_ms
         from public.client_vitals where created_at > now() - make_interval(days => d) group by 1) x), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(x order by x.h) from (
       select extract(hour from created_at at time zone 'Europe/Stockholm')::int h, count(*) n,
              percentile_disc(0.5) within group (order by fps_med) fps_med, sum(errors) errors
         from public.client_vitals where created_at > now() - make_interval(days => d) group by 1) x), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(x) from (
       select err_first, count(*) n, max(ver) ver from public.client_vitals
        where err_first is not null and created_at > now() - make_interval(days => d) group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'total', (select count(*) from public.client_vitals where created_at > now() - make_interval(days => d)));
end $function$;
