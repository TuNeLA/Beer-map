-- public.import_sport_events(p_rows jsonb)
-- live md5(pg_get_functiondef) = f216bd8202e3dab534a2b4ad9963cd11
CREATE OR REPLACE FUNCTION public.import_sport_events(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb; v_ins int := 0; v_upd int := 0; v_skip int := 0; v_new boolean;
  v_src text; v_sid text; v_title text; v_at timestamptz; v_end timestamptz; v_lat float8; v_lng float8; v_url text; v_place text;
  v_tv boolean; v_tlat float8; v_tlng float8; v_tkm int; v_sport text; v_league text; v_home text; v_away text; v_tix text;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'invalid_rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_src := lower(left(public.olnu_ev_clean(r->>'source'), 20));
      v_sid := left(public.olnu_ev_clean(r->>'source_id'), 200);
      v_title := left(public.olnu_ev_clean(r->>'title'), 80);
      v_at := (r->>'starts_at')::timestamptz;
      v_end := nullif(r->>'ends_at', '')::timestamptz;
      v_tv := coalesce((r->>'tv')::boolean, false);
      v_lat := nullif(r->>'lat', '')::float8; v_lng := nullif(r->>'lng', '')::float8;
      v_url := public.olnu_ev_clean(r->>'url');
      v_tix := public.olnu_ev_clean(r->>'ticket_url');
      v_place := left(public.olnu_ev_clean(r->>'place'), 60);
      v_sport := lower(public.olnu_ev_clean(r->>'sport'));
      v_league := left(public.olnu_ev_clean(r->>'league'), 40);
      v_home := left(public.olnu_ev_clean(r->>'home'), 60);
      v_away := left(public.olnu_ev_clean(r->>'away'), 60);
      if v_sport is not null and v_sport not in ('hockey', 'fotboll') then v_sport := null; end if;
      if v_src is null or v_src = 'user' or v_sid is null or v_title is null or char_length(v_title) < 3 or v_at is null
         or v_at < now() - interval '12 hours' or v_at > now() + interval '90 days' then v_skip := v_skip + 1; continue; end if;
      if v_tv then
        v_lat := null; v_lng := null;
        v_tlat := nullif(r->>'tv_lat', '')::float8; v_tlng := nullif(r->>'tv_lng', '')::float8;
        v_tkm := greatest(20, least(1000, coalesce(nullif(r->>'tv_km', '')::int, 200)));
        if v_tlat is null or v_tlng is null or not public.olnu_world_ok(v_tlat, v_tlng) then v_tlat := null; v_tlng := null; v_tkm := null; end if;
      else
        v_tlat := null; v_tlng := null; v_tkm := null;
        if v_lat is null or v_lng is null or not public.olnu_world_ok(v_lat, v_lng) then v_skip := v_skip + 1; continue; end if;
      end if;
      if v_url is not null and (v_url !~* '^https?://' or char_length(v_url) > 300) then v_url := null; end if;
      if v_tix is not null and (v_tix !~* '^https://' or char_length(v_tix) > 300) then v_tix := null; end if;
      if v_end is not null and (v_end < v_at or v_end > v_at + interval '1 day') then v_end := null; end if;
      insert into public.bar_events as e (source, source_id, title, kind, starts_at, ends_at, bar_id, place, lat, lng, town, url, status, expires_at,
                                          sport, league, home, away, tv, tv_lat, tv_lng, tv_km, ticket_url)
      values (v_src, v_sid, v_title, 'sport', v_at, v_end,
              case when v_tv then null else public.olnu_ev_bar(v_lat, v_lng) end, v_place,
              round(v_lat::numeric, 5), round(v_lng::numeric, 5), case when v_tv then null else public.olnu_town_of(v_lat, v_lng) end,
              v_url, 'ok', coalesce(v_end, v_at + interval '3 hours'),
              v_sport, v_league, v_home, v_away, v_tv, v_tlat, v_tlng, v_tkm, v_tix)
      on conflict (source, source_id) where source_id is not null do update
        set title = excluded.title, kind = 'sport', starts_at = excluded.starts_at, ends_at = excluded.ends_at, bar_id = excluded.bar_id,
            place = excluded.place, lat = excluded.lat, lng = excluded.lng, town = excluded.town, url = excluded.url,
            expires_at = excluded.expires_at, sport = excluded.sport, league = excluded.league, home = excluded.home, away = excluded.away,
            tv = excluded.tv, tv_lat = excluded.tv_lat, tv_lng = excluded.tv_lng, tv_km = excluded.tv_km, ticket_url = excluded.ticket_url, updated_at = now()
      returning (xmax = 0) into v_new;
      if v_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    exception when others then v_skip := v_skip + 1;
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip);
end; $function$;
