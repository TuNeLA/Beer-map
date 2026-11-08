-- public.ev_preview(p_token text)
-- live md5(pg_get_functiondef) = 140497532c779d1d517d49cd75d2c48d
CREATE OR REPLACE FUNCTION public.ev_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_t text := upper(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'));
  l public.ev_links;
begin
  if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'why', 'slow_down');
  end if;
  if char_length(v_t) <> 6 then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  select * into l from public.ev_links x where x.token = v_t and x.expires_at > now();
  if not found then
    insert into public.join_fails (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  update public.ev_links x set hits = x.hits + 1 where x.token = l.token;
  return public.olnu_ev_public(l, v_uid);
end;
$function$;
