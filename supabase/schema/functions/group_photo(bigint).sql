-- public.group_photo(p_photo_id bigint)
-- live md5(pg_get_functiondef) = f76bdcd64a3a0b62b5e40702ac0a740e
CREATE OR REPLACE FUNCTION public.group_photo(p_photo_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.chat_photos;
begin
  select * into v_row from public.chat_photos cp where cp.id = p_photo_id and cp.expires_at > now() and cp.bytes is not null;
  if not found then
    raise exception 'photo_not_found';
  end if;
  if not public.olnu_chat_can(v_row.group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end;
$function$;
