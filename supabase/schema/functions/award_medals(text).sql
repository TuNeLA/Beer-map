-- public.award_medals(p_event text)
-- live md5(pg_get_functiondef) = babb28bb2969bad0c546a2dd14578d6e
CREATE OR REPLACE FUNCTION public.award_medals(p_event text DEFAULT NULL::text)
 RETURNS TABLE(medal text, count integer, is_new boolean, earned_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  if lower(btrim(coalesce(p_event, ''))) = 'home' then
    update public.medal_nights mn set home = true
      from public.beers b
     where b.user_id = v_uid and b.expires_at > now() and (b.beer_count + coalesce(b.other_count, 0)) >= 1
       and mn.user_id = v_uid and mn.night = b.expires_at;
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$function$;
