-- 0537 · SWH GUARD MERGE (coordinator helper, drift audit 24 Nov R1). OWNER-RUN. AFTER 0290, 0291 and 0293.
-- Why: 0291 and 0293 both made a FULL new olnu_swh_guard(), and each one has rules the other one lacks:
--   0291 (live today):   a new-scheme swehockey row ("swh:<team slug>:<date>") hides its OLD game-id twin
--                        ("swh:<digits>:<date>", same start, same title or title + ' (dam)') and logs it in olnu_event_fix_log;
--                        the same for the regional TV twin ("tv:swh:<slug>:<date>" hides "tv:swh:<digits>:<date>").
--   0293 (staging, repo): a TV copy of a hidden swehockey game is hidden; a TV copy with a visible twin is hidden;
--                        a Tickster copy of a visible swehockey game is hidden.
-- This file = ONE text with BOTH. Copied from schema/functions/olnu_swh_guard().sql (snapshot 8 Nov = 0290) + the 0291 and
-- 0293 texts, then joined. Rules, in order (a row that is not 'ok' is never touched):
--   swehockey  1. women's lower leagues (HockeyEttan/Tvåan/Trean Dam) -> hidden (0290)
--              2. new-scheme id -> the old game-id twin is hidden + logged (0291)
--              3. a visible swehockey row with the same title + start and another id remains -> this row is hidden (0290/0293)
--                 (after rule 2 only a same-scheme twin can remain, so a new-scheme row is never hidden by its old twin)
--   tv:swh:*   1. new-scheme id -> the old game-id tv twin is hidden + logged (0291)
--              2. its swehockey game is hidden -> hidden (0293)
--              3. a visible tv twin with the same title + start and another id remains -> hidden (0293)
--   tickster   1. a visible swehockey game with the same start and title (' - ' = ' – ') -> hidden (0293)
-- Trigger function only (BEFORE INSERT on bar_events, trigger olnu_swh_guard_ins from 0290). It is not an RPC: execute is
-- revoked from public, anon and authenticated, so no user can call it; it reads no auth.uid() because a trigger runs for
-- the writer (the service-role importer). Fixed search_path. Same signature, owner and grants as before.
-- Additive and idempotent: CREATE OR REPLACE + REVOKE + a trigger that is made only when it is not there. Nothing is removed.
-- Check after the run (expect t, t, t):
--   select position('swh0537' in pg_get_functiondef('public.olnu_swh_guard()'::regprocedure)) > 0,
--          exists (select 1 from pg_trigger where tgname = 'olnu_swh_guard_ins' and tgrelid = 'public.bar_events'::regclass),
--          not has_function_privilege('anon', 'public.olnu_swh_guard()', 'execute');

do $c$ begin
  if to_regclass('public.olnu_event_fix_log') is null then
    raise exception '0537 needs 0290 (olnu_event_fix_log). Nothing changed.';
  end if;
end $c$;

CREATE OR REPLACE FUNCTION public.olnu_swh_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- swh0537: 0290 + 0291 + 0293 in one text
  if new.status is distinct from 'ok' then return new; end if;
  if new.source = 'swehockey' then
    if coalesce(new.league, '') ~* '^Hockey(Ettan|Tvåan|Trean) Dam' then
      new.status := 'hidden';
      return new;
    end if;
    if coalesce(new.source_id, '') !~ '^swh:\d+:' then
      -- 0291: new id scheme: the old game-id twin gives way
      insert into public.olnu_event_fix_log (id, prev_status, reason)
        select b.id, b.status, 'swh_guard: old game-id twin of ' || new.source_id from public.bar_events b
         where b.source = 'swehockey' and b.status = 'ok' and b.source_id ~ '^swh:\d+:' and b.starts_at = new.starts_at
           and (b.title = new.title or b.title || ' (dam)' = new.title);
      update public.bar_events b set status = 'hidden', updated_at = now()
       where b.source = 'swehockey' and b.status = 'ok' and b.source_id ~ '^swh:\d+:' and b.starts_at = new.starts_at
         and (b.title = new.title or b.title || ' (dam)' = new.title);
    end if;
    -- 0290/0293: a visible twin with another id remains -> this row is hidden
    if exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.status = 'ok'
               and b.title = new.title and b.starts_at = new.starts_at and b.source_id is distinct from new.source_id) then
      new.status := 'hidden';
    end if;
  elsif new.source = 'tv' and coalesce(new.source_id, '') like 'tv:swh:%' then
    if new.source_id !~ '^tv:swh:\d+:' then
      -- 0291: same rule for the regional TV twin ("tv:swh:<slug>:<date>" replaces "tv:swh:<game id>:<date>")
      insert into public.olnu_event_fix_log (id, prev_status, reason)
        select b.id, b.status, 'swh_guard: old game-id tv twin of ' || new.source_id from public.bar_events b
         where b.source = 'tv' and b.status = 'ok' and b.source_id ~ '^tv:swh:\d+:' and b.starts_at = new.starts_at
           and (b.title = new.title or b.title || ' (dam)' = new.title);
      update public.bar_events b set status = 'hidden', updated_at = now()
       where b.source = 'tv' and b.status = 'ok' and b.source_id ~ '^tv:swh:\d+:' and b.starts_at = new.starts_at
         and (b.title = new.title or b.title || ' (dam)' = new.title);
    end if;
    -- 0293: the TV copy of a hidden game is hidden; a TV copy with a visible twin is hidden
    if exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.source_id = substr(new.source_id, 4)
               and b.status = 'hidden') then
      new.status := 'hidden';
    elsif exists (select 1 from public.bar_events b where b.source = 'tv' and b.status = 'ok'
                  and b.title = new.title and b.starts_at = new.starts_at and b.source_id is distinct from new.source_id) then
      new.status := 'hidden';
    end if;
  elsif new.source = 'tickster' then
    -- 0293: Tickster lists the same hockey games
    if exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.status = 'ok'
               and b.starts_at = new.starts_at and b.title = replace(new.title, ' - ', ' – ')) then
      new.status := 'hidden';
    end if;
  end if;
  return new;
end $function$;
revoke all on function public.olnu_swh_guard() from public, anon, authenticated;

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'olnu_swh_guard_ins' and tgrelid = 'public.bar_events'::regclass) then
    create trigger olnu_swh_guard_ins before insert on public.bar_events for each row execute function public.olnu_swh_guard();
  end if;
end $t$;

select public.olnu_strip_cr();
