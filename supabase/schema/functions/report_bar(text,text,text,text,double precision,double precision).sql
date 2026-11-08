-- public.report_bar(p_bar_id text, p_bar_name text, p_kind text, p_note text, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 6ce6c8c130e61da4b4c3c9491dd5f4d5
CREATE OR REPLACE FUNCTION public.report_bar(p_bar_id text, p_bar_name text, p_kind text, p_note text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_bar text := left(btrim(regexp_replace(coalesce(p_bar_id, ''), '[[:cntrl:]]', '', 'g')), 80);
  v_name text := left(nullif(btrim(regexp_replace(coalesce(p_bar_name, ''), '[[:cntrl:]]', ' ', 'g')), ''), 60);
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
  b record; v_id bigint; v_old bigint; v_n int;
begin
  if v_bar = '' then raise exception 'invalid_bar'; end if;
  if v_kind not in ('closed', 'wrong_place', 'duplicate', 'not_bar', 'other') then raise exception 'invalid_kind'; end if;
  if v_note is not null and (char_length(v_note) > 200 or v_note ~* '(https?://|www\.)') then raise exception 'invalid_msg'; end if;
  select x.lat, x.lng, x.name into b from public.bars_lite x where x.id = v_bar;
  select r.id into v_old from public.bar_reports r
   where r.user_id = v_uid and r.bar_id = v_bar and r.created_at > now() - interval '7 days' order by r.id desc limit 1;
  if v_old is not null then
    update public.bar_reports r set kind = v_kind, note = coalesce(v_note, r.note) where r.id = v_old;
    v_id := v_old;
  else
    if exists (select 1 from public.bar_reports r where r.user_id = v_uid and r.created_at > now() - interval '20 seconds')
       or (select count(*) from public.bar_reports r where r.user_id = v_uid and r.created_at > now() - interval '1 day') >= 10 then
      raise exception 'slow_down';
    end if;
    insert into public.bar_reports (bar_id, bar_name, kind, note, bar_lat, bar_lng, user_lat, user_lng, user_id)
    values (v_bar, coalesce(v_name, left(b.name, 60)), v_kind, v_note, b.lat, b.lng,
            case when public.olnu_world_ok(p_lat, p_lng) then round(p_lat::numeric, 3) end,
            case when public.olnu_world_ok(p_lat, p_lng) then round(p_lng::numeric, 3) end, v_uid)
    returning id into v_id;
  end if;
  select count(distinct r.user_id) into v_n from public.bar_reports r where r.bar_id = v_bar and r.status = 'new';
  return jsonb_build_object('ok', true, 'id', v_id, 'already', v_old is not null, 'reports', v_n);
end; $function$;
