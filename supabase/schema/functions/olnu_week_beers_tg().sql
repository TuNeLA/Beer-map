-- public.olnu_week_beers_tg()
-- live md5(pg_get_functiondef) = aede376e2056c352d04cfdff11784ad9
CREATE OR REPLACE FUNCTION public.olnu_week_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inc int;
begin
  if tg_op = 'INSERT' then
    v_inc := coalesce(new.beer_count, 0) + coalesce(new.other_count, 0);
  else
    v_inc := (coalesce(new.beer_count, 0) + coalesce(new.other_count, 0))
           - (coalesce(old.beer_count, 0) + coalesce(old.other_count, 0));
  end if;
  if v_inc > 0 then
    insert into public.week_beers (user_id, week, n)
    values (new.user_id, public.olnu_week_start(now()), v_inc)
    on conflict (user_id, week) do update set n = public.week_beers.n + excluded.n;
  end if;
  return new;
end; $function$;
