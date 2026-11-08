-- public.olnu_mer_duels_tg()
-- live md5(pg_get_functiondef) = 9d6f7d2d79da2da8bdc28307382aaf6e
CREATE OR REPLACE FUNCTION public.olnu_mer_duels_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.winner is not null and old.winner is null then
      perform public.olnu_mer_duel(new.id);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
