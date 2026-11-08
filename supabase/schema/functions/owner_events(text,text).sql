-- public.owner_events(p_key text, p_status text)
-- live md5(pg_get_functiondef) = 6f33f4a01b8c3168374d6ce50520a5fa
CREATE OR REPLACE FUNCTION public.owner_events(p_key text, p_status text DEFAULT 'pending'::text)
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
    'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select e.status s, count(*) n from public.bar_events e where e.expires_at > now() group by 1) c),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'kind', e.kind, 'starts_at', e.starts_at, 'place', e.place,
                 'bar_id', e.bar_id, 'town', e.town, 'url', e.url, 'source', e.source, 'status', e.status, 'created_at', e.created_at) order by e.starts_at)
              from (select * from public.bar_events x where x.expires_at > now() and (v_s = 'all' or x.status = v_s) order by x.starts_at limit 300) e), '[]'::jsonb));
end; $function$;
