-- public.olnu_crew_ci_tg()
-- live md5(pg_get_functiondef) = c4d43d6a7106d8cc6822f9daada5c50e
CREATE OR REPLACE FUNCTION public.olnu_crew_ci_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lat float8; v_lng float8;
begin
  begin
    if tg_op = 'INSERT' or new.created_at is distinct from old.created_at or new.bar_id is distinct from old.bar_id then
      select bl.lat, bl.lng into v_lat, v_lng from public.bars_lite bl where bl.id = new.bar_id;
      perform public.olnu_crew_track_add(new.user_id, 'ci', new.bar_id, new.bar_name,
                                         coalesce(v_lat, new.lat), coalesce(v_lng, new.lng));
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
