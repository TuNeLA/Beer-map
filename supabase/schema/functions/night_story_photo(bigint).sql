-- public.night_story_photo(p_photo_id bigint)
-- live md5(pg_get_functiondef) = 0cb3466fff0217ba4f71dd93893021a8
CREATE OR REPLACE FUNCTION public.night_story_photo(p_photo_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.chat_photos;
  v_from timestamptz := ((public.olnu_night_of(now()) at time zone 'Europe/Stockholm') - interval '2 days') at time zone 'Europe/Stockholm';
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.chat_photos cp where cp.id = p_photo_id and cp.bytes is not null and cp.created_at >= now() - interval '35 days';
  if not found then raise exception 'photo_not_found'; end if;
  if exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    if v_row.created_at < v_from then raise exception 'photo_not_found'; end if;
  elsif not public.olnu_evg_was(v_row.group_id, v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end; $function$;
