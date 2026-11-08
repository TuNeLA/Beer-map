-- 0292 · group member list sorted by meriter, most first, then name (owner request 2026-11-08, applied live).
-- Replaces the 0212 order in group_status_v3 (beers tonight / store mode). Meriter never come from drinks in store mode.
-- Anchored text edit of the live body; stops if the anchor is gone. Rerun = no change.
do $mig$
declare d text; a text;
begin
  d := pg_get_functiondef('public.group_status_v3'::regproc);
  if position('-- 0292' in d) > 0 then return; end if;
  a := 'order by case when public.olnu_store_on() then 0 else s.beers end desc, case when public.olnu_store_on() then 0 else s.others end desc,
            case when public.olnu_store_on() and s.live then 0 else 1 end, s.name   -- 0212';
  if position(a in d) = 0 then raise exception '0292 anchor missing in group_status_v3'; end if;
  d := replace(d, a, 'order by public.olnu_meriter(gm.user_id) desc nulls last, s.name   -- 0292');
  execute d;
end $mig$;
