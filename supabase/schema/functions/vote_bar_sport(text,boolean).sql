-- public.vote_bar_sport(p_bar_id text, p_yes boolean)
-- live md5(pg_get_functiondef) = 86443b9087e0b64b8fec85f0ad219619
CREATE OR REPLACE FUNCTION public.vote_bar_sport(p_bar_id text, p_yes boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_bar text := left(btrim(coalesce(p_bar_id, '')), 80);
  b record;
begin
  select x.id, x.lat, x.lng into b from public.bars_lite x where x.id = v_bar and x.active;
  if not found then raise exception 'invalid_bar'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-sportvote:' || v_uid::text, 0));
  if exists (select 1 from public.bar_sport_votes s where s.user_id = v_uid and s.updated_at > now() - interval '3 seconds')
     or (select count(*) from public.bar_sport_votes s where s.user_id = v_uid and s.updated_at > now() - interval '24 hours') >= 30 then
    raise exception 'slow_down';
  end if;
  insert into public.bar_sport_votes as s (bar_id, user_id, yes, bar_lat, bar_lng)
  values (v_bar, v_uid, p_yes, b.lat, b.lng)
  on conflict (bar_id, user_id) do update set yes = excluded.yes, bar_lat = excluded.bar_lat, bar_lng = excluded.bar_lng, updated_at = now();
  return public.olnu_sport_info(v_bar, v_uid) || jsonb_build_object('ok', true);
end; $function$;
