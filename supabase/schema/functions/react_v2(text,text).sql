-- public.react_v2(p_pin text, p_emoji text)
-- live md5(pg_get_functiondef) = 7fc84f26467d04bdf27552722b245d2e
CREATE OR REPLACE FUNCTION public.react_v2(p_pin text, p_emoji text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_id  bigint;
begin
  if p_emoji is null or p_emoji not in ('🔥', '😂', '💀', '💪') then
    raise exception 'invalid_emoji';
  end if;
  v_id := public.olnu_resolve_pin(v_uid, p_pin);
  if v_id is null then
    raise exception 'beer_not_found';
  end if;
  return public.react(v_id, p_emoji);
end;
$function$;
