-- 0036c v26 MERITER backfill: meriter for every existing user from history, so nobody starts at 0.
-- Same points and caps as the live triggers (0036), from the facts that outlive a night:
-- medal_nights (drinks per night, home), week_beers (lifetime drinks), medal_checkins (bars per night,
-- squad = a group-mate at the same bar the same night), crew_tracks / tonight's pins and check-ins
-- (squad within 150 m), after_nights (skål, home), medal_counts (skål before v16), rally_answers / rallies /
-- etas (call-outs), push_sent 'comehere', medevac_checks, status_answers, chat_photos, game_* and settled duels.
-- Rows are marked bf = true (never shown as "+N meriter" toasts) and dated at least 4 h back (no level-up push).
-- Tonight's drinks get the live refs (d1, d2, …) so the next drink continues the count.
-- The rank each user now holds is claimed in push_sent ('title:<titel>', 2100-01-01) → no false level-up push.
-- Safe to run again (unique key; on conflict nothing).
with
cur as (select public.olnu_night_of(now()) as n),
mates as (
  select distinct a.user_id as u, b.user_id as m
    from public.group_members a join public.group_members b on b.group_id = a.group_id and b.user_id <> a.user_id
),
d_night as (
  select mn.user_id, mn.night, (coalesce(mn.beers, 0) + coalesce(mn.others, 0))::int as n
    from public.medal_nights mn, cur where mn.night < cur.n
),
d_tonight as (
  select b.user_id, b.expires_at as night, (b.beer_count + coalesce(b.other_count, 0))::int as n
    from public.beers b, cur where b.expires_at = cur.n
),
d_life as (select w.user_id, sum(w.n)::int as n from public.week_beers w group by 1),
d_rest as (
  select l.user_id, l.n - coalesce((select sum(x.n) from d_night x where x.user_id = l.user_id), 0)
                       - coalesce((select sum(x.n) from d_tonight x where x.user_id = l.user_id), 0) as n
    from d_life l
),
r_drink as (
  select user_id, night, 'drink'::text as kind, 'bf'::text as ref, n as pts from d_night where n > 0
  union all
  select t.user_id, t.night, 'drink', 'd' || g::text, 1 from d_tonight t cross join lateral generate_series(1, t.n) g where t.n > 0
  union all
  select user_id, '2000-01-01 05:00+01'::timestamptz, 'drink', 'bf', n from d_rest where n > 0
),
pos as (
  select t.user_id, t.night, t.lat, t.lng from public.crew_tracks t where t.lat is not null and t.lng is not null
  union all
  select b.user_id, b.expires_at, b.lat, b.lng from public.beers b
   where (b.beer_count + coalesce(b.other_count, 0)) >= 1 and not coalesce(b.ghost, false) and not (b.lat = 0 and b.lng = 0)
  union all
  select c.user_id, c.expires_at, c.lat, c.lng from public.checkins c where not (c.lat = 0 and c.lng = 0)
),
squad as (
  select distinct a.user_id, a.night
    from public.medal_checkins a
    join mates on mates.u = a.user_id
    join public.medal_checkins b on b.user_id = mates.m and b.night = a.night and b.bar_id = a.bar_id
  union
  select distinct p.user_id, p.night
    from pos p join mates on mates.u = p.user_id
    join pos q on q.user_id = mates.m and q.night = p.night
   where abs(p.lat - q.lat) < 0.002 and public.olnu_dist_m(p.lat, p.lng, q.lat, q.lng) <= 150
),
r_squad as (select user_id, night, 'squad'::text as kind, 'bf'::text as ref, 10 as pts from squad),
r_ci as (
  select user_id, night, 'checkin'::text as kind, 'bf'::text as ref, least(count(distinct bar_id), 6)::int * 3 as pts
    from public.medal_checkins group by 1, 2
),
r_skal as (
  select user_id, night, 'skal_give'::text as kind, 'bf'::text as ref, least(coalesce(skal_given, 0), 10) as pts
    from public.after_nights where coalesce(skal_given, 0) > 0
  union all
  select user_id, night, 'skal_get', 'bf', least(coalesce(skal_got, 0), 10) from public.after_nights where coalesce(skal_got, 0) > 0
  union all
  select c.user_id, '2000-01-01 05:00+01'::timestamptz, 'skal_give', 'bf',
         c.skal_given - coalesce((select sum(a.skal_given) from public.after_nights a where a.user_id = c.user_id), 0)::int
    from public.medal_counts c
   where c.skal_given - coalesce((select sum(a.skal_given) from public.after_nights a where a.user_id = c.user_id), 0) > 0
  union all
  select c.user_id, '2000-01-01 05:00+01'::timestamptz, 'skal_get', 'bf',
         c.skal_got - coalesce((select sum(a.skal_got) from public.after_nights a where a.user_id = c.user_id), 0)::int
    from public.medal_counts c
   where c.skal_got - coalesce((select sum(a.skal_got) from public.after_nights a where a.user_id = c.user_id), 0) > 0
),
yes as (
  select ra.user_id, r.id as rally_id, r.created_at, r.lat, r.lng, public.olnu_night_of(r.created_at) as night
    from public.rally_answers ra join public.rallies r on r.id = ra.rally_id
   where ra.answer = 'yes' and ra.user_id <> r.user_id
),
r_rally as (
  select user_id, night, 'rally_yes'::text as kind, 'bf'::text as ref, least(count(*), 3)::int * 5 as pts from yes group by 1, 2
  union all
  select y.user_id, y.night, 'arrive', 'bf', least(count(*), 3)::int * 5
    from yes y
   where exists (select 1 from public.etas e where e.rally_id = y.rally_id and e.user_id = y.user_id
                   and e.arrived_at is not null and e.arrived_at <= y.created_at + interval '2 hours')
      or (y.lat is not null and exists (select 1 from public.crew_tracks t where t.user_id = y.user_id and t.kind = 'ci'
                   and t.at between y.created_at and y.created_at + interval '2 hours'
                   and public.olnu_dist_m(t.lat, t.lng, y.lat, y.lng) <= 150))
   group by 1, 2
),
callouts as (
  select r.user_id, public.olnu_night_of(r.created_at) as night
    from public.rallies r
   where (select count(*) from public.rally_answers a where a.rally_id = r.id and a.user_id <> r.user_id) >= 2
  union all
  select distinct p.user_id, public.olnu_night_of(coalesce(p.sent_at, p.night - interval '6 hours'))
    from public.push_sent p where p.kind = 'comehere'
),
r_call as (select user_id, night, 'callout'::text as kind, 'bf'::text as ref, least(count(*), 2)::int * 5 as pts from callouts group by 1, 2),
r_buddy as (select checker as user_id, night, 'buddy'::text as kind, 'bf'::text as ref, least(count(*), 2)::int * 5 as pts
              from public.medevac_checks group by 1, 2),
