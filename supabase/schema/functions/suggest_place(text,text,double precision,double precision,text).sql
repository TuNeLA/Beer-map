-- public.suggest_place(p_name text, p_type text, p_lat double precision, p_lng double precision, p_note text)
-- live md5(pg_get_functiondef) = 086f3a315b5f5eca8661c17f02e0e12d
CREATE OR REPLACE FUNCTION public.suggest_place(p_name text, p_type text, p_lat double precision, p_lng double precision, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_name text := public.olnu_inv_clean(p_name, 60);
  v_note text := public.olnu_inv_clean(p_note, 200);
  v_type text := lower(coalesce(p_type, ''));
  v_id bigint;
  v_bar text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_type := case v_type when 'restaurang' then 'restaurant' when 'café' then 'cafe' when 'nattklubb' then 'nightclub'
                        when 'annat' then 'other' else v_type end;
  if v_type not in ('bar', 'pub', 'restaurant', 'cafe', 'nightclub', 'other') then raise exception 'invalid_place'; end if;
  if v_name is null or char_length(v_name) < 2 or public.olnu_inv_haslink(v_name) or public.olnu_inv_haslink(v_note) then
    raise exception 'invalid_place';
  end if;
  if p_lat is null or p_lng is null or p_lat <> p_lat or p_lng <> p_lng or abs(p_lat) > 85 or abs(p_lng) > 180 then
    raise exception 'outside_sweden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-place:' || v_uid::text, 0));
  if exists (select 1 from public.place_suggestions s where s.user_id = v_uid and s.created_at > now() - interval '20 seconds')
     or (select count(*) from public.place_suggestions s where s.user_id = v_uid and s.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'slow_down';
  end if;
  v_id := nextval('public.place_suggestions_id_seq');
  v_bar := 'u-' || public.olnu_place_slug(v_name) || '-' || v_id;
  insert into public.place_suggestions (id, user_id, name, type, note, lat, lng, bar_id)
  values (v_id, v_uid, v_name, v_type, v_note, round(p_lat::numeric, 6)::float8, round(p_lng::numeric, 6)::float8, v_bar);
  return jsonb_build_object('id', v_id, 'bar_id', v_bar, 'status', 'pending', 'name', v_name, 'type', v_type);
end; $function$;
