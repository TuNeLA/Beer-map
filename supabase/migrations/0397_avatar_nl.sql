-- 0397 avatar nl (avt 2026-11-08): neckwear layer for scarves and chains. nl 0 = Utanpå (over the top, default; a missing
-- key = 0), 1 = Instoppad (under the top). Only adds "nl":1 to the max list; everything else is the same as 0200.
-- Old clients never send nl. New clients send nl only when it is 1, and save again without it when this is not applied yet.
create or replace function public.olnu_avatar_max()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{"ms":1,"nl":1,"hx":16777216,"ux":16777216,"bx":16777216,"h2":22,"ht":3,"sk":22,"fs":7,"ey":21,"ec":11,"br":14,"ns":11,"mt":21,"ck":6,"fm":11,"fp":11,"er":12,"hr":33,"hc":21,"fh":25,"hw":43,"gl":29,"nk":15,"up":30,"uc":19,"bg":38,"hi":16,"fr":10}'::jsonb;
$$;
