-- public.owner_report_photo(p_key text, p_photo_id bigint)
-- live md5(pg_get_functiondef) = bb6998cc5750682f6ea1c525a8fa6fcc
CREATE OR REPLACE FUNCTION public.owner_report_photo(p_key text, p_photo_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.chat_photos;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select * into c from public.chat_photos x where x.id = p_photo_id
     and exists (select 1 from public.ugc_reports r where r.excerpt like '%[📷 ' || p_photo_id::text || ']%');
  if c.id is null or c.bytes is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'mime', c.mime, 'b64', encode(c.bytes, 'base64'));
end; $function$;
