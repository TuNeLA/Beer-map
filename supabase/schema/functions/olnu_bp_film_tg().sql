-- public.olnu_bp_film_tg()
-- live md5(pg_get_functiondef) = e85a07b908549f0a5bca03662b0b61f4
CREATE OR REPLACE FUNCTION public.olnu_bp_film_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.kind is distinct from 'film' then return null; end if;
  begin
    perform public.olnu_bp_tag('film', new.id, new.group_id, new.user_id, new.created_at, new.w, new.h);
  exception when others then null;
  end;
  return null;
end; $function$;
