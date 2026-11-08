-- public.gang_group(p_group_id uuid)
-- live md5(pg_get_functiondef) = 76031d8ff17318a6b036c68dcd33859e
CREATE OR REPLACE FUNCTION public.gang_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_last timestamptz := public.olnu_gang_last_night();
  p public.gang_polls;
  r public.gang_mt_rounds;
  b public.gang_brunches;
  v_round jsonb := null; v_hist jsonb; v_poll jsonb := null; v_brunch jsonb := null;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  for p in select * from public.gang_polls x where x.group_id = p_group_id and x.ended_at is null and x.ends_at <= now() loop
    perform public.olnu_gang_rl('poll:' || p_group_id::text);
    perform public.olnu_gang_poll_finish(p.id, v_uid);
  end loop;
  select * into r from public.gang_mt_rounds x where x.group_id = p_group_id and x.night = v_night order by x.id desc limit 1;
  if found then v_round := public.olnu_gang_mt_json(r, v_uid); end if;
  select coalesce(jsonb_agg(public.olnu_gang_mt_json(x, v_uid) order by x.id desc), '[]'::jsonb) into v_hist
    from (select * from public.gang_mt_rounds y where y.group_id = p_group_id and y.night = v_night order by y.id desc limit 20) x;
  select * into p from public.gang_polls x
   where x.group_id = p_group_id and (x.ended_at is null or x.ended_at > now() - interval '60 minutes')
   order by x.id desc limit 1;
  if found then v_poll := public.olnu_gang_poll_json(p, v_uid); end if;
  select * into b from public.gang_brunches x where x.group_id = p_group_id and not x.closed and x.expires_at > now()
   order by x.id desc limit 1;
  if found then v_brunch := public.olnu_gang_brunch_json(b, v_uid); end if;
  return jsonb_build_object(
    'server_time', now(), 'night', v_night, 'last_night', v_last, 'hour', public.olnu_gang_hour(),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group_id, m.user_id),
                  'name', m.display_name, 'is_me', m.user_id = v_uid) order by m.user_id <> v_uid, m.display_name), '[]'::jsonb)
                  from public.group_members m where m.group_id = p_group_id),
    'mt', jsonb_build_object('round', v_round, 'history', v_hist),
    'poll', v_poll, 'brunch', v_brunch,
    'quotes', jsonb_build_object(
      'pending', (select count(*) from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.reveal_at > now())::int,
      'next_reveal', (select min(q.reveal_at) from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.reveal_at > now()),
      'yesterday', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'who', q.who, 'body', q.body, 'at', q.created_at) order by q.id), '[]'::jsonb)
                      from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.night = v_last and q.reveal_at <= now())),
    'debts', public.olnu_gang_debts_json(p_group_id, v_uid));
end; $function$;
