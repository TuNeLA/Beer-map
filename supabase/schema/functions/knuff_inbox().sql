-- public.knuff_inbox()
-- live md5(pg_get_functiondef) = 37043b19fa6a6334b132fdb95b5a4976
CREATE OR REPLACE FUNCTION public.knuff_inbox()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  with x as (
    update public.gw_knuffs k set seen_at = now()
     where k.to_uid = v_uid and k.seen_at is null and k.created_at > now() - interval '2 hours'
       and not public.olnu_dm_blocked(k.from_uid, v_uid)
    returning k.id, k.from_uid, k.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', public.olnu_card_first(public.olnu_gw_name_for(x.from_uid, v_uid)),
           'at', x.created_at) order by x.created_at), '[]'::jsonb) into v from x;
  return v;
end $function$;
