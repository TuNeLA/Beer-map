-- public.olnu_party_lev(a text, b text)
-- live md5(pg_get_functiondef) = 7ac6f160ffdb33504c357500d7f05bca
CREATE OR REPLACE FUNCTION public.olnu_party_lev(a text, b text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  la int := length(a); lb int := length(b);
  prev int[]; cur int[]; i int; j int; c int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  if la > 60 or lb > 60 then return greatest(la, lb); end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      c := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur := cur || least(cur[j] + 1, prev[j + 1] + 1, prev[j] + c);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end; $function$;
