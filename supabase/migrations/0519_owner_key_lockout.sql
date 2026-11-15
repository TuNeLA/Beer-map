-- 0519 · owner tools: a stranger cannot lock the owner out; the correct key always works (lane srv1, security test 14 Nov, finding 5). OWNER-RUN. Staging first.
-- A3-EXCEPTION: one guard line changes in 3 owner functions (olnu_wd_owner_ok, owner_move_stats, owner_stats). owner_stats is long and 0430 runs again in the release list: an exact anchored one-line patch keeps the /*sec0430*/ marker (so 0430 skips these functions) and lands on live and on the release model. Coordinator dry-runs it on live in a rolled-back transaction first.
-- Check after the run (expect t, t, t, t):
--   select position('/*s519*/' in pg_get_functiondef('public.olnu_wd_owner_ok(text)'::regprocedure)) > 0,
--     position('/*s519*/' in pg_get_functiondef('public.owner_move_stats(text)'::regprocedure)) > 0,
--     position('/*s519*/' in pg_get_functiondef('public.owner_stats(text)'::regprocedure)) > 0,
--     to_regprocedure('public.olnu_s519_owner_limited(text)') is not null;
--
-- Why: the lock-out of the owner functions had a global part (more than 1000 wrong keys per hour from anyone) and the
-- limit was tested BEFORE the key. About 50 new anonymous users with 21 wrong keys each stopped every owner_* function
-- for one hour, also for the correct key. The bucket of a signed-in caller was the user id, and a new anonymous user is free.
-- What changes:
--   1. The key is tested first. A caller with the correct key is never limited (no flood of wrong keys can block the owner).
--   2. A wrong key is counted per caller IP (the md5 key of olnu_gw_client_key: cf-connecting-ip first), also for a
--      signed-in caller. No IP header: per user id; no user: one shared bucket. More than 20 wrong keys per hour from
--      one bucket → rate_limited for that bucket only (same error as before).
--   3. The global count (more than 1000 wrong keys per hour) stays, but only for wrong keys. It keeps the fail table small.
--   4. The compare is the same as before: SHA-256 of the given key, looked up in owner_keys. The time of that lookup
--      does not depend on how many characters of the key are right (a hash has no partial match), so there is no timing leak.
-- owner_key_fails.bucket gets the new default (a hashed IP key, no raw IP). Old rows stay; they fall out after one hour.
-- 0430 still owns olnu_sec_owner_limited() and olnu_sec_bucket(): they are not changed and not used any more.
-- Functions changed (snapshot these first = the rollback): olnu_wd_owner_ok(text), owner_move_stats(text), owner_stats(text)
--   [one anchored line each]; column default of owner_key_fails.bucket (old default: public.olnu_sec_bucket()).
-- New internal helpers (no grant to anon / authenticated): olnu_s519_bucket(), olnu_s519_owner_limited(text).
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_sec_patch (0430), olnu_gw_client_key, olnu_strip_cr (0436).

create or replace function public.olnu_s519_bucket()
returns text language plpgsql stable set search_path = public as $$
declare
  v_k text := public.olnu_gw_client_key();
begin
  if v_k is not null and v_k <> 'none' then return 'k:' || v_k; end if;
  if auth.uid() is not null then return 'u:' || auth.uid()::text; end if;
  return 'anon';
end $$;

create or replace function public.olnu_s519_owner_limited(p_key text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_b text;
begin
  -- the correct key is never limited
  if p_key is not null and char_length(p_key) <= 200 and exists (
       select 1 from public.owner_keys k where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    return false;
  end if;
  -- a wrong key: per caller, and one global cap that only wrong keys can hit
  v_b := public.olnu_s519_bucket();
  return (select count(*) from public.owner_key_fails f where f.at > now() - interval '1 hour' and f.bucket = v_b) > 20
      or (select count(*) from public.owner_key_fails f where f.at > now() - interval '1 hour') > 1000;
end $$;

revoke all on function public.olnu_s519_bucket() from public, anon, authenticated;
revoke all on function public.olnu_s519_owner_limited(text) from public, anon, authenticated;

alter table public.owner_key_fails alter column bucket set default public.olnu_s519_bucket();

select public.olnu_sec_patch('public.olnu_wd_owner_ok(text)', '/*s519*/',
  array[$a$if public.olnu_sec_owner_limited() /*sec0430*/ then$a$],
  array[$a$if public.olnu_s519_owner_limited(p_key) /*sec0430*/ /*s519*/ then$a$]);

select public.olnu_sec_patch('public.owner_move_stats(text)', '/*s519*/',
  array[$a$if public.olnu_sec_owner_limited() /*sec0430*/ then$a$],
  array[$a$if public.olnu_s519_owner_limited(p_key) /*sec0430*/ /*s519*/ then$a$]);

select public.olnu_sec_patch('public.owner_stats(text)', '/*s519*/',
  array[$a$if public.olnu_sec_owner_limited() /*sec0430*/ then$a$],
  array[$a$if public.olnu_s519_owner_limited(p_key) /*sec0430*/ /*s519*/ then$a$]);

select public.olnu_strip_cr();
