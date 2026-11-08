-- public.olnu_party_same_word(p_guess text, p_word text)
-- live md5(pg_get_functiondef) = 813387039846deb605983e9b692b6961
CREATE OR REPLACE FUNCTION public.olnu_party_same_word(p_guess text, p_word text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare g text := public.olnu_party_norm(p_guess); w text := public.olnu_party_norm(p_word); d int;
begin
  if g = '' or w = '' then return false; end if;
  if g = w then return true; end if;
  if length(w) < 4 then return false; end if;
  d := public.olnu_party_lev(g, w);
  return d <= case when length(w) >= 9 then 2 else 1 end;
end; $function$;
