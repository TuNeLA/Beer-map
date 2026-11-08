-- public.olnu_tg_inv_ins()
-- live md5(pg_get_functiondef) = d7d9e90b408e8939db29e4c5b6860e6d
CREATE OR REPLACE FUNCTION public.olnu_tg_inv_ins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_g uuid;
begin
  begin
    v_g := public.olnu_tg_make(new.id);
    if v_g is not null then perform public.olnu_tg_say(v_g, new.creator, 'made'); end if;
  exception when others then
    raise warning 'olnu_tg_inv_ins: %', sqlerrm;
  end;
  return null;
end; $function$;
