-- 0347 tx03 TWELVE NEW MEDALS (store-safe: social, care, places, games; nothing counts drinks or speed).
-- Additive: one new function. It is NOT named olnu_medal_eval_* on purpose: olnu_medal_store (award_medals) picks up every
-- olnu_medal_eval_* by name, and an old client would toast an unknown id. 0348 (owner-run, after the big-update client
-- is live) wires it in. Read-only over existing tables; no table changes. Applied live 2026-11-08 (not wired).
--   hemmarsch  🚶 Hemmarschen         stacks: Följ mig hem walks that ended "home" (walks.end_reason = 'home')
--   eskort     👀 Eskorten            stacks: a friend's walk you watched that ended home (walk_views)
--   chauffor   🚗 Kvällens chaufför   stacks: nights with "Jag kör ikväll" on (driver_status)
--   raddare    🆘 Räddaren i natten   stacks: "Jag kommer" on a friend's Hämta mig (pickup_answers 'kommer')
--   samman     🤝 Sammanhållningen    stacks: every 5 nights out with the squad (meriter_log 'squad', distinct nights / 5)
--   krigsfoto  📸 Krigsfotografen     25 photos in the group chat (meriter_log 'photo')
--   faltskar   🩺 Fältskären          checked on a friend 5 times (meriter_log 'buddy')
--   punktlig   ⏱️ Punktlig soldat     came where you said 5 times (meriter_log 'arrive' + 'invite_show')
--   lekledare  🎲 Lekledaren          10 party games with 3+ players (meriter_log 'party')
--   riksturne  🚆 Riksturnén          out in 5 different towns (after_nights.town)
--   tuppen     🐓 Först i stan        stacks: first check-in of the night in a town where others checked in later
--   skalrunda  🎊 Skålrundan          stacks: nights you gave skål to 5+ different people
create or replace function public.olnu_tx_medals(p_uid uuid)
returns table (medal text, n integer)
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_walk int := 0; v_esc int := 0; v_drv int := 0; v_pick int := 0;
  v_squad int := 0; v_photo int := 0; v_buddy int := 0; v_arr int := 0; v_party int := 0;
  v_towns int := 0; v_first int := 0; v_skal int := 0;
begin
  if p_uid is null then return; end if;
  select count(*)::int into v_walk from public.walks w where w.user_id = p_uid and w.end_reason = 'home';
  select count(distinct v.walk_id)::int into v_esc
    from public.walk_views v join public.walks w on w.id = v.walk_id
   where v.user_id = p_uid and w.user_id <> p_uid and w.end_reason = 'home';
  select count(distinct d.night)::int into v_drv from public.driver_status d where d.user_id = p_uid;
  select count(distinct a.req_id)::int into v_pick
    from public.pickup_answers a join public.pickup_reqs r on r.id = a.req_id
   where a.user_id = p_uid and a.ans = 'kommer' and r.user_id <> p_uid;
  select coalesce(count(distinct l.night) filter (where l.kind = 'squad'), 0)::int,
         coalesce(count(*) filter (where l.kind = 'photo'), 0)::int,
         coalesce(count(*) filter (where l.kind = 'buddy'), 0)::int,
         coalesce(count(*) filter (where l.kind in ('arrive', 'invite_show')), 0)::int,
         coalesce(count(*) filter (where l.kind = 'party'), 0)::int
    into v_squad, v_photo, v_buddy, v_arr, v_party
    from public.meriter_log l where l.user_id = p_uid;
  select count(distinct a.town)::int into v_towns from public.after_nights a where a.user_id = p_uid and a.town is not null;
  -- Först i stan: my check-in was the first of the night in that town, and someone else checked in there later that night.
  with mine as (select distinct public.olnu_night_of(c.created_at) as night from public.checkins c where c.user_id = p_uid),
       ci as (select public.olnu_night_of(c.created_at) as night, public.olnu_town_of(c.lat, c.lng) as town, c.user_id, c.created_at
                from public.checkins c
               where c.lat is not null and c.lng is not null and public.olnu_night_of(c.created_at) in (select night from mine)),
       firsts as (select distinct on (ci.night, ci.town) ci.night, ci.town, ci.user_id
                    from ci where ci.town is not null order by ci.night, ci.town, ci.created_at, ci.user_id)
  select count(*)::int into v_first from firsts f
   where f.user_id = p_uid
     and exists (select 1 from ci o where o.night = f.night and o.town = f.town and o.user_id <> p_uid);
  -- Skålrundan: nights (beer night = expires_at) where I gave skål to 5+ different people.
  select count(*)::int into v_skal from (
    select b.expires_at from public.skals s join public.beers b on b.id = s.beer_id
     where s.user_id = p_uid and b.user_id <> p_uid
     group by b.expires_at having count(distinct b.user_id) >= 5) x;

  return query select v.medal, v.n from (values
    ('hemmarsch', v_walk),
    ('eskort', v_esc),
    ('chauffor', v_drv),
    ('raddare', v_pick),
    ('samman', v_squad / 5),
    ('krigsfoto', case when v_photo >= 25 then 1 else 0 end),
    ('faltskar', case when v_buddy >= 5 then 1 else 0 end),
    ('punktlig', case when v_arr >= 5 then 1 else 0 end),
    ('lekledare', case when v_party >= 10 then 1 else 0 end),
    ('riksturne', case when v_towns >= 5 then 1 else 0 end),
    ('tuppen', v_first),
    ('skalrunda', v_skal)
  ) as v(medal, n);
end $function$;
revoke all on function public.olnu_tx_medals(uuid) from public, anon, authenticated;
