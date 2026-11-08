-- public.film_photo(p_photo_id bigint)
-- live md5(pg_get_functiondef) = d447529f47d90f14739f43ae69e79132
CREATE OR REPLACE FUNCTION public.film_photo(p_photo_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.snap_photos sp
   where sp.id = p_photo_id and sp.kind = 'film' and sp.reveal_at <= now() and sp.bytes is not null and sp.expires_at > now();
  if not found then raise exception 'photo_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end; $function$;
