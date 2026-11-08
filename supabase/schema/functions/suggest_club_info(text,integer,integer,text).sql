-- public.suggest_club_info(p_bar_id text, p_age integer, p_fee integer, p_dress text)
-- live md5(pg_get_functiondef) = 4a0068bd2887c2706b830ce20b0e0cbe
CREATE OR REPLACE FUNCTION public.suggest_club_info(p_bar_id text, p_age integer DEFAULT NULL::integer, p_fee integer DEFAULT NULL::integer, p_dress text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_dress text := nullif(regexp_replace(btrim(coalesce(p_dress, '')), '\s+', ' ', 'g'), '');
  v_trust boolean; v_status text; v_id bigint;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'invalid_bar'; end if;
  if p_age is not null and (p_age < 18 or p_age > 30) then raise exception 'invalid_info'; end if;
  if p_fee is not null and (p_fee < 0 or p_fee > 1000) then raise exception 'invalid_info'; end if;
  if v_dress is not null and (char_length(v_dress) not between 2 and 40
       or v_dress ~* '(https?:|www\.|\.(se|com|nu|net|org)\b|@|\d{7,})') then
    raise exception 'invalid_info';
  end if;
  if p_age is null and p_fee is null and v_dress is null then raise exception 'invalid_info'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-club:' || v_uid::text, 0));
  if (select count(*) from public.club_info c where c.user_id = v_uid and c.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'slow_down';
  end if;
  v_trust := exists (select 1 from public.bar_area_trusted t where t.user_id = v_uid and t.active);
  v_status := case when v_trust then 'ok' else 'pending' end;
  update public.club_info c set superseded_at = now()
   where c.user_id = v_uid and c.bar_id = p_bar_id and c.status = 'pending' and c.superseded_at is null;
  insert into public.club_info (bar_id, user_id, age, fee, dress, bar_lat, bar_lng, status, auto, status_at)
  values (p_bar_id, v_uid, p_age, p_fee, v_dress, v_pos[1], v_pos[2], v_status, v_trust, case when v_trust then now() end)
  returning id into v_id;
  if v_trust then perform public.olnu_aio_club_supersede(p_bar_id, v_id); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'auto', v_trust);
end; $function$;
