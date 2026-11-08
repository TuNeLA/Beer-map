-- public.olnu_mer_rally_tg()
-- live md5(pg_get_functiondef) = 33f1ca383131126d5239ce693747bd63
CREATE OR REPLACE FUNCTION public.olnu_mer_rally_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  x record;
  v_n int;
begin
  begin
    select r.id, r.user_id, r.created_at into x from public.rallies r where r.id = new.rally_id;
    if not found or x.user_id = new.user_id then return null; end if;
    if new.answer = 'yes' then
      perform public.olnu_mer_add(new.user_id, public.olnu_night_of(x.created_at), 'rally_yes', x.id::text, 5, 15);
    end if;
    select count(*) into v_n from public.rally_answers a where a.rally_id = x.id and a.user_id <> x.user_id;
    if v_n >= 2 then
      perform public.olnu_mer_add(x.user_id, public.olnu_night_of(x.created_at), 'callout', 'r:' || x.id::text, 5, 10);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
