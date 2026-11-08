-- 0348 tx03 Turn the twelve new medals on (OWNER-RUN, after the big-update client with the new MEDALS.CAT is live;
-- same pattern as 0315 for the place medals — run 0315 too if it has not run yet).
-- Additive: one new function. olnu_medal_store (award_medals) finds every olnu_medal_eval_* by name, so from now on the
-- 0347 medals are awarded with the others. Undo = rename the function. Safe to run again.
create or replace function public.olnu_medal_eval_tx(p_uid uuid)
returns table (medal text, n integer)
language sql stable security definer set search_path to 'public' as $$
  select x.medal, x.n from public.olnu_tx_medals(p_uid) x;
$$;
revoke all on function public.olnu_medal_eval_tx(uuid) from public, anon, authenticated;
