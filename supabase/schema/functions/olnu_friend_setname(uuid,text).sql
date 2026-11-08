-- public.olnu_friend_setname(p_uid uuid, p_name text)
-- live md5(pg_get_functiondef) = 668c163e8d7cada2891637e37d4b97d5
CREATE OR REPLACE FUNCTION public.olnu_friend_setname(p_uid uuid, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v text := btrim(regexp_replace(coalesce(p_name, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
begin
  if char_length(v) < 1 or char_length(v) > 30 then return; end if;
  insert into public.user_names (user_id, name, updated_at) values (p_uid, v, now())
    on conflict (user_id) do update set name = excluded.name, updated_at = now()
    where public.user_names.name is distinct from excluded.name;
end; $function$;
