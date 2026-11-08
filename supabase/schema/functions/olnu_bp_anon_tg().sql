-- public.olnu_bp_anon_tg()
-- live md5(pg_get_functiondef) = 0c3cee2195158f7c807c632aba938488
CREATE OR REPLACE FUNCTION public.olnu_bp_anon_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.user_id is distinct from old.user_id then
    new.pub_bytes := null;
    new.public_until := least(coalesce(new.public_until, now()), now());
  end if;
  return new;
end; $function$;
