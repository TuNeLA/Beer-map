-- 0496 · OWNERFIX (owner live-beta test, 11 Nov 2026 evening). OWNER-RUN at release, AFTER 0430/0431/0436.
-- Additive: CREATE OR REPLACE of one existing function + one new function. No statement removes rows or objects.
-- CR-safe: no multi-line text literals; the last block runs olnu_strip_cr() (0436) when it is there, so a Windows
-- paste (CR LF) leaves no CR in the stored function text. Safe to run many times.
--
-- 1. show_pin()  (owner bug 21:27: "Göm min pin" must only hide the pin)
--    The app's "🙈 Göm min pin" now calls stop_beer() only (pin off the map, the count stays to 05:00, NO group
--    notice). The toast has "Visa igen" → show_pin(): the pin of tonight comes back. A ghost pin (Spökläge) stays
--    hidden. Changes only beers.stopped (no count change → no beer trigger fires a push, a medal or a log line).
-- 2. olnu_aio_price(bar, kind)  (owner 11 Nov: price outliers)
--    Same input and answer keys as 0120 (+ "all"). From the newest report of the last 7 users (120 days):
--    with >= 3 reports, a report above 2 x or below 0.5 x the median of the OTHER reports is not used.
--    n = the reports used (the app shows "1 rapport" when n = 1), all = the reports looked at.

create or replace function public.show_pin()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_n int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.beers b set stopped = false
   where b.user_id = v_uid and b.expires_at > now() and b.stopped and not coalesce(b.ghost, false)
     and (coalesce(b.beer_count, 0) >= 1 or coalesce(b.other_count, 0) >= 1);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'shown', v_n > 0);
end; $$;

create or replace function public.olnu_aio_price(p_bar_id text, p_kind text)
returns jsonb language sql stable security definer set search_path = public as $$
  with per_user as (
    select distinct on (p.user_id) p.id, p.kr, p.updated_at
      from public.bar_prices p
     where p.bar_id = p_bar_id and p.kind = p_kind and p.updated_at > now() - interval '120 days'
     order by p.user_id, p.updated_at desc
  ), recent as (select * from per_user order by updated_at desc limit 7),
  judged as (
    select r.kr, r.updated_at,
           (select count(*) from recent) as total,
           (select percentile_cont(0.5) within group (order by o.kr) from recent o where o.id <> r.id) as med_others
      from recent r
  ), kept as (
    select j.kr, j.updated_at, j.total from judged j
     where j.total < 3 or j.med_others is null or (j.kr <= 2 * j.med_others and j.kr >= 0.5 * j.med_others)
  ), used as (
    select kr, updated_at, total from kept
    union all
    select kr, updated_at, total from judged where not exists (select 1 from kept)   -- never no price at all
  )
  select case when count(*) = 0 then null else
    jsonb_build_object('kr', round(percentile_cont(0.5) within group (order by kr))::int, 'n', count(*), 'at', max(updated_at), 'all', max(total)) end
    from used;
$$;

do $g$
begin
  execute 'revoke all on function public.show_pin() from public';
  execute 'revoke all on function public.olnu_aio_price(text, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.show_pin() from anon';
    execute 'revoke all on function public.olnu_aio_price(text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.show_pin() to authenticated';
    execute 'revoke all on function public.olnu_aio_price(text, text) from authenticated';
  end if;
end $g$;

-- CR-safe (0436): a CR LF paste leaves no CR in the stored text of the functions above.
do $cr$ begin
  if to_regproc('public.olnu_strip_cr') is not null then perform public.olnu_strip_cr(); end if;
end $cr$;
