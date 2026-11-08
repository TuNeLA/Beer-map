-- public.olnu_after_skal_tg()
-- live md5(pg_get_functiondef) = 9c53053d54bb66d699ef789576a07f32
CREATE OR REPLACE FUNCTION public.olnu_after_skal_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_night timestamptz := public.olnu_night_of(now());
begin
  begin
    insert into public.after_nights as a (user_id, night, skal_given) values (new.user_id, v_night, 1)
    on conflict (user_id, night) do update set skal_given = a.skal_given + 1;
    select b.user_id into v_owner from public.beers b where b.id = new.beer_id;
    if v_owner is not null and v_owner <> new.user_id then
      insert into public.after_nights as a (user_id, night, skal_got) values (v_owner, v_night, 1)
      on conflict (user_id, night) do update set skal_got = a.skal_got + 1;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
