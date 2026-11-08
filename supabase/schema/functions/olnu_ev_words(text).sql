-- public.olnu_ev_words(p text)
-- live md5(pg_get_functiondef) = c62c36759af1fcf20fdd21b82720b6be
CREATE OR REPLACE FUNCTION public.olnu_ev_words(p text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(case when length(w) >= 5 and right(w, 1) = 's' then left(w, length(w) - 1) else w end order by n), '{}')
    from regexp_split_to_table(
           btrim(regexp_replace(
             translate(lower(regexp_replace(coalesce(p, ''), '\([^)]*(\)|$)', ' ', 'g')), 'åäöéèëüáàâêíóúñçø', 'aaoeeeuaaaeiouncø'),
             '[^a-z0-9]+', ' ', 'g')), ' ') with ordinality as x(w, n)
   where length(w) >= 2
     and w <> all (array['vs', 'mot', 'och', 'and', 'the', 'pa', 'at', 'med', 'mfl', 'if', 'ik', 'hc', 'hk', 'bk', 'sk', 'aik', 'ff', 'fk', 'fc',
                         'is', 'hf', 'goif', 'ibk', 'ibf', 'bois', 'hockey', 'ishockey', 'hockeyforening', 'hockeyklubb', 'forening',
                         'idrottsforening', 'idrottsklubb', 'idrottsallskap', 'klubb', 'club', 'fotboll', 'fotbollsklubb', 'tal', 'text', 'svenska',
                         'engelska', 'live', 'biljetter', 'tickets', 'presenterar', 'presents', 'feat', 'ft']);
$function$;
