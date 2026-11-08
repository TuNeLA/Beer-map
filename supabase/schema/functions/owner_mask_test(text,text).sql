-- public.owner_mask_test(p_key text, p_text text)
-- live md5(pg_get_functiondef) = f3231a85a35dc4696e6faee63e3e85fa
CREATE OR REPLACE FUNCTION public.owner_mask_test(p_key text, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('in', left(p_text, 500), 'out', public.olnu_mask_text(left(p_text, 500)),
                            'words', (select count(*) from public.ugc_badwords b where b.active));
end; $function$;
