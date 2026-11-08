-- public.report_bar_price(p_bar_id text, p_kind text, p_kr integer)
-- live md5(pg_get_functiondef) = b16f053e9cddfa6f3ece77a85f7ff9e5
CREATE OR REPLACE FUNCTION public.report_bar_price(p_bar_id text, p_kind text, p_kr integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_day date := (now() at time zone 'Europe/Stockholm')::date;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'invalid_bar'; end if;
  if v_kind not in ('stor', 'cider', 'drink') then raise exception 'invalid_kind'; end if;
  if p_kr is null or p_kr < 20 or p_kr > 300 then raise exception 'invalid_price'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-price:' || v_uid::text, 0));
  if (select count(*) from public.bar_prices p where p.user_id = v_uid and p.updated_at > now() - interval '24 hours') >= 30 then
    raise exception 'slow_down';
  end if;
  insert into public.bar_prices (bar_id, user_id, kind, kr, day, bar_lat, bar_lng)
  values (p_bar_id, v_uid, v_kind, p_kr, v_day, v_pos[1], v_pos[2])
  on conflict (bar_id, user_id, kind, day) do update set kr = excluded.kr, updated_at = now();
  return jsonb_build_object('ok', true, 'bar_id', p_bar_id, 'kind', v_kind, 'mine', p_kr, 'price', public.olnu_aio_price(p_bar_id, v_kind));
end; $function$;
