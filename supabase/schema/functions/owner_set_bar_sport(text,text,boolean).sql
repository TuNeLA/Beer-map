-- public.owner_set_bar_sport(p_key text, p_bar_id text, p_shows boolean)
-- live md5(pg_get_functiondef) = fd42ee4d89f603107ab46d8f8d1f651c
CREATE OR REPLACE FUNCTION public.owner_set_bar_sport(p_key text, p_bar_id text, p_shows boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select x.id, x.lat, x.lng into b from public.bars_lite x where x.id = p_bar_id;
  if not found then raise exception 'invalid_bar'; end if;
  insert into public.bar_sport_owner as o (bar_id, shows, bar_lat, bar_lng) values (b.id, p_shows, b.lat, b.lng)
  on conflict (bar_id) do update set shows = excluded.shows, set_at = now();
  return public.olnu_sport_info(b.id, null) || jsonb_build_object('ok', true);
end; $function$;
