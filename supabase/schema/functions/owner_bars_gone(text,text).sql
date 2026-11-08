-- public.owner_bars_gone(p_key text, p_status text)
-- live md5(pg_get_functiondef) = 210600b802dc040886f03ca600e5c4c3
CREATE OR REPLACE FUNCTION public.owner_bars_gone(p_key text, p_status text DEFAULT 'hidden'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'hidden'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select jsonb_build_object(
                 'hidden', (select count(*) from public.bar_gone g where g.status = 'hidden'),
                 'confirmed', (select count(*) from public.bar_gone g where g.status = 'confirmed'),
                 'undone', (select count(*) from public.bar_gone g where g.status = 'undone'),
                 'pending', (select count(distinct r.bar_id) from public.bar_gone_reports r where r.withdrawn_at is null
                               and not exists (select 1 from public.bar_gone g where g.bar_id = r.bar_id and g.status in ('hidden', 'confirmed'))
                               and public.olnu_gone_count(r.bar_id) > 0))),
    'rows', coalesce((select jsonb_agg(s.x order by s.x->>'at' desc) from (
        select jsonb_build_object('bar_id', g.bar_id, 'name', coalesce(g.name, (select b.name from public.bars_lite b where b.id = g.bar_id)),
                 'type', (select b.type from public.bars_lite b where b.id = g.bar_id), 'lat', g.bar_lat, 'lng', g.bar_lng,
                 'status', g.status, 'reason', g.reason, 'reports', public.olnu_gone_count(g.bar_id), 'at', g.status_at, 'hidden_at', g.hidden_at) x
          from public.bar_gone g where v_s in (g.status, 'all')
        union all
        select jsonb_build_object('bar_id', r.bar_id, 'name', coalesce(max(r.name), (select b.name from public.bars_lite b where b.id = r.bar_id)),
                 'type', (select b.type from public.bars_lite b where b.id = r.bar_id), 'lat', min(r.bar_lat), 'lng', min(r.bar_lng),
                 'status', 'pending', 'reason', null, 'reports', public.olnu_gone_count(r.bar_id), 'at', max(r.created_at), 'hidden_at', null) as x
          from public.bar_gone_reports r
         where v_s in ('pending', 'all') and r.withdrawn_at is null
           and not exists (select 1 from public.bar_gone g where g.bar_id = r.bar_id and g.status in ('hidden', 'confirmed'))
         group by r.bar_id having public.olnu_gone_count(r.bar_id) > 0
        limit 200) s), '[]'::jsonb));
end; $function$;
