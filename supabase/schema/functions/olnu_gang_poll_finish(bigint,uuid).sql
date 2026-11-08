-- public.olnu_gang_poll_finish(p_id bigint, p_uid uuid)
-- live md5(pg_get_functiondef) = eabfc88c0db095333204eff6a81dda70
CREATE OR REPLACE FUNCTION public.olnu_gang_poll_finish(p_id bigint, p_uid uuid)
 RETURNS gang_polls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.gang_polls;
  w int;
  o jsonb;
  r json;
  v_rally bigint := null;
  v_err text := null;
begin
  select * into p from public.gang_polls x where x.id = p_id for update;
  if p.ended_at is not null then return p; end if;
  w := public.olnu_gang_poll_winner(p);
  if w is not null then
    o := p.options -> w;
    begin
      r := public.create_rally(p.group_id, left('🗳️ Gänget har röstat: ' || (o ->> 'name') || '!', 100),
                               left(o ->> 'name', 60), (o ->> 'lat')::float8, (o ->> 'lng')::float8);
      v_rally := (r ->> 'id')::bigint;
    exception when others then
      v_err := left(sqlerrm, 40);
    end;
  end if;
  update public.gang_polls x
     set ended_at = now(), ended_by = p_uid, winner = w, rally_id = v_rally, rally_error = v_err
   where x.id = p_id
  returning * into p;
  return p;
end; $function$;
