-- public.voice_audio(p_id bigint)
-- live md5(pg_get_functiondef) = b98c5efcf16802a0842612bcac988b06
CREATE OR REPLACE FUNCTION public.voice_audio(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.voice_msgs;
begin
  select * into v_row from public.voice_msgs v where v.id = p_id and v.expires_at > now();
  if not found then
    raise exception 'voice_not_found';
  end if;
  if not public.olnu_chat_can(v_row.group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'dur_ms', v_row.dur_ms,
    'b64', replace(encode(v_row.audio, 'base64'), E'\n', ''));
end;
$function$;
