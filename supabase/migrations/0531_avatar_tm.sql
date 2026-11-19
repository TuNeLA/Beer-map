-- 0531_avatar_tm.sql (lane hockeybuild, I-116; numbered by the coordinator): the avatar spec key "tm" = hockey shirt in town colours (docs/js/hockey-shirts.js).
-- Additive + idempotent: only olnu_avatar_max() gets "tm":28 (22 towns now, room for the 6 later ones). olnu_avatar_clean() needs no change
-- (it accepts any key in olnu_avatar_max with a number 0..max). No lock for tm (free for everyone).
-- Base = 0508_unlocks.sql olnu_avatar_max (the latest definition).
create or replace function public.olnu_avatar_max()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{"ms":1,"nl":1,"tm":28,"hx":16777216,"ux":16777216,"bx":16777216,"h2":22,"ht":3,"sk":22,"fs":7,"ey":21,"ec":11,"br":14,"ns":11,"mt":21,"ck":6,"fm":11,"fp":11,"er":12,"hr":33,"hc":21,"fh":25,"hw":47,"gl":30,"nk":17,"up":32,"uc":19,"bg":39,"hi":16,"fr":12}'::jsonb;
$$;
select public.olnu_strip_cr();
