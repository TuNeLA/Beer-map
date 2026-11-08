-- public.owner_bar_photo(p_key text, p_id bigint)
-- live md5(pg_get_functiondef) = 12efbb961d73550981af58b490d74ce6
CREATE OR REPLACE FUNCTION public.owner_bar_photo(p_key text, p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.bar_photos;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select * into p from public.bar_photos x where x.id = p_id;
  if not found or p.pub_bytes is null then raise exception 'photo_not_found'; end if;
  return jsonb_build_object('id', p.id, 'mime', coalesce(p.pub_mime, 'image/jpeg'), 'w', p.w, 'h', p.h, 'b64', encode(p.pub_bytes, 'base64'));
end; $function$;
