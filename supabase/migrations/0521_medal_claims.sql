-- 0521 · medals: claim_medal and award_medals('home') need a server fact; claims are counted in a log (lane srv1, security test 14 Nov, finding 7). OWNER-RUN. Staging first.
-- Check after the run (expect t, t, t):
--   select position('/*s521*/' in pg_get_functiondef('public.claim_medal(text)'::regprocedure)) > 0,
--     position('/*s521*/' in pg_get_functiondef('public.award_medals(text)'::regprocedure)) > 0,
--     to_regclass('public.medal_claim_log') is not null;
--
-- Why: claim_medal gave 8 medals to anyone who asked, and award_medals('home') gave "hemvärn" to anyone with one live
-- drink. Medals show on the avatar that group mates and friends see.
-- What changes (same names, parameters and result columns; a refused claim is NOT an error: the answer is the normal
-- list of new medals, so no client changes and no toast):
--   claim_medal('vatten')  only when the water game has a glass for this night (the client calls it right after game_water).
--   claim_medal('spoke')   only with a live ghost-mode drink this night, or as an old local badge (next line).
--   claim_medal(dagsljus, uggla, sidospar, hemvarn, radio, krogrunda)  these were the one-time move of old local badges.
--                          The server counts all six from real data today. The claim now works only for an account made
--                          before 25 Oct 2026 (before the server medals), one time per medal, as before.
--   award_medals('home')   sets the home flag only when the pin is stopped (the "Jag är hemma" button stops it first),
--                          or the Ikväll status is "hemma", or a walk home ended with "home".
--   Every claim is counted in medal_claim_log (one row per person and medal: tries, refused, last reason, last time).
--   More than 30 calls for one medal in one day: the call does nothing and returns no rows.
-- No medal is taken from anyone: user_medals and medal_claims are not touched.
-- Functions replaced (snapshot these first = the rollback): claim_medal(text), award_medals(text)
--   [full replace; the same text on live (snapshot 8 Nov) and staging].
-- New: table medal_claim_log (RLS on, no policy, no grant). The erase function (delete_my_data) re-keys it like every
-- other table with a user uuid column. Additive. Safe to run twice. CR LF safe. Needs: olnu_strip_cr (0436).

create table if not exists public.medal_claim_log (
  user_id   uuid not null,
  medal     text not null,
  tries     integer not null default 0,
  refused   integer not null default 0,
  day       date not null default current_date,
  day_tries integer not null default 0,
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now(),
  last_why  text,
  primary key (user_id, medal)
);
alter table public.medal_claim_log enable row level security;
revoke all on table public.medal_claim_log from public, anon, authenticated;

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

select public.olnu_fn_expect('public.claim_medal(text)', '/*s521*/', array['c6c5773346d5f4c15749670da23ac3ad']);
CREATE OR REPLACE FUNCTION public.claim_medal(p_medal text)
 RETURNS TABLE(medal text, count integer, is_new boolean, earned_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_m   text := lower(btrim(coalesce(p_medal, '')));
  v_ok  boolean := false;   -- /*s521*/ true = the server has a fact for this medal
  v_why text;
  v_day int;
begin
  if v_m not in ('vatten', 'spoke', 'dagsljus', 'uggla', 'sidospar', 'hemvarn', 'radio', 'krogrunda') then
    raise exception 'invalid_medal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  -- The server fact for each medal:
  --   vatten: a glass of water in the game this night (game_water wrote it).
  --   spoke:  a live drink in ghost mode this night.
  --   the old local badges (and spoke with no ghost drink): only an account from before the server medals
  --           (made before 25 Oct 2026), one time per medal. A new account cannot have an old local badge.
  if v_m = 'vatten' then
    v_ok := exists (select 1 from public.game_facts f
                     where f.user_id = v_uid and f.night = public.olnu_night_of(now()) and f.water >= 1);
    v_why := case when v_ok then 'water' else 'no_water' end;
  elsif v_m = 'spoke' and exists (select 1 from public.beers b where b.user_id = v_uid and b.expires_at > now() and b.ghost) then
    v_ok := true;  v_why := 'ghost';
  else
    v_ok := exists (select 1 from auth.users u where u.id = v_uid and u.created_at < timestamptz '2026-10-25 00:00:00+00')
            and not exists (select 1 from public.medal_claims c where c.user_id = v_uid and c.medal = v_m);
    v_why := case when v_ok then 'old_badge' else 'no_fact' end;
  end if;
  -- Log: one row per person and medal (tries, refused, last reason). Limit: 30 calls per medal per day.
  insert into public.medal_claim_log as l (user_id, medal, tries, refused, day, day_tries, last_why)
  values (v_uid, v_m, 1, case when v_ok then 0 else 1 end, current_date, 1, v_why)
  on conflict on constraint medal_claim_log_pkey do update
     set tries = l.tries + 1, refused = l.refused + case when v_ok then 0 else 1 end,
         day_tries = case when l.day = current_date then l.day_tries + 1 else 1 end, day = current_date,
         last_at = now(), last_why = excluded.last_why
  returning l.day_tries into v_day;
  if v_day > 30 then
    return;
  end if;
  if v_ok and (v_m in ('vatten', 'spoke')
     or not exists (select 1 from public.medal_claims c where c.user_id = v_uid and c.medal = v_m)) then
    insert into public.medal_claims (user_id, medal, night)
    values (v_uid, v_m, public.olnu_night_of(now()))
    on conflict do nothing;
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$function$;

select public.olnu_fn_expect('public.award_medals(text)', '/*s521*/', array['babb28bb2969bad0c546a2dd14578d6e']);
CREATE OR REPLACE FUNCTION public.award_medals(p_event text DEFAULT NULL::text)
 RETURNS TABLE(medal text, count integer, is_new boolean, earned_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  if lower(btrim(coalesce(p_event, ''))) = 'home' then
    update public.medal_nights mn set home = true
      from public.beers b
     where b.user_id = v_uid and b.expires_at > now() and (b.beer_count + coalesce(b.other_count, 0)) >= 1
       and mn.user_id = v_uid and mn.night = b.expires_at
       -- /*s521*/ "home" needs a server fact of this night: the pin is stopped ("Jag är hemma"), the status is
       -- "hemma", or a walk home ended at home. One call with no such fact does not give the medal any more.
       and (b.stopped
            or exists (select 1 from public.ikvall_status i
                        where i.user_id = v_uid and i.st = 'hemma' and i.updated_at > now() - interval '18 hours')
            or exists (select 1 from public.walks w
                        where w.user_id = v_uid and w.end_reason = 'home' and w.ended_at > now() - interval '18 hours'));
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$function$;

select public.olnu_strip_cr();
