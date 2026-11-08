-- 0293: extend the insert guard (0290) to TV copies and Tickster copies of hockey games.
-- Cause of the dupes on 2026-11-08: each swehockey game has a 'tv' copy (source_id 'tv:'||swh id).
-- 0290 hid duplicate games but not their TV copies; Tickster also lists the same games.
-- Additive: create or replace only.
create or replace function public.olnu_swh_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status is distinct from 'ok' then return new; end if;
  if new.source = 'swehockey' then
    if coalesce(new.league, '') ~* '^Hockey(Ettan|Tvåan|Trean) Dam' then
      new.status := 'hidden';
    elsif exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.status = 'ok'
                  and b.title = new.title and b.starts_at = new.starts_at and b.source_id is distinct from new.source_id) then
      new.status := 'hidden';
    end if;
  elsif new.source = 'tv' and new.source_id like 'tv:swh:%' then
    if exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.source_id = substr(new.source_id, 4)
               and b.status = 'hidden') then
      new.status := 'hidden';
    elsif exists (select 1 from public.bar_events b where b.source = 'tv' and b.status = 'ok'
                  and b.title = new.title and b.starts_at = new.starts_at and b.source_id is distinct from new.source_id) then
      new.status := 'hidden';
    end if;
  elsif new.source = 'tickster' then
    if exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.status = 'ok'
               and b.starts_at = new.starts_at and b.title = replace(new.title, ' - ', ' – ')) then
      new.status := 'hidden';
    end if;
  end if;
  return new;
end $function$;
