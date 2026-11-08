-- public.olnu_crew_torch_tick(p_torch bigint)
-- live md5(pg_get_functiondef) = cc05c724edd38091e4c13414047cc96c
CREATE OR REPLACE FUNCTION public.olnu_crew_torch_tick(p_torch bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.crew_torches;
begin
  select * into t from public.crew_torches x where x.id = p_torch;
  if found and t.pending is not null and t.pending_until <= now() then
    perform pg_advisory_xact_lock(hashtextextended('olnu_crew_torch:' || t.id::text, 0));
    select * into t from public.crew_torches x where x.id = p_torch;
    if t.pending is not null and t.pending_until <= now() then
      perform public.olnu_crew_torch_move(t.id, t.pending);
    end if;
  end if;
end; $function$;
