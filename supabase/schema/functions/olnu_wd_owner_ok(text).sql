-- public.olnu_wd_owner_ok(p_key text)
-- live md5(pg_get_functiondef) = fa6b70bb4f2519ed6c549625f9258bdc
CREATE OR REPLACE FUNCTION public.olnu_wd_owner_ok(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select count(*) from public.owner_key_fails f where f.at > now() - interval '1 hour') > 20 then
    raise exception 'rate_limited';
  end if;
  if p_key is null or char_length(p_key) > 200 or not exists (
       select 1 from public.owner_keys k where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    insert into public.owner_key_fails (at) values (now());
    perform set_config('response.status', '403', true);
    return false;
  end if;
  return true;
end; $function$;
