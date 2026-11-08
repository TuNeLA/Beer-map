-- public.olnu_mer_photo_tg()
-- live md5(pg_get_functiondef) = 63e2b57cc26445eea1764e830e8159c7
CREATE OR REPLACE FUNCTION public.olnu_mer_photo_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if public.olnu_dm_is(new.group_id) then return null; end if;
    if new.msg_id is not null and exists (select 1 from public.group_msgs m where m.id = new.msg_id
                                            and m.body like '📷 🎖️ Lägesrapport%') then
      return null;
    end if;
    perform public.olnu_mer_add(new.user_id, public.olnu_night_of(new.created_at), 'photo', new.id::text, 2, 10);
  exception when others then
    null;
  end;
  return null;
end; $function$;
