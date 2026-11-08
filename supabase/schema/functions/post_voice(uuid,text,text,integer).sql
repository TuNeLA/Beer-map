-- public.post_voice(p_group_id uuid, p_mime text, p_b64 text, p_dur_ms integer)
-- live md5(pg_get_functiondef) = 8dac348983970c800318fb72ab2f2aa4
CREATE OR REPLACE FUNCTION public.post_voice(p_group_id uuid, p_mime text, p_b64 text, p_dur_ms integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_mime text := lower(btrim(coalesce(p_mime, '')));
  v_exp  timestamptz := public.olnu_next_expiry();
  v_from timestamptz := ((v_exp at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
  v_data bytea;
  v_n    int;
  v_row  public.voice_msgs;
begin
  if not public.olnu_chat_can(p_group_id, v_uid, true) then
    raise exception 'not_member';
  end if;
  if v_mime !~ '^audio/(webm|ogg|mp4|aac|mpeg|x-m4a)(; ?codecs="?[a-z0-9.,]{1,30}"?)?$' then
    raise exception 'invalid_voice';
  end if;
  if p_b64 is null or length(p_b64) > 90000 then
    raise exception 'invalid_voice';
  end if;
  begin
    v_data := decode(regexp_replace(p_b64, '\s', '', 'g'), 'base64');
  exception when others then
    raise exception 'invalid_voice';
  end;
  if octet_length(v_data) < 100 or octet_length(v_data) > 61440 then
    raise exception 'invalid_voice';
  end if;
  update public.voice_msgs v set audio = '\x'::bytea
   where v.expires_at < now() and octet_length(v.audio) > 0;
  perform pg_advisory_xact_lock(hashtextextended('olnu_voice:' || v_uid::text, 0));
  if exists (select 1 from public.voice_msgs v where v.user_id = v_uid and v.created_at > now() - interval '5 seconds') then
    raise exception 'slow_down';
  end if;
  select count(*) into v_n from public.voice_msgs v where v.user_id = v_uid and v.created_at >= v_from;
  if v_n >= 10 then
    raise exception 'voice_limit';
  end if;
  insert into public.voice_msgs (group_id, user_id, mime, dur_ms, audio)
  values (p_group_id, v_uid, v_mime, greatest(0, least(6000, coalesce(p_dur_ms, 0))), v_data)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'left', 9 - v_n);
end;
$function$;
