-- public.event_go(p_event_id bigint, p_on boolean)
-- live md5(pg_get_functiondef) = c47dd9ecd818f49aa4d615239a0ff7fc
CREATE OR REPLACE FUNCTION public.event_go(p_event_id bigint, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_on boolean := coalesce(p_on, true);
  v_row public.event_going;
  v_recent int;
begin
  if not exists (select 1 from public.bar_events e
                  where e.id = p_event_id and e.status = 'ok' and e.expires_at > now()
                    and e.starts_at < now() + interval '32 days') then
    raise exception 'event_not_found';
  end if;
  select * into v_row from public.event_going g where g.event_id = p_event_id and g.user_id = v_uid;
  if found then
    if v_row.going = v_on then return public.olnu_evgo_json(p_event_id, v_uid); end if;
    if v_row.updated_at > now() - interval '2 seconds' then raise exception 'slow_down'; end if;
  end if;
  select count(*) into v_recent from public.event_going g where g.user_id = v_uid and g.updated_at > now() - interval '10 minutes';
  if v_recent >= 40 then raise exception 'slow_down'; end if;
  insert into public.event_going as g (event_id, user_id, going) values (p_event_id, v_uid, v_on)
  on conflict (event_id, user_id) do update set going = excluded.going, updated_at = now(), changes = g.changes + 1;
  return public.olnu_evgo_json(p_event_id, v_uid);
end; $function$;
