-- public.owner_reports(p_key text, p_status text)
-- live md5(pg_get_functiondef) = 6cf855e8d114a73c88d7a8d33ce34d46
CREATE OR REPLACE FUNCTION public.owner_reports(p_key text, p_status text DEFAULT 'new'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'open', (select count(*) from public.ugc_reports r where r.status = 'new'),
    'oldest_open_h', (select round(extract(epoch from now() - min(r.created_at)) / 3600.0, 1) from public.ugc_reports r where r.status = 'new'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'ref', r.ref, 'reason', r.reason, 'note', r.note, 'excerpt', r.excerpt,
        'status', r.status, 'created_at', r.created_at, 'handled_at', r.handled_at,
        'same', (select count(distinct x.reporter) from public.ugc_reports x where x.kind = r.kind and x.ref = r.ref),
        'author_30d', (select count(*) from public.ugc_reports x where x.target = r.target and x.created_at > now() - interval '30 days'),
        'author', case when r.target is null then null else substr(md5(r.target::text || ':olnu-rep'), 1, 8) end,
        'photo_id', (regexp_match(coalesce(r.excerpt, ''), '\[📷 ([0-9]+)\]'))[1]::bigint
      ) order by r.created_at desc)
      from (select * from public.ugc_reports x
             where (coalesce(p_status, 'new') = 'all' or x.status = coalesce(p_status, 'new'))
             order by x.created_at desc limit 300) r), '[]'::jsonb));
end; $function$;
