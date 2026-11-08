-- public.bar_photo(p_key text)
-- live md5(pg_get_functiondef) = 363ea57b3da8e83ff210ad2124c96b7d
CREATE OR REPLACE FUNCTION public.bar_photo(p_key text)
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
  select * into p from public.bar_photos x where x.id = public.olnu_bp_id(p_key);
  if not found then raise exception 'photo_not_found'; end if;
  if exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid) then
    if p.kind = 'chat' then
      select c.bytes, c.mime into v_b, v_m from public.chat_photos c where c.id = p.photo_id and c.expires_at > now();
    else
      select s.bytes, s.mime into v_b, v_m from public.snap_photos s
       where s.id = p.photo_id and s.kind = 'film' and s.expires_at > now() and s.reveal_at <= now();
    end if;
  end if;
  if v_b is null and public.olnu_bp_pub(p) then v_b := p.pub_bytes; v_m := p.pub_mime; end if;
  if v_b is null then raise exception 'photo_not_found'; end if;
  return jsonb_build_object('key', p_key, 'mime', coalesce(v_m, 'image/jpeg'), 'w', p.w, 'h', p.h, 'b64', encode(v_b, 'base64'));
end; $function$;
