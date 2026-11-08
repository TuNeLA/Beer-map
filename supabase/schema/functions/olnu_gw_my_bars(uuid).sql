-- public.olnu_gw_my_bars(p_uid uuid)
-- live md5(pg_get_functiondef) = 542b7967c66d5c0808143469dba72c57
CREATE OR REPLACE FUNCTION public.olnu_gw_my_bars(p_uid uuid)
 RETURNS TABLE(bar_id text, name text, lat double precision, lng double precision, type text, town text, nights integer, first_night timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with visits as (
    select mc.bar_id, mc.night from public.medal_checkins mc where mc.user_id = p_uid
    union
    select ct.bar_id, ct.night from public.crew_tracks ct where ct.user_id = p_uid and ct.kind = 'drink' and ct.bar_id is not null
  ), per as (
    select v.bar_id, count(distinct v.night)::int as nights, min(v.night) as first_night
      from visits v where v.bar_id is not null and char_length(v.bar_id) between 1 and 80 group by v.bar_id
  )
  select p.bar_id, coalesce(bl.name, (select ci.bar_name from public.checkins ci where ci.user_id = p_uid and ci.bar_id = p.bar_id limit 1)),
         coalesce(bl.lat, bb.lat), coalesce(bl.lng, bb.lng), bl.type,
         public.olnu_town_of(coalesce(bl.lat, bb.lat), coalesce(bl.lng, bb.lng)), p.nights, p.first_night
    from per p
    left join public.bars_lite bl on bl.id = p.bar_id
    left join public.board_bars bb on bb.bar_id = p.bar_id;
$function$;
