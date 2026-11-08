-- public.owner_sport_bars(p_key text)
-- live md5(pg_get_functiondef) = c866b9100a14b8a44dc1316b219ae6c0
CREATE OR REPLACE FUNCTION public.owner_sport_bars(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(), 'bars', coalesce((
    select jsonb_agg(public.olnu_sport_info(ids.bar_id, null) || jsonb_build_object('name', bl.name, 'lat', bl.lat, 'lng', bl.lng, 'last_at', ids.last_at)
                     order by ids.last_at desc)
      from (select bar_id, max(t) last_at from (
              select bar_id, updated_at t from public.bar_sport_votes union all select bar_id, set_at from public.bar_sport_owner) a
            group by bar_id order by 2 desc limit 300) ids
      join public.bars_lite bl on bl.id = ids.bar_id), '[]'::jsonb));
end; $function$;
