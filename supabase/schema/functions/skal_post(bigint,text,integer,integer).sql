-- public.skal_post(p_hour_id bigint, p_b64 text, p_w integer, p_h integer)
-- live md5(pg_get_functiondef) = f02274dc804b81f9fcc7eaabfc8b4c3f
CREATE OR REPLACE FUNCTION public.skal_post(p_hour_id bigint, p_b64 text, p_w integer DEFAULT 0, p_h integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  h      public.skal_hours;
  v_ph   record;
  v_pid  bigint;
  v_rank int;
  v_in   boolean;
  v_sec  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into h from public.skal_hours x where x.id = p_hour_id and x.created_at > now() - interval '12 hours';
  if not found then raise exception 'skal_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = h.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if now() > h.created_at + interval '60 minutes' then raise exception 'skal_closed'; end if;
  select * into v_ph from public.olnu_snap_decode(p_b64, p_w, p_h);
  perform pg_advisory_xact_lock(hashtextextended('olnu_skal_p:' || p_hour_id::text, 0));
  if exists (select 1 from public.skal_hour_posts p where p.hour_id = p_hour_id and p.user_id = v_uid) then
    raise exception 'skal_posted';
  end if;
  perform public.olnu_snap_sweep();
  insert into public.snap_photos (kind, group_id, user_id, ref_id, night, mime, bytes, size, w, h, expires_at)
  values ('skal', h.group_id, v_uid, h.id, h.night, v_ph.o_mime, v_ph.o_bytes, octet_length(v_ph.o_bytes), p_w, p_h,
          public.olnu_snap_exp('skal', h.group_id, h.night, null))
  returning id into v_pid;
  v_in := now() <= h.ends_at;
  v_sec := greatest(0, floor(extract(epoch from (now() - h.created_at))))::int;
  select count(*)::int + 1 into v_rank from public.skal_hour_posts p where p.hour_id = p_hour_id;
  insert into public.skal_hour_posts (hour_id, user_id, group_id, night, photo_id, created_at, sec, in_time, rank, pts)
  values (h.id, v_uid, h.group_id, h.night, v_pid, now(), v_sec, v_in, v_rank, case when v_in then 5 else 0 end);
  return jsonb_build_object('photo_id', v_pid, 'rank', v_rank, 'in_time', v_in, 'sec', v_sec,
    'pts', case when v_in then 5 else 0 end, 'hour', public.olnu_skal_json(h, v_uid));
end; $function$;
