-- public.bar_extra(p_bar_id text)
-- live md5(pg_get_functiondef) = 23f223328134ef39ec5bc390e7faf7cd
CREATE OR REPLACE FUNCTION public.bar_extra(p_bar_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_p jsonb := '{}'::jsonb; v_k text; v_x jsonb;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  foreach v_k in array array['stor', 'cider', 'drink'] loop
    v_x := public.olnu_aio_price(p_bar_id, v_k);
    if v_x is not null then v_p := v_p || jsonb_build_object(v_k, v_x); end if;
  end loop;
  return jsonb_build_object('v', 1, 'bar_id', p_bar_id, 'server_time', now(),
    'close', public.olnu_aio_close(p_bar_id, v_uid),
    'prices', v_p,
    'mine', coalesce((select jsonb_object_agg(p.kind, p.kr) from public.bar_prices p
                       where p.bar_id = p_bar_id and p.user_id = v_uid and p.day = (now() at time zone 'Europe/Stockholm')::date), '{}'::jsonb),
    'club', public.olnu_aio_club(p_bar_id),
    'club_pending', exists (select 1 from public.club_info c where c.bar_id = p_bar_id and c.user_id = v_uid
                             and c.status = 'pending' and c.superseded_at is null));
end; $function$;
