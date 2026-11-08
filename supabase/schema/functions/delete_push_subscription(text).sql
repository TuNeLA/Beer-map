-- public.delete_push_subscription(p_endpoint text)
-- live md5(pg_get_functiondef) = 4a58d46b8fffab27396d8ffcf001ab85
CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid;
end;
$function$;
