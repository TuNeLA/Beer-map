-- public.olnu_eta_checkin_tg()
-- live md5(pg_get_functiondef) = ba920891a4d7d371e9fcdd61e53641a2
CREATE OR REPLACE FUNCTION public.olnu_eta_checkin_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if tg_op = 'INSERT' or new.created_at is distinct from old.created_at or new.bar_id is distinct from old.bar_id then
      perform public.olnu_eta_arrive(new.user_id, new.bar_id, new.lat, new.lng, true);
    end if;
  exception when others then
    null;   -- an ETA bug never blocks a check-in
  end;
  return new;
end; $function$;
