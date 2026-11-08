-- public.olnu_film_start_trg()
-- live md5(pg_get_functiondef) = ad4ea7ca2392e5584480d27d1d4c6f8a
CREATE OR REPLACE FUNCTION public.olnu_film_start_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.kind = 'film' and new.group_id is not null and new.night is not null and new.user_id is not null then
    begin
      insert into public.film_starts (group_id, night, started_by) values (new.group_id, new.night, new.user_id)
      on conflict (group_id, night) do nothing;
    exception when others then null;
    end;
  end if;
  return null;
end $function$;
