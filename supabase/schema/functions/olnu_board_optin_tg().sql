-- public.olnu_board_optin_tg()
-- live md5(pg_get_functiondef) = 57e745b98a426ce27eb1fbd38a9f3489
CREATE OR REPLACE FUNCTION public.olnu_board_optin_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.user_id is distinct from old.user_id then
    new.show := false;
    new.name := null;
  end if;
  return new;
end; $function$;
