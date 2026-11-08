-- public.bar_photo_share(p_key text, p_on boolean)
-- live md5(pg_get_functiondef) = ac70570188c92ab7c19b90e45595b543
CREATE OR REPLACE FUNCTION public.bar_photo_share(p_key text, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  p public.bar_photos; v_b bytea; v_m text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.bar_photos set pub_bytes = null where pub_bytes is not null and public_until < now();
  select * into p from public.bar_photos x where x.id = public.olnu_bp_id(p_key) for update;
  if not found or p.user_id <> v_uid then raise exception 'photo_not_found'; end if;
  if not coalesce(p_on, true) then
    update public.bar_photos set public_until = least(coalesce(public_until, now()), now()), pub_bytes = null where id = p.id;
    return jsonb_build_object('key', p_key, 'shared', false);
  end if;
  if p.hidden_by = 'owner' then raise exception 'not_allowed'; end if;
  if public.olnu_bp_pub(p) then return jsonb_build_object('key', p_key, 'shared', true, 'public_until', p.public_until); end if;
  if (select count(*) from public.bar_photos x where x.user_id = v_uid and x.public_at > now() - interval '24 hours') >= 20 then
    raise exception 'slow_down';
  end if;
  if p.kind = 'chat' then
    select c.bytes, c.mime into v_b, v_m from public.chat_photos c where c.id = p.photo_id and c.expires_at > now();
  else
    select s.bytes, s.mime into v_b, v_m from public.snap_photos s
     where s.id = p.photo_id and s.kind = 'film' and s.expires_at > now() and s.reveal_at <= now();
  end if;
  if v_b is null then raise exception 'photo_not_found'; end if;
  update public.bar_photos
     set public_at = now(), public_until = now() + interval '7 days', pub_bytes = v_b, pub_mime = coalesce(v_m, 'image/jpeg')
   where id = p.id;
  return jsonb_build_object('key', p_key, 'shared', true, 'public_until', now() + interval '7 days');
end; $function$;
