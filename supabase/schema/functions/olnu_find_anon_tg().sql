-- public.olnu_find_anon_tg()
-- live md5(pg_get_functiondef) = 6be8ba0110d37ced212577caaef68b5c
CREATE OR REPLACE FUNCTION public.olnu_find_anon_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  begin
    if tg_table_name = 'find_share' and new.user_id is distinct from old.user_id then
      new.groups := false; new.friends := false; new.until := least(new.until, now());
    elsif tg_table_name = 'find_pos' and new.user_id is distinct from old.user_id then
      new.lat := null; new.lng := null; new.acc := null; new.target_uid := null; new.expires_at := least(new.expires_at, now());
    elsif tg_table_name = 'find_pos' and new.target_uid is distinct from old.target_uid and new.updated_at = old.updated_at then
      new.target_uid := null; new.lat := null; new.lng := null; new.expires_at := least(new.expires_at, now());
    elsif tg_table_name = 'find_reqs' and (new.from_uid is distinct from old.from_uid or new.to_uid is distinct from old.to_uid) then
      if new.status in ('pending', 'accepted', 'auto') then new.status := 'cancelled'; new.until := least(coalesce(new.until, now()), now()); end if;
    end if;
  exception when others then null;
  end;
  return new;
end; $function$;
