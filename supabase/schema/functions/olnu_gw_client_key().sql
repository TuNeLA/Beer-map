-- public.olnu_gw_client_key()
-- live md5(pg_get_functiondef) = 8cfb7cbfa160b65f0da10e15d8142172
CREATE OR REPLACE FUNCTION public.olnu_gw_client_key()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_h json; v_ip text;
begin
  begin v_h := nullif(current_setting('request.headers', true), '')::json; exception when others then v_h := null; end;
  if v_h is null then return 'none'; end if;
  v_ip := btrim(coalesce(v_h->>'cf-connecting-ip', split_part(coalesce(v_h->>'x-forwarded-for', ''), ',', 1), v_h->>'x-real-ip', ''));
  if v_ip = '' then return 'none'; end if;
  return md5('olnu-gw|' || v_ip);
end $function$;
