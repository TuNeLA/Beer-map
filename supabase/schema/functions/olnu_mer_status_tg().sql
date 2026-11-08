-- public.olnu_mer_status_tg()
-- live md5(pg_get_functiondef) = 9d1b084004feb1c196ede3c0cd320fee
CREATE OR REPLACE FUNCTION public.olnu_mer_status_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q record;
begin
  begin
    select r.id, r.created_at, r.ends_at into q from public.status_reqs r where r.id = new.req_id;
    if found and new.created_at <= q.ends_at then
      perform public.olnu_mer_add(new.user_id, public.olnu_night_of(q.created_at), 'status', q.id::text, 5, 15);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
