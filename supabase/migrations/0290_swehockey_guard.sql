-- 0290: guard for the daily sport import (live fix 2026-11-08, owner approved).
-- Why: stats.swehockey.se rows came in under two id schemes (game id from schedule pages, team-slug from day pages),
-- so every game within 14 days was saved twice, and women's lower leagues ("HockeyTvåan Dam …") slipped past the skip rule.
-- This trigger hides a new swehockey row when a visible row with the same title and start already exists, and hides
-- women's Ettan/Tvåan/Trean rows. UPDATE-style only (status = 'hidden'); nothing is removed. The importer fix in
-- scripts/import-sport.mjs (one id scheme) makes this a no-op after the release.
create table if not exists public.olnu_event_fix_log (id bigint, prev_status text, reason text, at timestamptz default now());
alter table public.olnu_event_fix_log enable row level security;
revoke all on public.olnu_event_fix_log from anon, authenticated;

create or replace function public.olnu_swh_guard() returns trigger language plpgsql security definer set search_path = public as $$
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
end $$;
revoke all on function public.olnu_swh_guard() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'olnu_swh_guard_ins') then
    create trigger olnu_swh_guard_ins before insert on public.bar_events for each row execute function public.olnu_swh_guard();
  end if;
end $$;
