-- public.olnu_ev_rank(p_source text, p_teams boolean)
-- live md5(pg_get_functiondef) = 9ca62b7b91a9195d23fa09c09f1942aa
CREATE OR REPLACE FUNCTION public.olnu_ev_rank(p_source text, p_teams boolean)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when p_teams then 100 else 0 end
       + case p_source when 'swehockey' then 60 when 'thesportsdb' then 55 when 'owner' then 50 when 'ticketmaster' then 40
                       when 'tickster' then 38 when 'recurring' then 32 when 'ical' then 30 when 'jsonld' then 30
                       when 'visitsweden' then 20 else 10 end;
$function$;
