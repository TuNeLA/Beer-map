-- public.olnu_fcode_anon_tg()
-- live md5(pg_get_functiondef) = e5ec1cb2aac0fbb239fc861145ce1501
CREATE OR REPLACE FUNCTION public.olnu_fcode_anon_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.user_id is distinct from old.user_id then
      new.code := 'X' || substr(md5(random()::text || clock_timestamp()::text), 1, 15);
    end if;
  exception when others then null;
  end;
  return new;
end; $function$;
