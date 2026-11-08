-- public.owner_club_info(p_key text, p_status text)
-- live md5(pg_get_functiondef) = 671c31d5b41e3ddc246bbc86bcc2b57a
CREATE OR REPLACE FUNCTION public.owner_club_info(p_key text, p_status text DEFAULT 'pending'::text)
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
                 select x.status s, count(*) n from public.club_info x where x.superseded_at is null group by 1) c),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'bar_id', a.bar_id, 'bar_lat', a.bar_lat, 'bar_lng', a.bar_lng,
                 'bar_name', (select b.name from public.bars_lite b where b.id = a.bar_id),
                 'bar_type', (select b.type from public.bars_lite b where b.id = a.bar_id),
                 'age', a.age, 'fee', a.fee, 'dress', a.dress, 'status', a.status, 'auto', a.auto,
                 'created_at', a.created_at, 'superseded', a.superseded_at is not null,
                 'by_n', (select count(*) from public.club_info y where y.user_id = a.user_id),
                 'current', public.olnu_aio_club(a.bar_id))
               order by a.created_at desc)
              from (select * from public.club_info x
                     where (v_s = 'all' or x.status = v_s) and (x.superseded_at is null or v_s = 'all')
                     order by x.created_at desc limit 100) a), '[]'::jsonb));
end; $function$;
