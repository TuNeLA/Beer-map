-- public.owner_vitals_slow(p_key text, p_days integer)
-- live md5(pg_get_functiondef) = f99ca4169584e6d36b59821889adb92e
CREATE OR REPLACE FUNCTION public.owner_vitals_slow(p_key text, p_days integer DEFAULT 7)
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
    'ctx', coalesce((select jsonb_agg(x order by x.ms desc) from (
       select k ctx, sum((v)::numeric)::int ms, count(*) n from public.client_vitals c, jsonb_each_text(c.detail->'ctx') e(k, v)
        where c.created_at > now() - make_interval(days => d) group by 1 order by 2 desc limit 15) x), '[]'::jsonb),
    'rpc', coalesce((select jsonb_agg(x order by x.p90 desc) from (
       select k fn, percentile_disc(0.9) within group (order by (v)::numeric) p90, count(*) n from public.client_vitals c, jsonb_each_text(c.detail->'rpc') e(k, v)
        where c.created_at > now() - make_interval(days => d) group by 1 order by 2 desc limit 15) x), '[]'::jsonb),
    'sheets', coalesce((select jsonb_agg(x order by x.p50 desc) from (
       select k sheet, percentile_disc(0.5) within group (order by (v)::numeric) p50, count(*) n from public.client_vitals c, jsonb_each_text(c.detail->'sheet') e(k, v)
        where c.created_at > now() - make_interval(days => d) group by 1 order by 2 desc limit 15) x), '[]'::jsonb));
end $function$;
