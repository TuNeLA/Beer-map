-- 0291: stats.swehockey.se import, part 2 (goes with scripts/import-sport.mjs "ONE id" fix). Additive. Needs 0100/0105 (bar_events
-- sport columns), 0290 (olnu_event_fix_log, olnu_swh_guard). NOTHING is deleted; every status change is logged in olnu_event_fix_log.
--  1. swh_retire(p_day, p_seen): the importer calls it for each day page that loaded (HTTP 200, >= 1 parsed game). Visible
--     swehockey rows (and their 📺 'tv:swh:' twins) on that Stockholm day that the run did NOT produce = moved / cancelled /
--     now-skipped games → status 'hidden'. Service role only. Safety cap: it refuses (hides nothing) when it would hide more than
--     max(3, half) of the day's visible rows — a half-broken page must never empty the map.
--  2. olnu_swh_guard (0290) learns the new id scheme: all swehockey ids are now "swh:<team slug>:<date>". When a slug row comes in
--     and an old game-id twin ("swh:<digits>:<date>", same title + start) is visible, the OLD twin is hidden and the new row stays.
--     (0290 hid the new row instead; after the release that would leave the game with no visible row once swh_retire hides the old one.)
--  3. One-time swap for games hit by that between 0290 and this migration: hidden slug row + visible game-id twin → slug row visible,
--     twin hidden (one visible row per game, women's lower leagues stay hidden).
-- Rerun = no change.

create or replace function public.swh_retire(p_day date, p_seen text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Europe/Stockholm')::date;
  v_vis int; v_ids bigint[];
begin
  if p_day is null or p_day < v_today or p_day > v_today + 21 then
    return jsonb_build_object('day', p_day, 'hidden', 0, 'refused', 'day_out_of_range');
  end if;
  p_seen := coalesce(p_seen, '{}'::text[]);
  if cardinality(p_seen) > 3000 then raise exception 'too_many_ids'; end if;

  select count(*) into v_vis from public.bar_events e
   where e.status = 'ok' and (e.source = 'swehockey' or (e.source = 'tv' and e.source_id like 'tv:swh:%'))
     and (e.starts_at at time zone 'Europe/Stockholm')::date = p_day;

  select coalesce(array_agg(e.id), '{}'::bigint[]) into v_ids from public.bar_events e
   where e.status = 'ok' and (e.source = 'swehockey' or (e.source = 'tv' and e.source_id like 'tv:swh:%'))
     and (e.starts_at at time zone 'Europe/Stockholm')::date = p_day
     and coalesce(e.source_id, '') <> all (p_seen);

  if cardinality(v_ids) > greatest(3, v_vis / 2) then
    return jsonb_build_object('day', p_day, 'hidden', 0, 'visible', v_vis, 'would_hide', cardinality(v_ids), 'refused', 'too_many');
  end if;
  if cardinality(v_ids) > 0 then
    insert into public.olnu_event_fix_log (id, prev_status, reason) select x, 'ok', 'swh_retire ' || p_day from unnest(v_ids) x;
    update public.bar_events set status = 'hidden', updated_at = now() where id = any (v_ids) and status = 'ok';
  end if;
  return jsonb_build_object('day', p_day, 'hidden', cardinality(v_ids), 'visible', v_vis);
end $$;
revoke all on function public.swh_retire(date, text[]) from public, anon, authenticated;
grant execute on function public.swh_retire(date, text[]) to service_role;

create or replace function public.olnu_swh_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'swehockey' and new.status = 'ok' then
    if coalesce(new.league, '') ~* '^Hockey(Ettan|Tvåan|Trean) Dam' then
      new.status := 'hidden';
    elsif coalesce(new.source_id, '') !~ '^swh:\d+:' then
      -- new id scheme: the old game-id twin gives way
      insert into public.olnu_event_fix_log (id, prev_status, reason)
        select b.id, b.status, 'swh_guard: old game-id twin of ' || new.source_id from public.bar_events b
         where b.source = 'swehockey' and b.status = 'ok' and b.source_id ~ '^swh:\d+:' and b.starts_at = new.starts_at
         and (b.title = new.title or b.title || ' (dam)' = new.title);
      update public.bar_events b set status = 'hidden', updated_at = now()
       where b.source = 'swehockey' and b.status = 'ok' and b.source_id ~ '^swh:\d+:' and b.starts_at = new.starts_at
         and (b.title = new.title or b.title || ' (dam)' = new.title);
    elsif exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.status = 'ok'
                  and b.title = new.title and b.starts_at = new.starts_at and b.source_id is distinct from new.source_id) then
      new.status := 'hidden';   -- old importer (game-id row) while a visible twin exists
    end if;
  elsif new.source = 'tv' and new.status = 'ok' and coalesce(new.source_id, '') like 'tv:swh:%' and new.source_id !~ '^tv:swh:\d+:' then
    -- 📺 same rule for the regional TV twin ("tv:swh:<slug>:<date>" replaces "tv:swh:<game id>:<date>")
    insert into public.olnu_event_fix_log (id, prev_status, reason)
      select b.id, b.status, 'swh_guard: old game-id tv twin of ' || new.source_id from public.bar_events b
       where b.source = 'tv' and b.status = 'ok' and b.source_id ~ '^tv:swh:\d+:' and b.starts_at = new.starts_at
         and (b.title = new.title or b.title || ' (dam)' = new.title);
    update public.bar_events b set status = 'hidden', updated_at = now()
     where b.source = 'tv' and b.status = 'ok' and b.source_id ~ '^tv:swh:\d+:' and b.starts_at = new.starts_at
       and (b.title = new.title or b.title || ' (dam)' = new.title);
  end if;
  return new;
end $$;
revoke all on function public.olnu_swh_guard() from public, anon, authenticated;

-- 3. one-time swap (logged)
with pair as (
  select s.id as slug_id, g.id as gid_id
    from public.bar_events s
    join public.bar_events g on g.source = 'swehockey' and g.status = 'ok' and g.source_id ~ '^swh:\d+:'
                            and g.title = s.title and g.starts_at = s.starts_at
   where s.source = 'swehockey' and s.status = 'hidden' and s.source_id !~ '^swh:\d+:'
     and s.starts_at > now() - interval '12 hours'
     and coalesce(s.league, '') !~* '^Hockey(Ettan|Tvåan|Trean) Dam'
     and not exists (select 1 from public.olnu_event_fix_log l where l.id = s.id)          -- never undo a logged (manual) hide
     and not exists (select 1 from public.bar_events o where o.source = 'swehockey' and o.status = 'ok' and o.source_id !~ '^swh:\d+:'
                     and o.title = s.title and o.starts_at = s.starts_at)
), lg as (
  insert into public.olnu_event_fix_log (id, prev_status, reason)
  select gid_id, 'ok', '0291 swap: old game-id twin hidden' from pair
  union all select slug_id, 'hidden', '0291 swap: slug row shown' from pair
  returning 1
), h as (
  update public.bar_events b set status = 'hidden', updated_at = now() from pair where b.id = pair.gid_id and b.status = 'ok' returning 1
)
update public.bar_events b set status = 'ok', updated_at = now() from pair where b.id = pair.slug_id and b.status = 'hidden';

-- both twins visible (e.g. rows from before 0290 that are still upcoming): hide the game-id twin
insert into public.olnu_event_fix_log (id, prev_status, reason)
select g.id, 'ok', '0291: old game-id twin of a visible slug row' from public.bar_events g
 where g.source = 'swehockey' and g.status = 'ok' and g.source_id ~ '^swh:\d+:'
   and exists (select 1 from public.bar_events s where s.source = 'swehockey' and s.status = 'ok' and s.source_id !~ '^swh:\d+:'
               and s.title = g.title and s.starts_at = g.starts_at);
update public.bar_events g set status = 'hidden', updated_at = now()
 where g.source = 'swehockey' and g.status = 'ok' and g.source_id ~ '^swh:\d+:'
   and exists (select 1 from public.bar_events s where s.source = 'swehockey' and s.status = 'ok' and s.source_id !~ '^swh:\d+:'
               and s.title = g.title and s.starts_at = g.starts_at);
