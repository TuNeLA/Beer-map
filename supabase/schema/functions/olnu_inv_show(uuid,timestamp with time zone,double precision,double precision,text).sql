-- public.olnu_inv_show(p_uid uuid, p_night timestamp with time zone, p_lat double precision, p_lng double precision, p_bar text)
-- live md5(pg_get_functiondef) = 03c032e22cd72461b2febd7a83e2ef51
CREATE OR REPLACE FUNCTION public.olnu_inv_show(p_uid uuid, p_night timestamp with time zone, p_lat double precision, p_lng double precision, p_bar text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  if p_uid is null or p_night is null then return; end if;
  for r in
    select i.id from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.user_id = p_uid and p.answer = 'yes' and i.status = 'open'
       and now() between i.starts_at - interval '2 hours' and i.starts_at + interval '2 hours'
       and ((p_bar is not null and i.bar_id = p_bar)
            or (p_lat is not null and i.lat is not null
                and power((i.lat - p_lat) * 111195, 2) + power((i.lng - p_lng) * 111195 * cos(radians(p_lat)), 2) <= 22500))
     limit 3
  loop
    perform public.olnu_mer_add(p_uid, p_night, 'invite_show', 'inv:' || r.id::text, 3, 6);
  end loop;
end; $function$;
