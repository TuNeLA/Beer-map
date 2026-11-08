-- public.olnu_medal_skal_tg()
-- live md5(pg_get_functiondef) = eb3340c8d260dc6f18df0aec0eaddf29
CREATE OR REPLACE FUNCTION public.olnu_medal_skal_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
begin
  begin
    insert into public.medal_counts as c (user_id, skal_given) values (new.user_id, 1)
    on conflict (user_id) do update set skal_given = c.skal_given + 1;
    select b.user_id into v_owner from public.beers b where b.id = new.beer_id;
    if v_owner is not null and v_owner <> new.user_id then
      insert into public.medal_counts as c (user_id, skal_got) values (v_owner, 1)
      on conflict (user_id) do update set skal_got = c.skal_got + 1;
    end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
