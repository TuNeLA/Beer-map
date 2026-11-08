-- public.olnu_bp_tag(p_kind text, p_photo bigint, p_group uuid, p_uid uuid, p_at timestamp with time zone, p_w integer, p_h integer)
-- live md5(pg_get_functiondef) = 5a1f0669921aaab7591c51a8027bf5d8
CREATE OR REPLACE FUNCTION public.olnu_bp_tag(p_kind text, p_photo bigint, p_group uuid, p_uid uuid, p_at timestamp with time zone, p_w integer, p_h integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  if p_group is null or p_uid is null then return; end if;
  if public.olnu_is_temp_group(p_group) then return; end if;
  select * into r from public.olnu_bp_where(p_uid, p_at) limit 1;
  if not found or r.bar_id is null then return; end if;
  insert into public.bar_photos (kind, photo_id, group_id, user_id, bar_id, bar_name, bar_lat, bar_lng, via, night, taken_at, w, h)
  values (p_kind, p_photo, p_group, p_uid, r.bar_id, left(r.bar_name, 80), r.bar_lat, r.bar_lng, r.via,
          public.olnu_night_of(p_at), p_at, coalesce(p_w, 0), coalesce(p_h, 0))
  on conflict (kind, photo_id) do nothing;
end; $function$;
