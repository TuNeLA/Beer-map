-- public.olnu_gh_checkin_tg()
-- live md5(pg_get_functiondef) = 99b53be9d7e2f64eaaff7fae120a0040
CREATE OR REPLACE FUNCTION public.olnu_gh_checkin_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.bar_id is not null and (tg_op = 'INSERT' or new.bar_id is distinct from old.bar_id or new.created_at is distinct from old.created_at) then
      update public.golden_horses h set claimed_by = new.user_id, claimed_at = now()
       where h.bar_id = new.bar_id and h.claimed_by is null and h.appears_at <= now() and h.ends_at > now();
    end if;
  exception when others then null;
  end;
  return null;
end; $function$;
