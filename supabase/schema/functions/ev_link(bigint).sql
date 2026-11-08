-- public.ev_link(p_id bigint)
-- live md5(pg_get_functiondef) = 73faa7c38afc520a0599f7fedd28bf68
CREATE OR REPLACE FUNCTION public.ev_link(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  i public.invites;
  v_ans text;
  l public.ev_links;
  n int := 0;
begin
  select * into i from public.invites x where x.id = p_id;
  select p.answer into v_ans from public.invite_people p where p.invite_id = p_id and p.user_id = v_uid;
  if i.id is null or v_ans is null then raise exception 'invite_not_found'; end if;
  if i.status <> 'open' or i.ends_at <= now() then raise exception 'invite_over'; end if;
  if v_ans = 'no' then raise exception 'invite_not_found'; end if;
  select * into l from public.ev_links x where x.invite_id = p_id and x.creator = v_uid and x.expires_at > now() order by x.created_at desc limit 1;
  if found then return jsonb_build_object('token', l.token, 'expires_at', l.expires_at); end if;
  if (select count(*) from public.ev_links x where x.creator = v_uid and x.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'slow_down';
  end if;
  loop
    n := n + 1;
    begin
      insert into public.ev_links (token, invite_id, creator, expires_at)
      values (public.olnu_ev_token(), p_id, v_uid, i.ends_at) returning * into l;
      exit;
    exception when unique_violation then
      if n >= 5 then raise exception 'code_generation_failed'; end if;
    end;
  end loop;
  return jsonb_build_object('token', l.token, 'expires_at', l.expires_at);
end;
$function$;
