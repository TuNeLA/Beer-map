-- public.olnu_mer_checkins_tg()
-- live md5(pg_get_functiondef) = 07e1fe2fbe0b557613e40be486a0f05f
CREATE OR REPLACE FUNCTION public.olnu_mer_checkins_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  begin
    if tg_op = 'UPDATE' and old.created_at = new.created_at and old.bar_id = new.bar_id then
      return null;
    end if;
    if new.expires_at <= now() or (new.lat = 0 and new.lng = 0) then return null; end if;
    perform public.olnu_mer_add(new.user_id, new.expires_at, 'checkin', 'ci:' || new.bar_id, 3, 18);
    perform public.olnu_mer_squad(new.user_id, new.expires_at, new.lat, new.lng);
    for r in
      select ra.rally_id from public.rally_answers ra join public.rallies x on x.id = ra.rally_id
       where ra.user_id = new.user_id and ra.answer = 'yes' and x.user_id <> new.user_id
         and x.lat is not null and x.created_at > now() - interval '2 hours'
         and public.olnu_dist_m(x.lat, x.lng, new.lat, new.lng) <= 150
    loop
      perform public.olnu_mer_add(new.user_id, new.expires_at, 'arrive', r.rally_id::text, 5, 15);
    end loop;
  exception when others then
    null;
  end;
  return null;
end; $function$;
