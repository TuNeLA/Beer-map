-- public.olnu_avatar_max()
-- live md5(pg_get_functiondef) = d607218509799ba624ffc768bef298a2
CREATE OR REPLACE FUNCTION public.olnu_avatar_max()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select '{"ms":1,"hx":16777216,"ux":16777216,"bx":16777216,"h2":22,"ht":3,"sk":22,"fs":7,"ey":21,"ec":11,"br":14,"ns":11,"mt":21,"ck":6,"fm":11,"fp":11,"er":12,"hr":33,"hc":21,"fh":25,"hw":43,"gl":29,"nk":15,"up":30,"uc":19,"bg":38,"hi":16,"fr":10}'::jsonb;
$function$;
