-- public.olnu_keep_history_ins()
-- live md5(pg_get_functiondef) = 84fb553ad8913b8e86e10a8ae4da9a78
CREATE OR REPLACE FUNCTION public.olnu_keep_history_ins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.olnu_group_keeps(new.group_id) then new.expires_at := 'infinity'::timestamptz; end if;
  return new;
end; $function$;
