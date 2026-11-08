-- public.owner_places(p_key text, p_status text)
-- live md5(pg_get_functiondef) = 7a589b3e56d498ebaa0315855f0f6254
CREATE OR REPLACE FUNCTION public.owner_places(p_key text, p_status text DEFAULT 'pending'::text)
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
    'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select x.status s, count(*) n from public.place_suggestions x group by 1) c),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'bar_id', s.bar_id, 'name', s.name, 'type', s.type, 'note', s.note,
                 'lat', s.lat, 'lng', s.lng, 'status', s.status, 'created_at', s.created_at,
                 'town', public.olnu_town_of(s.lat, s.lng),
                 'by_n', (select count(*) from public.place_suggestions y where y.user_id = s.user_id),
                 'near', (select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'm', round((sqrt(power((b.lat - s.lat) * 111195, 2) + power((b.lng - s.lng) * 111195 * cos(radians(s.lat)), 2)))::numeric)))
                            from (select * from public.bars_lite b0 where b0.active and b0.id <> s.bar_id
                                    and b0.lat between s.lat - 0.0009 and s.lat + 0.0009 and b0.lng between s.lng - 0.0018 and s.lng + 0.0018 limit 5) b))
               order by s.created_at desc)
              from (select * from public.place_suggestions x where v_s = 'all' or x.status = v_s order by x.created_at desc limit 200) s), '[]'::jsonb));
end; $function$;
