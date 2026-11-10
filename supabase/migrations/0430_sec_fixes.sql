-- 0430 SEC (X3) · security fixes found in the 10 Nov audit (scratchpad/sec/REPORT.md). OWNER-RUN at release.
-- Run order: AFTER 0321, 0340 and 0400–0452 (it patches the deployed text of olnu_pins, poll_v2, poll_public and
-- live_checkins, which 0321/0340/0403 also change). Then 0431, then 0435.
-- Method (same as 0403 olnu_ub_patch / 0149 olnu_tz_patch): olnu_sec_patch() takes the DEPLOYED definition, makes exact
-- text replacements (each anchor must occur exactly once, else it raises and nothing changes), checks that the marker
-- is now in the text, and runs the CREATE OR REPLACE. A definition that already has the marker is skipped, so the file
-- is safe to run twice. Signatures, grants and answer shapes stay the same.
-- Additive only: one helper, one new column with a default, text patches. No row-removing or object-removing statement.
--
--  F1  "Bara vänner" (0340) must survive the release order: 0321 and 0340 both REPLACE olnu_pins in full; the later
--      file wins. This re-adds the 0340 condition when it is missing (the 0321 pin-follow reads stay).
--  F2  "Bara vänner": strangers still got the person's own check-in row (bar + 15-min time) in poll_v2, poll_public
--      and live_checkins. Now a friends-only person's check-in reaches only the people who know him.
--  F3  Owner key rate limit was ONE global counter: 21 wrong keys from anyone locked the owner out of stats.html for
--      an hour (and stats.html then logs the owner out). Now the counter is per caller (signed-in user, else the
--      client IP header, else one shared 'anon' bucket as before) with a global ceiling of 1000 per hour.
--  F4  group_league gave every caller the uuid of the top-10 groups. Now only the caller's own group has its id
--      (the client never reads the id: js/social.js drawLeague uses name/total/members/rank/is_mine).
--  F5  olnu_film_stocks_ok gets a fixed search_path (advisor); olnu_ride_dist (0420) is no longer callable by anon.

