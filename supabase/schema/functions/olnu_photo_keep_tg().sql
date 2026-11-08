-- public.olnu_photo_keep_tg()
-- live md5(pg_get_functiondef) = 432a6a7555a6b5edeebb02580adaf27c
CREATE OR REPLACE FUNCTION public.olnu_photo_keep_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.keep_history then
      update public.chat_photos cp set expires_at = 'infinity'::timestamptz
       where cp.group_id = new.group_id and cp.expires_at > now() and cp.bytes is not null;
    elsif tg_op = 'UPDATE' then
      update public.chat_photos cp set expires_at = public.olnu_next_expiry()
       where cp.group_id = new.group_id and cp.expires_at = 'infinity'::timestamptz;
    end if;
  exception when others then null;
  end;
  return null;
end;
$function$;
