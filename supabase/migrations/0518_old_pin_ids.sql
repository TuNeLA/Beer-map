-- 0518 · old pin functions: no fixed beer id for strangers; skal and react check block and visibility (lane srv1, security test 14 Nov, finding 4). OWNER-RUN. Staging first.
-- Check after the run (expect t, t, t, t, t, t, t):
--   select position('/*s518*/' in pg_get_functiondef('public.live_beers()'::regprocedure)) > 0,
--     position('/*s518*/' in pg_get_functiondef('public.live_others()'::regprocedure)) > 0,
--     position('/*s518*/' in pg_get_functiondef('public.beer_reactions()'::regprocedure)) > 0,
--     position('/*s518*/' in pg_get_functiondef('public.skal(bigint)'::regprocedure)) > 0,
--     position('/*s518*/' in pg_get_functiondef('public.skal_v2(text)'::regprocedure)) > 0,
--     position('/*s518*/' in pg_get_functiondef('public.react(bigint, text)'::regprocedure)) > 0,
--     position('/*s518*/' in pg_get_functiondef('public.react_v2(text, text)'::regprocedure)) > 0;
--
-- Why: poll_v2 gives a stranger a pin id that changes every 10 minutes. The old live_beers gave the real, fixed beer id,
-- so one person could be followed from bar to bar all night. skal(beer id) and react(beer id) had no check at all:
-- a stranger could skål a pin that he cannot see, also the pin of a person who blocked him or who shows pins to friends only.
-- The client of today uses poll_v2 / skal_v2 / react_v2. It calls live_beers, live_others, skal(id) only when poll_v2 is missing.
-- What changes (names, parameters and result columns stay the same):
--   live_beers      id = the real id for the caller's own pin and group mates' pins (as before). For a stranger's pin it is a
--                   negative number made from the 10-minute pin id (never the beer id). skal / react take that number back.
--   live_others     only the caller's own beer and group mates' beers (a stranger's row could not be matched to a pin any more).
--   beer_reactions  the same rule.
--   skal, react     the number must be the caller's own beer (own_beer as before), a group mate's beer or a rotating number.
--                   Any other number: beer_not_found (the answer the client already handles).
--   skal_v2, react_v2  same pin rule as before; the write is now in one helper with the checks.
--   Every skål / reaction: the beer must be visible to the caller: not blocked either way, not "friends only" for a
--   stranger, not in the test zone for a normal user (the same rules as olnu_pins).
-- Functions replaced (snapshot these first = the rollback): live_beers(), live_others(), beer_reactions(), skal(bigint),
--   skal_v2(text), react(bigint, text), react_v2(text, text). All 7 are the same text on live (snapshot 8 Nov) and staging.
-- New internal helpers (no grant to anon / authenticated): olnu_s518_owner, olnu_s518_id, olnu_s518_skal, olnu_s518_react.
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_resolve_pin, olnu_ub_hidden, olnu_are_friends, olnu_strip_cr (0436).

create or replace function public.olnu_fn_expect(p_fn regprocedure, p_marker text, p_md5 text[])
returns text language plpgsql set search_path = public as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');
begin
  if position(p_marker in v_def) > 0 then return 'has ' || p_marker || ' ' || p_fn::text; end if;
  if md5(v_def) = any (p_md5) then return 'ok ' || p_fn::text; end if;
  raise exception 'olnu_fn_expect %: this function is not the text that the file was made from (md5 %). Stop and tell the coordinator.', p_fn::text, md5(v_def);
end $$;
revoke all on function public.olnu_fn_expect(regprocedure, text, text[]) from public, anon, authenticated;

-- The owner of a live beer when the caller may see it, else null (the visibility rules of olnu_pins).
create or replace function public.olnu_s518_owner(p_uid uuid, p_beer_id bigint)
returns uuid language sql stable set search_path = public as $$
  select b.user_id from public.beers b
   where b.id = p_beer_id and b.expires_at > now() and not b.stopped
     and not public.olnu_ub_hidden(p_uid, b.user_id)
     and (b.user_id = p_uid
          or exists (select 1 from public.group_members am join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid where am.user_id = b.user_id)
          or ((not exists (select 1 from public.olnu_visibility v where v.user_id = b.user_id and v.friends_only)
               or public.olnu_are_friends(p_uid, b.user_id))
              and (not public.olnu_is_test_zone(b.lat, b.lng) or public.olnu_is_test_user(p_uid))));
$$;

-- A number from the client → the beer id, or null. >= 0: only the caller's own beer or a group mate's beer.
-- < 0: the rotating number of live_beers (this 10-minute bucket and the one before).
create or replace function public.olnu_s518_id(p_uid uuid, p_num bigint)
returns bigint language plpgsql stable set search_path = public as $$
declare
  v_secret text;
  v_bucket bigint := floor(extract(epoch from now()) / 600)::bigint;
  v_hex    text;
  v_id     bigint;
begin
  if p_num is null then return null; end if;
  if p_num >= 0 then return public.olnu_resolve_pin(p_uid, p_num::text); end if;
  if p_num < -281474976710656 then return null; end if;
  v_hex := lpad(to_hex(-(p_num + 1)), 12, '0');
  select s.secret into v_secret from public.olnu_secrets s where s.id = 1;
  select b.id into v_id from public.beers b
   where b.expires_at > now() and not b.stopped
     and (left(md5(v_secret || ':' || b.id::text || ':' || v_bucket::text), 12) = v_hex
       or left(md5(v_secret || ':' || b.id::text || ':' || (v_bucket - 1)::text), 12) = v_hex)
   limit 1;
  return v_id;
end $$;

create or replace function public.olnu_s518_skal(p_uid uuid, p_beer_id bigint)
returns json language plpgsql set search_path = public as $$
declare
  v_owner uuid := public.olnu_s518_owner(p_uid, p_beer_id);
  v_count int;
  v_rows  int;
begin
  if p_uid is null then raise exception 'not_authenticated'; end if;
  if v_owner is null then raise exception 'beer_not_found'; end if;
  if v_owner = p_uid then raise exception 'own_beer'; end if;
  insert into public.skals (beer_id, user_id) values (p_beer_id, p_uid)
  on conflict (beer_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  select count(*)::int into v_count from public.skals s where s.beer_id = p_beer_id;
  return json_build_object('skal_count', v_count, 'already', v_rows = 0);
end $$;

create or replace function public.olnu_s518_react(p_uid uuid, p_beer_id bigint, p_emoji text)
returns json language plpgsql set search_path = public as $$
declare
  v_owner uuid := public.olnu_s518_owner(p_uid, p_beer_id);
  v_counts json; v_mine json;
begin
  if p_uid is null then raise exception 'not_authenticated'; end if;
  if p_emoji is null or p_emoji not in ('🔥', '😂', '💀', '💪') then raise exception 'invalid_emoji'; end if;
  if v_owner is null then raise exception 'beer_not_found'; end if;
  if v_owner = p_uid then raise exception 'own_beer'; end if;
  insert into public.reactions (beer_id, user_id, emoji) values (p_beer_id, p_uid, p_emoji)
  on conflict (beer_id, user_id, emoji) do update set active = not public.reactions.active, updated_at = now();
  select coalesce(json_object_agg(c.emoji, c.cnt), '{}'::json) into v_counts
    from (select r.emoji, count(*)::int as cnt from public.reactions r where r.beer_id = p_beer_id and r.active group by r.emoji) c;
  select coalesce(json_agg(r.emoji order by r.emoji), '[]'::json) into v_mine
    from public.reactions r where r.beer_id = p_beer_id and r.user_id = p_uid and r.active;
  return json_build_object('counts', v_counts, 'mine', v_mine);
end $$;

revoke all on function public.olnu_s518_owner(uuid, bigint) from public, anon, authenticated;
revoke all on function public.olnu_s518_id(uuid, bigint) from public, anon, authenticated;
revoke all on function public.olnu_s518_skal(uuid, bigint) from public, anon, authenticated;
revoke all on function public.olnu_s518_react(uuid, bigint, text) from public, anon, authenticated;

select public.olnu_fn_expect('public.live_beers()', '/*s518*/', array['ab249db2275f759d0e99d1f9637ca7ab']);
CREATE OR REPLACE FUNCTION public.live_beers()
 RETURNS TABLE(id bigint, lat double precision, lng double precision, beer_count integer, precise boolean, created_at timestamp with time zone, is_mine boolean, friend_name text, skal_count integer, i_skaled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with p as (
    select * from public.olnu_pins(v_uid, null, null, null, null)
  ),
  sk as (
    select s.beer_id as sid, count(*)::int as n, bool_or(s.user_id = v_uid) as mine
      from public.skals s join p on p.beer_id = s.beer_id
     group by s.beer_id
  )
  select case when p.is_mine or p.is_friend then p.beer_id
              else -(('x' || substr(p.pin_id, 2, 12))::bit(48)::bigint) - 1 end, /*s518*/
         p.lat, p.lng, p.beer_count, p.precise, p.created_at, p.is_mine,
         case when p.is_mine then null else p.friend_name end,
         coalesce(sk.n, 0), coalesce(sk.mine, false)
    from p left join sk on sk.sid = p.beer_id
   order by p.created_at, p.beer_id;
end;
$function$;

select public.olnu_fn_expect('public.live_others()', '/*s518*/', array['65c6a7e2521a8061cb4606e13f6f5ad0']);
CREATE OR REPLACE FUNCTION public.live_others()
 RETURNS TABLE(beer_id bigint, other_count integer, other_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.olnu_uid();
  return query
  select b.id, b.other_count, b.other_kind from public.beers b
   where b.expires_at > now() and not b.stopped and b.other_count > 0 
     and (b.user_id = auth.uid() or exists (select 1 from public.group_members am join public.group_members cm on cm.group_id = am.group_id and cm.user_id = auth.uid() where am.user_id = b.user_id)) /*s518*/
     and not public.olnu_ub_hidden(auth.uid(), b.user_id)
   order by b.id;
end; $function$;

select public.olnu_fn_expect('public.beer_reactions()', '/*s518*/', array['7517816ae0da94bdead87e135ed29797']);
CREATE OR REPLACE FUNCTION public.beer_reactions()
 RETURNS TABLE(beer_id bigint, emoji text, n integer, mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return query
  select r.beer_id, r.emoji, count(*)::int, bool_or(r.user_id = v_uid)
    from public.reactions r
    join public.beers b on b.id = r.beer_id and b.expires_at > now() and not b.stopped
   where r.active
     and (b.user_id = v_uid or exists (select 1 from public.group_members am join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid where am.user_id = b.user_id)) /*s518*/
     and not public.olnu_ub_hidden(v_uid, b.user_id)
   group by r.beer_id, r.emoji order by r.beer_id, r.emoji;
end; $function$;

select public.olnu_fn_expect('public.skal(bigint)', '/*s518*/', array['3e04787d426439c36b18f61e006d1423']);
CREATE OR REPLACE FUNCTION public.skal(p_beer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  -- /*s518*/ a number from the caller is the caller's own beer, a group mate's beer or a rotating number from live_beers
  return public.olnu_s518_skal(v_uid, public.olnu_s518_id(v_uid, p_beer_id));
end;
$function$;

select public.olnu_fn_expect('public.skal_v2(text)', '/*s518*/', array['7fb0fe04303feb558ae5a6193004a1ea']);
CREATE OR REPLACE FUNCTION public.skal_v2(p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_id  bigint := public.olnu_resolve_pin(v_uid, p_pin);
begin
  if v_id is null then
    raise exception 'beer_not_found';
  end if;
  return public.olnu_s518_skal(v_uid, v_id); /*s518*/
end;
$function$;

select public.olnu_fn_expect('public.react(bigint, text)', '/*s518*/', array['aaeac47834cccd6e105a31f20c37e6f4']);
CREATE OR REPLACE FUNCTION public.react(p_beer_id bigint, p_emoji text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if p_emoji is null or p_emoji not in ('🔥', '😂', '💀', '💪') then raise exception 'invalid_emoji'; end if;
  -- /*s518*/ same id rule as skal
  return public.olnu_s518_react(v_uid, public.olnu_s518_id(v_uid, p_beer_id), p_emoji);
end;
$function$;

select public.olnu_fn_expect('public.react_v2(text, text)', '/*s518*/', array['7fc84f26467d04bdf27552722b245d2e']);
CREATE OR REPLACE FUNCTION public.react_v2(p_pin text, p_emoji text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_id  bigint;
begin
  if p_emoji is null or p_emoji not in ('🔥', '😂', '💀', '💪') then
    raise exception 'invalid_emoji';
  end if;
  v_id := public.olnu_resolve_pin(v_uid, p_pin);
  if v_id is null then
    raise exception 'beer_not_found';
  end if;
  return public.olnu_s518_react(v_uid, v_id, p_emoji); /*s518*/
end;
$function$;

select public.olnu_strip_cr();
