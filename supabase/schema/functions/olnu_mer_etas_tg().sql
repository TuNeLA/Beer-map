-- public.olnu_mer_etas_tg()
-- live md5(pg_get_functiondef) = d7f810e1ca4900bc8e71a971e95b3872
CREATE OR REPLACE FUNCTION public.olnu_mer_etas_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  x record;
begin
  begin
    if new.arrived_at is null or (tg_op = 'UPDATE' and old.arrived_at is not null) or new.rally_id is null then
      return null;
    end if;
    select r.id, r.user_id, r.created_at into x from public.rallies r where r.id = new.rally_id;
    if not found or x.user_id = new.user_id or new.arrived_at > x.created_at + interval '2 hours' then return null; end if;
    if exists (select 1 from public.rally_answers a where a.rally_id = x.id and a.user_id = new.user_id and a.answer = 'yes') then
      perform public.olnu_mer_add(new.user_id, public.olnu_night_of(x.created_at), 'arrive', x.id::text, 5, 15);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
