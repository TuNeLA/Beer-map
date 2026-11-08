-- public.claim_medevac(p_beer_id bigint)
-- live md5(pg_get_functiondef) = 07cebe4d8ffc1c80d270a3c82d34c3f3
CREATE OR REPLACE FUNCTION public.claim_medevac(p_beer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_b   record;
  v_row public.medevac_checks;
begin
  select b.user_id, b.expires_at, b.beer_count + coalesce(b.other_count, 0) as beer_count into v_b from public.beers b
   where b.id = p_beer_id and b.expires_at > now();
  if not found or coalesce(v_b.beer_count, 0) < 10 then
    raise exception 'beer_not_found';
  end if;
  if v_b.user_id = v_uid then
    raise exception 'own_beer';
  end if;
  if not public.olnu_shares_group(v_uid, v_b.user_id) then
    raise exception 'not_friend';
  end if;
  insert into public.medevac_checks (target, night, checker)
  values (v_b.user_id, v_b.expires_at, v_uid)
  on conflict (target, night) do nothing
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('ok', true, 'mine', true, 'id', v_row.id, 'checker', public.olnu_name_for(v_uid, v_uid));
  end if;
  select * into v_row from public.medevac_checks c where c.target = v_b.user_id and c.night = v_b.expires_at;
  return jsonb_build_object('ok', false, 'mine', v_row.checker = v_uid, 'id', v_row.id,
    'checker', public.olnu_name_for(v_uid, v_row.checker));
end;
$function$;
