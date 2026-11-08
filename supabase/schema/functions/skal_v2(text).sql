-- public.skal_v2(p_pin text)
-- live md5(pg_get_functiondef) = 7fb0fe04303feb558ae5a6193004a1ea
CREATE OR REPLACE FUNCTION public.skal_v2(p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_id  bigint := public.olnu_resolve_pin(v_uid, p_pin);
begin
  if v_id is null then
    raise exception 'beer_not_found';
  end if;
  return public.skal(v_id);
end;
$function$;
