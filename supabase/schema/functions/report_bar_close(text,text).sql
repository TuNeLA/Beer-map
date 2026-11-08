-- public.report_bar_close(p_bar_id text, p_close text)
-- live md5(pg_get_functiondef) = 601c3b2b82d99be6f724e408ee911ba7
CREATE OR REPLACE FUNCTION public.report_bar_close(p_bar_id text, p_close text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_ev date := public.olnu_aio_evening();
  v_m text[]; v_min int; v_closed boolean := false;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'invalid_bar'; end if;
  if lower(btrim(coalesce(p_close, ''))) = 'closed' then
    v_closed := true; v_min := 960;
  else
    v_m := regexp_match(btrim(coalesce(p_close, '')), '^(\d{1,2})[:.](\d{2})$');
    if v_m is null or v_m[1]::int > 23 or v_m[2]::int > 59 then raise exception 'invalid_time'; end if;
    v_min := v_m[1]::int * 60 + v_m[2]::int;
    if v_min <= 360 then v_min := v_min + 1440; end if;
    if v_min < 960 or v_min > 1800 then raise exception 'invalid_time'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-close:' || v_uid::text, 0));
  if (select count(*) from public.bar_close_reports r where r.user_id = v_uid and r.created_at > now() - interval '24 hours') >= 12 then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from public.bar_close_reports r where r.user_id = v_uid and r.bar_id = p_bar_id and r.created_at > now() - interval '60 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.bar_close_reports (bar_id, user_id, evening, close_min, closed, bar_lat, bar_lng)
  values (p_bar_id, v_uid, v_ev, v_min, v_closed, v_pos[1], v_pos[2]);
  return jsonb_build_object('ok', true, 'bar_id', p_bar_id, 'close_min', v_min, 'closed', v_closed, 'evening', v_ev);
end; $function$;
