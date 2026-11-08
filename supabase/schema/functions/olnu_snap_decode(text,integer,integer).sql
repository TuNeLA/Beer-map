-- public.olnu_snap_decode(p_b64 text, p_w integer, p_h integer, OUT o_bytes bytea, OUT o_mime text)
-- live md5(pg_get_functiondef) = 09167d07378e5eac5423e17a86b716a5
CREATE OR REPLACE FUNCTION public.olnu_snap_decode(p_b64 text, p_w integer, p_h integer, OUT o_bytes bytea, OUT o_mime text)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_b64 is null or length(p_b64) > 220000 then raise exception 'invalid_photo'; end if;
  begin
    o_bytes := decode(regexp_replace(p_b64, '\s', '', 'g'), 'base64');
  exception when others then
    raise exception 'invalid_photo';
  end;
  if o_bytes is null or octet_length(o_bytes) < 200 or octet_length(o_bytes) > 163840 then raise exception 'invalid_photo'; end if;
  if substring(o_bytes from 1 for 3) = '\xffd8ff'::bytea then
    o_mime := 'image/jpeg';
  elsif substring(o_bytes from 1 for 4) = '\x52494646'::bytea and substring(o_bytes from 9 for 4) = '\x57454250'::bytea then
    o_mime := 'image/webp';
  else
    raise exception 'invalid_photo';
  end if;
  if coalesce(p_w, 0) < 1 or coalesce(p_h, 0) < 1 or p_w > 2048 or p_h > 2048 then raise exception 'invalid_photo'; end if;
end; $function$;
