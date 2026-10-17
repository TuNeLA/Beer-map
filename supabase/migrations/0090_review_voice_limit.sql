-- 0090 (review) post_voice: the night limit also works in keep-history groups; expired audio is emptied.
-- Replaces post_voice from 0018. Same signature, same errors, same result. Safe to run again.
create or replace function public.post_voice(p_group_id uuid, p_mime text, p_b64 text, p_dur_ms integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_mime text := lower(btrim(coalesce(p_mime, '')));
  v_exp  timestamptz := public.olnu_next_expiry();
  -- Start of tonight (05:00 yesterday, DST-correct). Count by created_at: a keeping group stores expires_at = infinity.
  v_from timestamptz := ((v_exp at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
  v_data bytea;
  v_n    int;
  v_row  public.voice_msgs;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
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

  -- Keep the database small: expired voices lose their audio (rows stay; reads filter on expires_at).
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
$$;
-- Partial index: the cleanup above only visits rows that still hold audio.
create index if not exists voice_msgs_audio_live_idx on public.voice_msgs (expires_at) where octet_length(audio) > 0;
revoke all on function public.post_voice(uuid, text, text, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.post_voice(uuid, text, text, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.post_voice(uuid, text, text, integer) to authenticated';
  end if;
end $$;
