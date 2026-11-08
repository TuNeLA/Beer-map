-- public.film_shoot(p_group_id uuid, p_b64 text, p_w integer, p_h integer)
-- live md5(pg_get_functiondef) = c6397435019376061299d39a353843e7
CREATE OR REPLACE FUNCTION public.film_shoot(p_group_id uuid, p_b64 text, p_w integer DEFAULT 0, p_h integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_rev   timestamptz := public.olnu_gang_reveal(public.olnu_night_of(now()));
  v_ph    record;
  v_n     int;
  v_g     int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select * into v_ph from public.olnu_snap_decode(p_b64, p_w, p_h);
  perform pg_advisory_xact_lock(hashtextextended('olnu_film:' || v_uid::text, 0));
  if exists (select 1 from public.snap_photos sp where sp.user_id = v_uid and sp.kind = 'film'
              and sp.created_at > now() - interval '3 seconds') then
    raise exception 'slow_down';
  end if;
  if (select count(*) from public.snap_photos sp where sp.user_id = v_uid and sp.kind = 'film'
        and sp.created_at > now() - interval '20 hours' and sp.night = v_night) >= 30 then
    raise exception 'film_empty';
  end if;
  select count(*)::int into v_n from public.snap_photos sp
   where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night and sp.user_id = v_uid;
  if v_n >= 10 then raise exception 'film_empty'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_film_g:' || p_group_id::text, 0));
  select count(*)::int into v_g from public.snap_photos sp
   where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night;
  if v_g >= 60 then raise exception 'film_full'; end if;
  perform public.olnu_snap_sweep();
  insert into public.snap_photos (kind, group_id, user_id, ref_id, night, mime, bytes, size, w, h, reveal_at, expires_at)
  values ('film', p_group_id, v_uid, null, v_night, v_ph.o_mime, v_ph.o_bytes, octet_length(v_ph.o_bytes), p_w, p_h,
          v_rev, public.olnu_snap_exp('film', p_group_id, v_night, v_rev));
  return jsonb_build_object('left', 9 - v_n, 'mine', v_n + 1, 'group_n', v_g + 1, 'develop_at', v_rev, 'night', v_night);
end; $function$;
