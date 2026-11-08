-- public.olnu_tg_inv_upd()
-- live md5(pg_get_functiondef) = 186f8109558f374a63d081f3b05ea8d1
CREATE OR REPLACE FUNCTION public.olnu_tg_inv_upd()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_g uuid;
begin
  begin
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      update public.temp_groups t set closed_at = now() where t.invite_id = new.id and t.closed_at is null
      returning t.group_id into v_g;
      if v_g is not null then perform public.olnu_tg_say(v_g, new.creator, 'cancel'); end if;
    end if;
    if new.reminded_at is not null and old.reminded_at is null and new.status = 'open' then
      select t.group_id into v_g from public.temp_groups t where t.invite_id = new.id and t.closed_at is null;
      if v_g is not null then perform public.olnu_tg_say(v_g, new.creator, 'soon'); end if;
    end if;
  exception when others then
    raise warning 'olnu_tg_inv_upd: %', sqlerrm;
  end;
  return null;
end; $function$;
