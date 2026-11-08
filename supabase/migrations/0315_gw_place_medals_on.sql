-- 0315 🗺️ Turn the place medals on (owner-run, AFTER the client with js/gw.js is live; see 0314).
-- Additive: one new function. olnu_medal_store (award_medals) finds every olnu_medal_eval_* by name, so from now on
-- pl_ny / pl_stad / pl_dalarna are awarded with the other medals. Undo = rename the function. Safe to run again.
create or replace function public.olnu_medal_eval_places(p_uid uuid)
returns table (medal text, n integer)
language sql stable security definer set search_path to 'public' as $$
  select x.medal, x.n from public.olnu_gw_place_medals(p_uid) x;
$$;
revoke all on function public.olnu_medal_eval_places(uuid) from public, anon, authenticated;
