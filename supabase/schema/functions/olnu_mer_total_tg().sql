-- public.olnu_mer_total_tg()
-- live md5(pg_get_functiondef) = 48cf5a859330750ff61b542c9beee75d
CREATE OR REPLACE FUNCTION public.olnu_mer_total_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.meriter_totals as t (user_id, total, updated_at)
  values (new.user_id, new.pts, now())
  on conflict (user_id) do update set total = t.total + excluded.total, updated_at = now();
  return null;
end; $function$;
