-- public.olnu_tg_name(p_title text, p_at timestamp with time zone)
-- live md5(pg_get_functiondef) = 9116587fff95bef58462f67df2857bde
CREATE OR REPLACE FUNCTION public.olnu_tg_name(p_title text, p_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with x as (
    select (array['sön', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör'])[extract(dow from p_at at time zone 'Europe/Stockholm')::int + 1]
             || ' ' || to_char(p_at at time zone 'Europe/Stockholm', 'FMDD/FMMM') as d,
           coalesce(nullif(btrim(coalesce(p_title, '')), ''), '📨 Event') as t)
  select case when char_length(t || ' · ' || d) <= 40 then t || ' · ' || d
              else left(t, greatest(1, 40 - char_length(d) - 4)) || '… · ' || d end
    from x;
$function$;
