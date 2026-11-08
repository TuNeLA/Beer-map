-- public.report_queue(p_bar_id text, p_bar_name text, p_bar_lat double precision, p_bar_lng double precision, p_lat double precision, p_lng double precision, p_queue text, p_entry text)
-- live md5(pg_get_functiondef) = 4dff72743957c6559c15e15cf8cc1b3c
CREATE OR REPLACE FUNCTION public.report_queue(p_bar_id text, p_bar_name text, p_bar_lat double precision, p_bar_lng double precision, p_lat double precision, p_lng double precision, p_queue text, p_entry text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_id    text := public.olnu_bp_clean(p_bar_id);
  v_q     text := lower(btrim(coalesce(p_queue, '')));
  v_e     text := nullif(lower(btrim(coalesce(p_entry, ''))), '');
  v_last  timestamptz;
  v_ok    boolean := true;
  v_wait  int := 0;
  v_res   record;
begin
  if v_q not in ('none', 'short', 'long') then raise exception 'invalid_queue'; end if;
  if v_e is not null and v_e not in ('free', 'low', 'high') then raise exception 'invalid_entry'; end if;
  perform public.olnu_bp_check(p_bar_id, p_bar_name, p_bar_lat, p_bar_lng, p_lat, p_lng);

  perform pg_advisory_xact_lock(hashtextextended('olnu_queue:' || v_uid::text, 0));
  select max(q.created_at) into v_last from public.bar_queue q
   where q.user_id = v_uid and q.bar_id = v_id and q.created_at > now() - interval '10 minutes';
  if v_last is not null then
    v_ok := false;
    v_wait := greatest(1, ceil(extract(epoch from (v_last + interval '10 minutes' - now())))::int);
  else
    insert into public.bar_queue (bar_id, user_id, queue, entry, bar_lat, bar_lng)
    values (v_id, v_uid, v_q, v_e, round(p_bar_lat::numeric, 5)::float8, round(p_bar_lng::numeric, 5)::float8);
  end if;

  select * into v_res from public.olnu_bar_queue_now(v_id);
  return jsonb_build_object('ok', v_ok, 'wait_seconds', v_wait, 'queue', v_res.queue, 'entry', v_res.entry,
                            'reports', coalesce(v_res.reports, 0));
end;
$function$;
