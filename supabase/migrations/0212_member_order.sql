-- 0212 STORE-SAFE · the group member list is never sorted by drink count (owner decision 1: "Never sort people by count").
-- group_status_v3: in store mode the order is "out tonight first, then name". Before release (store_mode = 'off')
-- the order is unchanged for the live app. Anchored text edit of the live body (stops if the anchor is gone).
-- No row-removing or object-removing statement in this file.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.group_status_v3'::regproc);
  if position('olnu_store_on' in d) = 0 then
    if position('order by s.beers desc, s.others desc, s.name' in d) = 0 then raise exception '0212 anchor missing in group_status_v3'; end if;
    d := replace(d, 'order by s.beers desc, s.others desc, s.name',
      'order by case when public.olnu_store_on() then 0 else s.beers end desc, case when public.olnu_store_on() then 0 else s.others end desc,
            case when public.olnu_store_on() and s.live then 0 else 1 end, s.name   -- 0212');
    execute d;
  end if;
end $mig$;
