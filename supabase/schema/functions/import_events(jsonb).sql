-- public.import_events(p_rows jsonb)
-- live md5(pg_get_functiondef) = 5e18a3decb4806e3b8c21d9caedf9fda
CREATE OR REPLACE FUNCTION public.import_events(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb; v_ins int := 0; v_upd int := 0; v_skip int := 0;
  v_title text; v_src text; v_sid text; v_at timestamptz; v_end timestamptz; v_lat float8; v_lng float8; v_url text; v_place text; v_new boolean;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'invalid_rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_src := lower(left(public.olnu_ev_clean(r->>'source'), 20));
      v_sid := left(public.olnu_ev_clean(r->>'source_id'), 200);
      v_title := left(public.olnu_ev_clean(r->>'title'), 80);
      v_at := (r->>'starts_at')::timestamptz;
      v_end := nullif(r->>'ends_at', '')::timestamptz;
      v_lat := (r->>'lat')::float8; v_lng := (r->>'lng')::float8;
      v_url := public.olnu_ev_clean(r->>'url');
      v_place := left(public.olnu_ev_clean(r->>'place'), 60);
      if v_src is null or v_src = 'user' or v_sid is null or v_title is null or char_length(v_title) < 3 or v_at is null
         or v_at < now() - interval '12 hours' or v_at > now() + interval '90 days'
         or not public.olnu_world_ok(v_lat, v_lng) then v_skip := v_skip + 1; continue; end if;
      if v_url is not null and (v_url !~* '^https?://' or char_length(v_url) > 300) then v_url := null; end if;
      if v_end is not null and (v_end < v_at or v_end > v_at + interval '2 days') then v_end := null; end if;
      insert into public.bar_events as e (source, source_id, title, kind, starts_at, ends_at, bar_id, place, lat, lng, town, url, status, expires_at)
      values (v_src, v_sid, v_title, public.olnu_ev_kind(v_title, r->>'kind'), v_at, v_end, public.olnu_ev_bar(v_lat, v_lng), v_place,
              round(v_lat::numeric, 5), round(v_lng::numeric, 5), public.olnu_town_of(v_lat, v_lng), v_url, 'ok', coalesce(v_end, v_at + interval '5 hours'))
      on conflict (source, source_id) where source_id is not null do update
        set title = excluded.title, kind = excluded.kind, starts_at = excluded.starts_at, ends_at = excluded.ends_at, bar_id = excluded.bar_id,
            place = excluded.place, lat = excluded.lat, lng = excluded.lng, town = excluded.town, url = excluded.url,
            expires_at = excluded.expires_at, updated_at = now()
      returning (xmax = 0) into v_new;
      if v_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    exception when others then v_skip := v_skip + 1;
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip);
end; $function$;
