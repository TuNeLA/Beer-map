-- 0089 Fix for 0088: history rows ('bf') hold several drinks each, so they become 5 × the night's drink count.
-- (Same counts as 0036c's backfill: medal_nights per night, week_beers for the rest.) Totals rebuilt, quiet ranks.
with
cur as (select public.olnu_night_of(now()) as n),
d_night as (
  select mn.user_id, mn.night, (coalesce(mn.beers, 0) + coalesce(mn.others, 0))::int as n
    from public.medal_nights mn, cur where mn.night < cur.n
),
d_tonight as (
  select b.user_id, (b.beer_count + coalesce(b.other_count, 0))::int as n
    from public.beers b, cur where b.expires_at = cur.n
),
d_life as (select w.user_id, sum(w.n)::int as n from public.week_beers w group by 1),
d_rest as (
  select l.user_id, l.n - coalesce((select sum(x.n) from d_night x where x.user_id = l.user_id), 0)
                       - coalesce((select sum(x.n) from d_tonight x where x.user_id = l.user_id), 0) as n
    from d_life l
),
want as (
  select user_id, night, n * 5 as pts from d_night where n > 0
  union all
  select user_id, '2000-01-01 05:00+01'::timestamptz, n * 5 from d_rest where n > 0
)
update public.meriter_log l set pts = w.pts
  from want w
 where l.kind = 'drink' and l.ref = 'bf' and l.user_id = w.user_id and l.night = w.night and l.pts <> w.pts;

update public.meriter_totals t set total = s.total, updated_at = now()
  from (select user_id, coalesce(sum(pts), 0)::int as total from public.meriter_log group by user_id) s
 where s.user_id = t.user_id and t.total is distinct from s.total;

insert into public.push_sent (user_id, kind, night)
select t.user_id, 'title:' || r.title, '2100-01-01T00:00:00Z'::timestamptz
  from public.meriter_totals t cross join lateral public.olnu_rank_of(t.total) r
 where r.at > 0
on conflict do nothing;
