-- public.spel_mine()
-- live md5(pg_get_functiondef) = 9199902dac77d556e871fd19748068c8
CREATE OR REPLACE FUNCTION public.spel_mine()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); x record;
begin
  select r.id, r.group_id, r.game, r.phase into x from public.spel_players p join public.spel_rooms r on r.id = p.room_id
   where p.user_id = v_uid and p.status = 'in' and p.seen_at > now() - interval '2 hours' and not r.closed and r.expires_at > now()
     and r.phase not in ('lobby', 'end')
   order by p.seen_at desc limit 1;
  if x.id is null then return jsonb_build_object('room', null); end if;
  return jsonb_build_object('room', jsonb_build_object('id', x.id, 'group_id', x.group_id, 'game', x.game, 'phase', x.phase));
end; $function$;
