-- public.friend_suggest_hide(p_k text)
-- live md5(pg_get_functiondef) = 58ff22146e5b8350c733d6480cc5d5c9
CREATE OR REPLACE FUNCTION public.friend_suggest_hide(p_k text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_k text := left(regexp_replace(coalesce(p_k, ''), '[^0-9a-f]', '', 'g'), 16);
begin
  if char_length(v_k) <> 16 then raise exception 'invalid_target'; end if;
  if (select count(*) from public.friend_suggest_hidden h where h.user_id = v_uid) >= 500 then return jsonb_build_object('ok', true); end if;
  insert into public.friend_suggest_hidden (user_id, k) values (v_uid, v_k)
  on conflict (user_id, k) do update set hidden_at = now();
  return jsonb_build_object('ok', true);
end;
$function$;
