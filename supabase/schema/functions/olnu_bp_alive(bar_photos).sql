-- public.olnu_bp_alive(p bar_photos)
-- live md5(pg_get_functiondef) = 6a586f7ad335bbeb4ba596985bfc9174
CREATE OR REPLACE FUNCTION public.olnu_bp_alive(p bar_photos)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p.kind = 'chat' then
    return exists (select 1 from public.chat_photos c where c.id = p.photo_id and c.bytes is not null and c.expires_at > now());
  end if;
  return exists (select 1 from public.snap_photos s where s.id = p.photo_id and s.kind = 'film' and s.bytes is not null
                   and s.expires_at > now() and s.reveal_at is not null and s.reveal_at <= now());
end; $function$;
