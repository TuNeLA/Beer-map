-- public.olnu_easter(p_year integer)
-- live md5(pg_get_functiondef) = bf20d60ce34d9fe1a8d7a0b541402009
CREATE OR REPLACE FUNCTION public.olnu_easter(p_year integer)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  a int := p_year % 19; b int := p_year / 100; c int := p_year % 100;
  d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mo := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_year, mo, dy);
end;
$function$;
