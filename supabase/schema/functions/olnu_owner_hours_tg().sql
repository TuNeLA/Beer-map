-- public.olnu_owner_hours_tg()
-- live md5(pg_get_functiondef) = 0b77d41d5b72023be7ef1899293b4253
CREATE OR REPLACE FUNCTION public.olnu_owner_hours_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.kind = 'beer' then
      insert into public.owner_hours as h (hour, beers)
      values (date_trunc('hour', coalesce(new.created_at, now())), 1)
      on conflict (hour) do update set beers = h.beers + 1;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