homes as (
  select user_id, night from public.after_nights where home_at is not null
  union
  select user_id, night from public.medal_nights where home
),
r_home as (select user_id, night, 'home'::text as kind, ''::text as ref, 5 as pts from homes),
r_status as (
  select sa.user_id, public.olnu_night_of(r.created_at) as night, 'status'::text as kind, 'bf'::text as ref,
         least(count(*), 3)::int * 5 as pts
    from public.status_answers sa join public.status_reqs r on r.id = sa.req_id
   where sa.created_at <= r.ends_at
   group by 1, 2
),
r_photo as (
  select p.user_id, public.olnu_night_of(p.created_at) as night, 'photo'::text as kind, 'bf'::text as ref,
         least(count(*), 5)::int * 2 as pts
    from public.chat_photos p
   where not exists (select 1 from public.status_answers sa where sa.photo_id = p.id)
   group by 1, 2
),
games as (
  select user_id, night from public.game_missions where done_at is not null
  union all
  select t.user_id, c.night from public.game_bingo_cards c
    join public.game_bingo_ticks t on t.group_id = c.group_id and t.night = c.night and t.ticked
   where c.bingo_at is not null
   group by t.user_id, c.night, c.group_id
  union all
  select user_id, night from public.game_oracles
),
r_game as (select user_id, night, 'game'::text as kind, 'bf'::text as ref, least(count(*), 3)::int * 3 as pts from games group by 1, 2),
allr as (
  select * from r_drink union all select * from r_squad union all select * from r_ci union all select * from r_skal
  union all select * from r_rally union all select * from r_call union all select * from r_buddy union all select * from r_home
  union all select * from r_status union all select * from r_photo union all select * from r_game
)
insert into public.meriter_log (user_id, night, kind, ref, pts, bf, created_at)
select a.user_id, a.night, a.kind, a.ref, a.pts, true,
       least(a.night - interval '6 hours', now() - interval '4 hours')
  from allr a
 where a.user_id is not null and a.pts > 0
on conflict (user_id, night, kind, ref) do nothing;

-- Settled duels (none before v26 had a winner; kept for a re-run).
do $$ begin perform public.olnu_mer_duel(d.id) from public.duels d where d.winner is not null; end $$;

-- Totals = the ledger (the insert trigger keeps them; this makes a re-run exact).
insert into public.meriter_totals as t (user_id, total, updated_at)
select l.user_id, sum(l.pts)::int, now() from public.meriter_log l group by l.user_id
on conflict (user_id) do update set total = excluded.total, updated_at = now()
 where t.total is distinct from excluded.total;

-- Quiet: the rank each user holds now is "already announced" (no level-up push for the ladder change).
insert into public.push_sent (user_id, kind, night)
select t.user_id, 'title:' || r.title, '2100-01-01T00:00:00Z'::timestamptz
  from public.meriter_totals t cross join lateral public.olnu_rank_of(t.total) r
 where r.at > 0
on conflict do nothing;
