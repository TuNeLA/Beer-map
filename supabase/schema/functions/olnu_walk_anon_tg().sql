-- public.olnu_walk_anon_tg()
-- live md5(pg_get_functiondef) = 5ffce7a79758d6461967351c7cc33498
CREATE OR REPLACE FUNCTION public.olnu_walk_anon_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.user_id is distinct from old.user_id then
    new.ended_at := coalesce(new.ended_at, now());
    new.end_reason := coalesce(new.end_reason, 'stop');
    new.lat := null; new.lng := null; new.acc := null; new.home_lat := null; new.home_lng := null;
  end if;
  return new;
end; $function$;
