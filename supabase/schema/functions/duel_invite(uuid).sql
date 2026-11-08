-- public.duel_invite(p_group_id uuid)
-- live md5(pg_get_functiondef) = 935420231a3539348fec2b71321bd60d
CREATE OR REPLACE FUNCTION public.duel_invite(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  t public.duel_tokens;
  i int := 0;
begin
  if not public.olnu_wd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform public.olnu_wd_rl('dt:' || p_group_id::text);
  select * into t from public.duel_tokens x
   where x.group_id = p_group_id and x.expires_at > now() + interval '10 minutes' order by x.expires_at desc limit 1;
  if not found then
    if (select count(*) from public.duel_tokens x where x.user_id = v_uid and x.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'slow_down';
    end if;
    loop
      i := i + 1;
      begin
        insert into public.duel_tokens (token, group_id, user_id, expires_at)
        values (public.olnu_duel_token(), p_group_id, v_uid, least(now() + interval '30 minutes', public.olnu_night_of(now())))
        returning * into t;
        exit;
      exception when unique_violation then
        if i >= 5 then raise exception 'code_generation_failed'; end if;
      end;
    end loop;
  end if;
  return jsonb_build_object('token', t.token, 'expires_at', t.expires_at,
                            'group_name', (select g.name from public.groups g where g.id = p_group_id));
end; $function$;
