-- public.olnu_mer_push_tg()
-- live md5(pg_get_functiondef) = bc551414f6bfee72fdbe304dd298ecd8
CREATE OR REPLACE FUNCTION public.olnu_mer_push_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.kind = 'comehere' then
      perform public.olnu_mer_add(new.user_id, public.olnu_night_of(coalesce(new.sent_at, now())), 'callout', 'k', 5, 10);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
