-- public.olnu_duel_beers_tg()
-- live md5(pg_get_functiondef) = cdfae261a73b27a1c5aebc17c90ac8ff
CREATE OR REPLACE FUNCTION public.olnu_duel_beers_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new int := coalesce(new.beer_count, 0) + coalesce(new.other_count, 0);
  v_d int;
begin
  begin
    if tg_op = 'UPDATE' and old.expires_at is not distinct from new.expires_at then
      v_d := v_new - (coalesce(old.beer_count, 0) + coalesce(old.other_count, 0));
    else
      v_d := v_new;
    end if;
    if v_d <> 0 and exists (select 1 from public.group_members m where m.user_id = new.user_id) then
      insert into public.duel_log (user_id, kind, n) values (new.user_id, 'drink', v_d);
    end if;
  exception when others then null;
  end;
  return new;
end; $function$;
