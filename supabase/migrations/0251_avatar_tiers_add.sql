-- 0251 👤 AVATAR v3 tiers, part 1 (agent feat, 2026-11-07). ADDITIVE ONLY (new table + new function + rows in the new table).
-- Owner: "too much is unlocked; only at glasses some things are locked". v3 gives each category a clear free set and
-- 90 more items unlock by rank (meriter: grad 2 = 5, grad 3 = 10, grad 4 = 18, grad 5 = 28, grad 6 = 40). Real skin tones,
-- face shapes, natural hair colours and natural / cultural hair styles (afro, flätor, dreads, rader …) stay free.
-- Every v3 lock has "n":1. Nothing is taken away:
--   * avatar_grandfather = everyone who saved an avatar before v3 → every "n" lock is open for them (0252 lock_ok);
--   * the item you already wear is never locked (olnu_avatar_clean, unchanged rule).
-- Nothing uses this until the owner runs 0252 (it changes 3 existing functions). Same list as LOCKS3 in docs/js/avatar.js.
create table if not exists public.avatar_grandfather (
  user_id uuid primary key references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.avatar_grandfather enable row level security;
revoke all on table public.avatar_grandfather from public, anon, authenticated;

insert into public.avatar_grandfather (user_id)
select a.user_id from public.avatars a
 where exists (select 1 from auth.users u where u.id = a.user_id)
on conflict (user_id) do nothing;

create or replace function public.olnu_avatar_locks3()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{"ey:11":{"r":2,"n":1},"ey:13":{"r":3,"n":1},"ey:14":{"r":4,"n":1},"ey:15":{"r":5,"n":1},"ey:16":{"r":6,"n":1},"br:11":{"r":3,"n":1},"br:14":{"r":4,"n":1},"ns:11":{"r":4,"n":1},"mt:11":{"r":2,"n":1},"mt:12":{"r":2,"n":1},"mt:13":{"r":3,"n":1},"mt:14":{"r":3,"n":1},"mt:15":{"r":4,"n":1},"mt:17":{"r":5,"n":1},"mt:18":{"r":4,"n":1},"ck:5":{"r":2,"n":1},"ck:6":{"r":3,"n":1},"fm:4":{"r":2,"n":1},"fm:5":{"r":3,"n":1},"fm:6":{"r":2,"n":1},"fm:7":{"r":4,"n":1},"fm:8":{"r":4,"n":1},"fm:9":{"r":5,"n":1},"fm:11":{"r":6,"n":1},"fp:7":{"r":4,"n":1},"fp:10":{"r":3,"n":1},"er:6":{"r":3,"n":1},"er:9":{"r":4,"n":1},"er:10":{"r":5,"n":1},"er:12":{"r":3,"n":1},"hr:18":{"r":2,"n":1},"hr:19":{"r":2,"n":1},"hr:21":{"r":3,"n":1},"hr:24":{"r":2,"n":1},"hr:25":{"r":3,"n":1},"hr:26":{"r":3,"n":1},"hr:29":{"r":4,"n":1},"hr:33":{"r":2,"n":1},"hc:20":{"r":3,"n":1},"fh:10":{"r":2,"n":1},"fh:11":{"r":2,"n":1},"fh:14":{"r":3,"n":1},"fh:15":{"r":3,"n":1},"fh:16":{"r":4,"n":1},"fh:17":{"r":4,"n":1},"fh:20":{"r":5,"n":1},"fh:22":{"r":3,"n":1},"fh:23":{"r":5,"n":1},"fh:25":{"r":6,"n":1},"hw:15":{"r":2,"n":1},"hw:20":{"r":2,"n":1},"hw:21":{"r":3,"n":1},"hw:22":{"r":2,"n":1},"hw:24":{"r":4,"n":1},"hw:38":{"r":3,"n":1},"hw:39":{"r":3,"n":1},"hw:40":{"r":5,"n":1},"gl:11":{"r":2,"n":1},"gl:12":{"r":2,"n":1},"gl:13":{"r":3,"n":1},"gl:16":{"r":4,"n":1},"gl:17":{"r":2,"n":1},"gl:18":{"r":3,"n":1},"gl:19":{"r":5,"n":1},"gl:26":{"r":2,"n":1},"gl:27":{"r":6,"n":1},"nk:4":{"r":2,"n":1},"nk:6":{"r":3,"n":1},"nk:7":{"r":2,"n":1},"nk:11":{"r":3,"n":1},"up:10":{"r":3,"n":1},"up:12":{"r":2,"n":1},"up:20":{"r":3,"n":1},"uc:8":{"r":2,"n":1},"uc:10":{"r":2,"n":1},"uc:14":{"r":2,"n":1},"uc:15":{"r":2,"n":1},"uc:17":{"r":3,"n":1},"uc:18":{"r":3,"n":1},"uc:19":{"r":3,"n":1},"bg:16":{"r":4,"n":1},"bg:17":{"r":2,"n":1},"bg:18":{"r":2,"n":1},"bg:21":{"r":3,"n":1},"bg:26":{"r":3,"n":1},"bg:27":{"r":4,"n":1},"bg:28":{"r":5,"n":1},"hi:4":{"r":2,"n":1},"hi:6":{"r":3,"n":1},"fr:7":{"r":4,"n":1}}'::jsonb;
$$;
revoke all on function public.olnu_avatar_locks3() from public, anon, authenticated;
