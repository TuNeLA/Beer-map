-- public.knuff_send(p_beer_id bigint)
-- live md5(pg_get_functiondef) = 32589eb0f82a5f87916f4fea30d8eeb2
CREATE OR REPLACE FUNCTION public.knuff_send(p_beer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid(); v_to uuid; v_last timestamptz; v_id bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select b.user_id into v_to from public.beers b
   where b.id = p_beer_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false);
  if v_to is null or v_to = v_uid then raise exception 'beer_not_found'; end if;
  if not public.olnu_gw_mates(v_uid, v_to) then raise exception 'not_friends'; end if;
  if public.olnu_dm_blocked(v_uid, v_to) then raise exception 'blocked'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-knuff:' || v_uid::text, 0));
  select max(k.created_at) into v_last from public.gw_knuffs k
   where k.from_uid = v_uid and k.to_uid = v_to and k.created_at > now() - interval '30 minutes';
  if v_last is not null then
    return jsonb_build_object('ok', false, 'why', 'slow_down',
      'wait_s', greatest(1, ceil(extract(epoch from (v_last + interval '30 minutes' - now()))))::int);
  end if;
  if (select count(*) from public.gw_knuffs k where k.from_uid = v_uid and k.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'why', 'slow_down', 'wait_s', 600);
  end if;
  insert into public.gw_knuffs (from_uid, to_uid, beer_id) values (v_uid, v_to, p_beer_id) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;
