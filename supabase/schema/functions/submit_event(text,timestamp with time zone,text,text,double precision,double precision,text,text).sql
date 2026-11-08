-- public.submit_event(p_title text, p_starts_at timestamp with time zone, p_bar_id text, p_place text, p_lat double precision, p_lng double precision, p_kind text, p_url text)
-- live md5(pg_get_functiondef) = 6b51e12c5970d2651a16a2d86e8f22dc
CREATE OR REPLACE FUNCTION public.submit_event(p_title text, p_starts_at timestamp with time zone, p_bar_id text DEFAULT NULL::text, p_place text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_kind text DEFAULT NULL::text, p_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_title text := public.olnu_ev_clean(p_title);
  v_place text := left(public.olnu_ev_clean(p_place), 60);
  v_url text := public.olnu_ev_clean(p_url);
  v_bar text := left(public.olnu_ev_clean(p_bar_id), 80);
  v_lat float8 := p_lat; v_lng float8 := p_lng;
  b record; v_id bigint; v_day timestamptz;
begin
  if v_title is null or char_length(v_title) < 3 or char_length(v_title) > 80 or v_title ~* '(https?://|www\.|\.(se|com|nu|net|org)\M)' then raise exception 'invalid_event'; end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 hour' or p_starts_at > now() + interval '60 days' then raise exception 'invalid_event'; end if;
  if v_url is not null and (v_url !~* '^https?://[^\s]+$' or char_length(v_url) > 300) then raise exception 'invalid_event'; end if;
  if v_bar is not null then
    select x.id, x.name, x.lat, x.lng into b from public.bars_lite x where x.id = v_bar and x.active;
    if found then v_lat := b.lat; v_lng := b.lng; v_place := coalesce(v_place, left(b.name, 60)); else v_bar := null; end if;
  end if;
  if v_lat is null or v_lng is null or not public.olnu_world_ok(v_lat, v_lng) then raise exception 'outside_sweden'; end if;
  if v_bar is null then v_bar := public.olnu_ev_bar(v_lat, v_lng); end if;
  v_day := (date_trunc('day', now() at time zone 'Europe/Stockholm')) at time zone 'Europe/Stockholm';
  if exists (select 1 from public.bar_events e where e.created_by = v_uid and e.created_at > now() - interval '30 seconds')
     or (select count(*) from public.bar_events e where e.created_by = v_uid and e.created_at >= v_day) >= 5 then
    raise exception 'slow_down';
  end if;
  insert into public.bar_events (source, title, kind, starts_at, bar_id, place, lat, lng, town, url, status, created_by, expires_at)
  values ('user', v_title, public.olnu_ev_kind(v_title, p_kind), p_starts_at, v_bar, v_place, round(v_lat::numeric, 5), round(v_lng::numeric, 5),
          public.olnu_town_of(v_lat, v_lng), v_url, 'pending', v_uid, p_starts_at + interval '5 hours')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending', 'bar_id', v_bar);
end; $function$;
