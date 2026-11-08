-- public.owner_bar_photos(p_key text, p_status text)
-- live md5(pg_get_functiondef) = 5ecd83b768e7cf36b9d916991c2982ee
CREATE OR REPLACE FUNCTION public.owner_bar_photos(p_key text, p_status text DEFAULT 'public'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'public'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', jsonb_build_object(
       'public', (select count(*) from public.bar_photos x where x.public_until > now() and x.hidden_at is null),
       'reported', (select count(*) from public.bar_photos x where x.public_until > now() and x.reports > 0 and x.hidden_at is null),
       'hidden', (select count(*) from public.bar_photos x where x.hidden_at is not null and x.public_at > now() - interval '30 days'),
       'tagged_7d', (select count(*) from public.bar_photos x where x.taken_at > now() - interval '7 days')),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'bar_id', a.bar_id, 'bar_name', a.bar_name, 'kind', a.kind,
               'taken_at', a.taken_at, 'public_at', a.public_at, 'public_until', a.public_until, 'live', a.public_until > now(),
               'reports', a.reports, 'reasons', (select coalesce(jsonb_agg(r.reason) filter (where r.reason is not null), '[]'::jsonb)
                                                  from public.bar_photo_reports r where r.bp_id = a.id),
               'hidden_at', a.hidden_at, 'hidden_by', a.hidden_by, 'w', a.w, 'h', a.h, 'has_img', a.pub_bytes is not null,
               'by_n', (select count(*) from public.bar_photos y where y.user_id = a.user_id and y.public_at is not null))
             order by a.reports desc, a.public_at desc)
             from (select * from public.bar_photos x
                    where x.public_at is not null and x.public_at > now() - interval '30 days'
                      and (v_s = 'all'
                           or (v_s = 'public' and x.public_until > now() and x.hidden_at is null)
                           or (v_s = 'reported' and x.reports > 0)
                           or (v_s = 'hidden' and x.hidden_at is not null))
                    order by x.public_at desc limit 100) a), '[]'::jsonb));
end; $function$;
