-- Öl Nu v26 — bar list cleanup 2026-10-20 (scripts/clean-bars.mjs, report in CONTRACT "v26"). UPDATE only.
-- Duplicates (same name, 1–24 m apart; the OSM way / older node is kept), a bar no longer in OSM / bars.json,
-- and Solo (closed, owner report). The same ids are in docs/bars-closed.json, so a bars.json re-import keeps them out.
update public.bars_lite set active = false, updated_at = now()
 where active and id in ('n1471185136', 'n11360925580', 'n2293728903', 'n8415344232', 'n9846285868', 'n1211022409',
                         'n874275166', 'n6063629632', 'n2466676052');
-- Re-snap live pins / recent heat to the remaining bars (0015).
do $$ begin
  if exists (select 1 from pg_proc where proname = 'olnu_resnap' and pronamespace = 'public'::regnamespace) then perform public.olnu_resnap(); end if;
end $$;
