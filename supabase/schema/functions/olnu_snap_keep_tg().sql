-- public.olnu_snap_keep_tg()
-- live md5(pg_get_functiondef) = f658d69a007a68e71028deb24df79444
CREATE OR REPLACE FUNCTION public.olnu_snap_keep_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    update public.snap_photos sp
       set expires_at = public.olnu_snap_exp(sp.kind, sp.group_id, sp.night, sp.reveal_at)
     where sp.group_id = new.group_id and sp.bytes is not null and sp.expires_at > now();
  exception when others then null;
  end;
  return null;
end; $function$;
