-- public.mark_me_test()
-- live md5(pg_get_functiondef) = f879922131208a7a499a49e6a3b0c27b
CREATE OR REPLACE FUNCTION public.mark_me_test()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v uuid := public.olnu_uid();
begin
  insert into public.olnu_test_users (user_id) values (v) on conflict do nothing;
  return json_build_object('ok', true);
end;
$function$;
