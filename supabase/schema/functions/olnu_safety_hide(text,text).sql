-- public.olnu_safety_hide(p_kind text, p_ref text)
-- live md5(pg_get_functiondef) = 621af4e37bb9993e513d2c3027dea08e
CREATE OR REPLACE FUNCTION public.olnu_safety_hide(p_kind text, p_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint := nullif(regexp_replace(coalesce(p_ref, ''), '[^0-9]', '', 'g'), '')::bigint;
begin
  if v_id is null then return; end if;
  if p_kind in ('msg', 'dm') then
    update public.group_msgs m set expires_at = least(m.expires_at, now()) where m.id = v_id;
    update public.chat_photos cp set expires_at = least(cp.expires_at, now()) where cp.msg_id = v_id;
  elsif p_kind = 'photo' then
    update public.chat_photos cp set expires_at = least(cp.expires_at, now()) where cp.id = v_id;
  elsif p_kind = 'voice' then
    update public.voice_msgs v set expires_at = least(v.expires_at, now()) where v.id = v_id;
  elsif p_kind = 'offer' then
    update public.bar_offers o set expires_at = least(o.expires_at, now()) where o.id = v_id;
  elsif p_kind = 'invite' then
    update public.invites i set status = 'cancelled', updated_at = now() where i.id = v_id;
  elsif p_kind = 'event' then
    update public.bar_events e set status = 'hidden', status_at = now() where e.id = v_id;
  end if;
end; $function$;
