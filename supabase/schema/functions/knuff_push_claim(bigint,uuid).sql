-- public.knuff_push_claim(p_id bigint, p_from uuid)
-- live md5(pg_get_functiondef) = 4bad2be9fcda6c3c2f1360117822c211
CREATE OR REPLACE FUNCTION public.knuff_push_claim(p_id bigint, p_from uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_to uuid;
begin
  update public.gw_knuffs k set pushed = true
   where k.id = p_id and k.from_uid = p_from and not k.pushed and k.created_at > now() - interval '5 minutes'
  returning k.to_uid into v_to;
  if v_to is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'to', v_to, 'name', public.olnu_card_first(public.olnu_gw_name_for(p_from, v_to)));
end $function$;
