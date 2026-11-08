-- public.beer_reactions()
-- live md5(pg_get_functiondef) = 7517816ae0da94bdead87e135ed29797
CREATE OR REPLACE FUNCTION public.beer_reactions()
 RETURNS TABLE(beer_id bigint, emoji text, n integer, mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return query
  select r.beer_id, r.emoji, count(*)::int, bool_or(r.user_id = v_uid)
    from public.reactions r
    join public.beers b on b.id = r.beer_id and b.expires_at > now() and not b.stopped
   where r.active group by r.beer_id, r.emoji order by r.beer_id, r.emoji;
end; $function$;
