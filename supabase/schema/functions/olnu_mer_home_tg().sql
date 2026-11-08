-- public.olnu_mer_home_tg()
-- live md5(pg_get_functiondef) = 7d71001d3c03ada7177451f74f3f7061
CREATE OR REPLACE FUNCTION public.olnu_mer_home_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if tg_table_name = 'after_nights' then
      if new.home_at is not null and (tg_op = 'INSERT' or old.home_at is null) then
        perform public.olnu_mer_add(new.user_id, new.night, 'home', '', 5, 5);
      end if;
    elsif coalesce(new.home, false) and (tg_op = 'INSERT' or not coalesce(old.home, false)) then
      perform public.olnu_mer_add(new.user_id, new.night, 'home', '', 5, 5);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
