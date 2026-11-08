-- public.add_offer(p_bar_id text, p_bar_name text, p_bar_lat double precision, p_bar_lng double precision, p_lat double precision, p_lng double precision, p_body text)
-- live md5(pg_get_functiondef) = 970ac8db18b0fe56d1e356c87fd8f1c1
CREATE OR REPLACE FUNCTION public.add_offer(p_bar_id text, p_bar_name text, p_bar_lat double precision, p_bar_lng double precision, p_lat double precision, p_lng double precision, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := public.olnu_bp_clean(p_bar_id);
  v_name text := public.olnu_bp_clean(p_bar_name);
  v_body text := public.olnu_bp_clean(p_body);
  v_n    int;
  v_old  bigint;
  v_new  bigint;
begin
  if char_length(v_body) < 3 or char_length(v_body) > 60 then raise exception 'invalid_offer'; end if;
  if public.olnu_bp_blocked(v_body) then raise exception 'offer_blocked'; end if;
  perform public.olnu_bp_check(p_bar_id, p_bar_name, p_bar_lat, p_bar_lng, p_lat, p_lng);

  perform pg_advisory_xact_lock(hashtextextended('olnu_offer:' || v_uid::text, 0));
  select o.id into v_old from public.bar_offers o
   where o.bar_id = v_id and o.expires_at > now() and lower(o.body) = lower(v_body)
   order by o.id limit 1;
  if v_old is not null then
    return jsonb_build_object('ok', true, 'id', v_old, 'is_new', false);
  end if;
  select count(*) into v_n from public.bar_offers o where o.user_id = v_uid and o.expires_at > now();
  if v_n >= 2 then raise exception 'slow_down'; end if;

  insert into public.bar_offers (bar_id, bar_name, user_id, body, bar_lat, bar_lng, expires_at)
  values (v_id, v_name, v_uid, v_body, round(p_bar_lat::numeric, 5)::float8, round(p_bar_lng::numeric, 5)::float8,
          public.olnu_next_expiry())
  returning id into v_new;
  return jsonb_build_object('ok', true, 'id', v_new, 'is_new', true);
end;
$function$;
