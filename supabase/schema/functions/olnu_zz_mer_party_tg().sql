-- public.olnu_zz_mer_party_tg()
-- live md5(pg_get_functiondef) = 0f938e733a1634d8c9529fdead6e4cad
CREATE OR REPLACE FUNCTION public.olnu_zz_mer_party_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.olnu_mer_add(new.user_id, new.night, 'party', new.room_id::text || ':' || new.game_no, 2, 6);
    if new.won then
      perform public.olnu_mer_add(new.user_id, new.night, 'party_win', new.room_id::text || ':' || new.game_no, 3, 9);
    end if;
  exception when others then null;
  end;
  return null;
end; $function$;
