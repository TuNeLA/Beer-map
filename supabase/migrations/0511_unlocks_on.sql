-- 0511 · UNLOCKS ON (was 0509; renumbered: bump has 0509) (lane unlocks). OWNER-RUN, after 0508 AND after the client with js/unlock-parts.js is live
-- (that client puts the 37 u_* medals in MEDALS.CAT; an old client would toast an unknown id). Same pattern as 0348.
-- Additive: one new function. olnu_medal_store (award_medals) finds every olnu_medal_eval_* by name, so from now on the
-- unlock medals are awarded with the others, and my_avatar facts.m opens the items. Safe to run again.
-- Check after the run (expect t):
--   select exists (select 1 from pg_proc where proname = 'olnu_medal_eval_unl');
create or replace function public.olnu_medal_eval_unl(p_uid uuid)
returns table (medal text, n integer)
language sql stable security definer set search_path to 'public' as $$
  select x.medal, x.n from public.olnu_unlock_medals(p_uid) x;
$$;
revoke all on function public.olnu_medal_eval_unl(uuid) from public, anon, authenticated;

select public.olnu_strip_cr();
