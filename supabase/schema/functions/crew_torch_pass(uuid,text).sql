-- public.crew_torch_pass(p_group_id uuid, p_key text)
-- live md5(pg_get_functiondef) = 200720de5b915cae26aa3049cd123582
CREATE OR REPLACE FUNCTION public.crew_torch_pass(p_group_id uuid, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  t public.crew_torches; c record;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into t from public.crew_torches x where x.holder = p_group_id and x.night = public.olnu_night_of(now())
   order by x.updated_at desc limit 1;
  if not found then raise exception 'no_torch'; end if;
  perform public.olnu_crew_torch_tick(t.id);
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_torch:' || t.id::text, 0));
  select * into t from public.crew_torches x where x.id = t.id;
  if t.holder is distinct from p_group_id then raise exception 'no_torch'; end if;
  if t.pending is not null then raise exception 'torch_pending'; end if;
  select * into c from public.olnu_crew_town_groups(t.town, t.c_lat, t.c_lng) g
   where g.group_id <> t.holder and left(md5('crewt:' || t.id::text || ':' || g.group_id::text), 12) = p_key;
  if c.group_id is null then raise exception 'invalid_target'; end if;
  update public.crew_torches x set pending = c.group_id, pending_from = p_group_id, pending_at = now(),
         pending_until = now() + interval '10 minutes', updated_at = now() where x.id = t.id;
  return jsonb_build_object('ok', true, 'until', now() + interval '10 minutes');
end; $function$;
