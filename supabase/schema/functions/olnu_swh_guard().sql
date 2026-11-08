-- public.olnu_swh_guard()
-- live md5(pg_get_functiondef) = f6496303635b19a955493b91e88cb5a3
CREATE OR REPLACE FUNCTION public.olnu_swh_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.source = 'swehockey' and new.status = 'ok' then
    if coalesce(new.league, '') ~* '^Hockey(Ettan|Tvåan|Trean) Dam' then
      new.status := 'hidden';
    elsif exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.status = 'ok'
                  and b.title = new.title and b.starts_at = new.starts_at and b.source_id is distinct from new.source_id) then
      new.status := 'hidden';
    end if;
  end if;
  return new;
end $function$;
