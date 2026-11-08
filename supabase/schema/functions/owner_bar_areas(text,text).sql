-- public.owner_bar_areas(p_key text, p_status text)
-- live md5(pg_get_functiondef) = 7ff27a9190d3393d4386d6a7ab6eab59
CREATE OR REPLACE FUNCTION public.owner_bar_areas(p_key text, p_status text DEFAULT 'pending'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
                 select x.status s, count(*) n from public.bar_areas x where x.superseded_at is null group by 1) c),
    'trusted', (select count(*) from public.bar_area_trusted t where t.active),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'bar_id', a.bar_id, 'bar_lat', a.bar_lat, 'bar_lng', a.bar_lng,
                 'bar_name', (select b.name from public.bars_lite b where b.id = a.bar_id),
                 'polygon', a.polygon, 'area_m2', a.area_m2, 'n_pts', a.n_pts, 'status', a.status, 'auto', a.auto,
                 'created_at', a.created_at, 'superseded', a.superseded_at is not null,
                 'by_n', (select count(*) from public.bar_areas y where y.created_by = a.created_by),
                 'by_owner', exists (select 1 from public.bar_area_trusted t where t.user_id = a.created_by and t.active),
                 'others', (select count(*) from public.bar_areas z where z.bar_id = a.bar_id and z.id <> a.id and z.superseded_at is null))
               order by a.created_at desc)
              from (select * from public.bar_areas x
                     where (v_s = 'all' or x.status = v_s) and (x.superseded_at is null or v_s = 'all')
                     order by x.created_at desc limit 100) a), '[]'::jsonb));
end; $function$;