create or replace function public.olnu_sec_patch(p_fn regprocedure, p_marker text, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  i int; n int;
begin
  if position(p_marker in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_sec_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  if position(p_marker in v_def) = 0 then
    raise exception 'olnu_sec_patch %: marker % missing after the patch', p_fn::text, p_marker;
  end if;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_sec_patch(regprocedure, text, text[], text[]) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_sec_patch(regprocedure, text, text[], text[]) from anon, authenticated';
  end if;
end $g$;

-- ---------- F1: olnu_pins keeps "Bara vänner" whatever order 0321 / 0340 ran in ----------
-- (marker = the 0340 table name: a definition that already reads olnu_visibility is skipped)
select public.olnu_sec_patch('public.olnu_pins(uuid, double precision, double precision, double precision, double precision)',
  'olnu_visibility',
  array['and not public.olnu_ub_hidden(p_uid, c.user_id);'],
  array['and not public.olnu_ub_hidden(p_uid, c.user_id)
     -- 0340 (re-added by 0430): "Bara vänner": a stranger never gets this user''s pin
     and (c.known or not exists (select 1 from public.olnu_visibility v where v.user_id = c.user_id and v.friends_only));']);

-- ---------- F2: friends-only check-ins never reach strangers ----------
select public.olnu_sec_patch('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)',
  '/*sec0430*/',
  array['where not public.olnu_ub_hidden(v_uid, c.user_id) and (c.user_id = v_uid or f.fname is not null'],
  array['where not public.olnu_ub_hidden(v_uid, c.user_id) /*sec0430*/
                        and (c.user_id = v_uid or f.fname is not null
                             or not exists (select 1 from public.olnu_visibility v0 where v0.user_id = c.user_id and v0.friends_only))
                        and (c.user_id = v_uid or f.fname is not null']);

select public.olnu_sec_patch('public.poll_public(double precision, double precision, double precision, double precision, boolean)',
  '/*sec0430*/',
  array['and c0.lat between v_a and v_c and c0.lng between v_b and v_d'],
  array['and c0.lat between v_a and v_c and c0.lng between v_b and v_d /*sec0430*/
                            and not exists (select 1 from public.olnu_visibility v0 where v0.user_id = c0.user_id and v0.friends_only)']);

select public.olnu_sec_patch('public.live_checkins()',
  '/*sec0430*/',
  array['where c.expires_at > now() and not public.olnu_ub_hidden(v_uid, c.user_id) and ('],
  array['where c.expires_at > now() and not public.olnu_ub_hidden(v_uid, c.user_id) /*sec0430*/
     and (c.user_id = v_uid or f.fname is not null
          or not exists (select 1 from public.olnu_visibility v0 where v0.user_id = c.user_id and v0.friends_only))
     and (']);

-- ---------- F3: owner key rate limit per caller, not global ----------
-- The caller bucket: the signed-in user, else the client IP that the API gateway puts in the request headers
-- (cf-connecting-ip / x-real-ip; never x-forwarded-for, which a client can extend), else one shared 'anon' bucket.
create or replace function public.olnu_sec_bucket()
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare h jsonb; v text;
begin
  if auth.uid() is not null then return 'u:' || auth.uid()::text; end if;
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  v := nullif(btrim(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', '')), '');
  if v is not null and char_length(v) <= 64 then return 'ip:' || v; end if;
  return 'anon';
end $$;
revoke all on function public.olnu_sec_bucket() from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_sec_bucket() from anon, authenticated';
  end if;
end $g$;

-- every failed key is stored with the caller bucket (the existing insert statements fill it by this default)
alter table public.owner_key_fails add column if not exists bucket text default public.olnu_sec_bucket();
create index if not exists owner_key_fails_bucket_at on public.owner_key_fails (bucket, at);

create or replace function public.olnu_sec_owner_limited()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select (select count(*) from public.owner_key_fails f
           where f.at > now() - interval '1 hour' and f.bucket is not distinct from public.olnu_sec_bucket()) > 20
      or (select count(*) from public.owner_key_fails f where f.at > now() - interval '1 hour') > 1000;
$$;
revoke all on function public.olnu_sec_owner_limited() from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_sec_owner_limited() from anon, authenticated';
  end if;
end $g$;

select public.olnu_sec_patch('public.olnu_wd_owner_ok(text)', '/*sec0430*/',
  array['if (select count(*) from public.owner_key_fails f where f.at > now() - interval ''1 hour'') > 20 then'],
  array['if public.olnu_sec_owner_limited() /*sec0430*/ then']);

select public.olnu_sec_patch('public.owner_move_stats(text)', '/*sec0430*/',
  array['if (select count(*) from public.owner_key_fails f where f.at > now() - interval ''1 hour'') > 20 then'],
  array['if public.olnu_sec_owner_limited() /*sec0430*/ then']);

select public.olnu_sec_patch('public.owner_stats(text)', '/*sec0430*/',
  array['if (select count(*) from public.owner_key_fails f where f.at > v_now - interval ''1 hour'') > 20 then'],
  array['if public.olnu_sec_owner_limited() /*sec0430*/ then']);

-- ---------- F4: group_league gives no other group's id ----------
select public.olnu_sec_patch('public.group_league()', '/*sec0430*/',
  array['select r.gid, case when r.mine then r.gname else null end'],
  array['select case when r.mine then r.gid end /*sec0430*/, case when r.mine then r.gname else null end']);

-- ---------- F5: small hardening (advisor + grants) ----------
-- Advisor "function_search_path_mutable" on live: olnu_film_stocks_ok (0392) has no fixed search_path.
alter function public.olnu_film_stocks_ok() set search_path = public;
-- 0420 left the default PUBLIC execute on a math helper (anon could call it). Only the ride functions use it.
revoke all on function public.olnu_ride_dist(double precision, double precision, double precision, double precision) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_ride_dist(double precision, double precision, double precision, double precision) from anon, authenticated';
  end if;
end $g$;
