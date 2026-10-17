# Öl Nu — Supabase setup notes

## Dashboard settings
- Authentication → Sign In / Providers → **Allow anonymous sign-ins: ON**. The app calls `signInAnonymously()` once per phone.
- Later (recommended): turn on CAPTCHA (Authentication → Attack Protection) and check the rate limit for anonymous sign-ins (Authentication → Rate Limits). Anonymous sign-up is otherwise open to bots.
- Optional: enable the `pg_cron` extension and run the commented job at the bottom of the migration to delete expired beers every hour.

## Database
```
supabase db push          # applies supabase/migrations/0001_olnu.sql
```
(Or paste the file into Dashboard → SQL Editor and run it.)

v3 (Skål!): run `supabase/migrations/0002_skal.sql` after `0001_olnu.sql` in the SQL Editor (safe to run again).

The file is safe to run again. It upgrades a v1 database to v2: it adds `beers.stopped` and
`beers.notified_level`, drops `beers.notified`, and drops and re-creates `post_beer`, `stop_beer`
and `live_beers`. Note: `supabase db push` runs each migration file only once. To apply the v2
changes to a project that already has v1, run the file in the SQL Editor (or add it again as a new
migration file).

v2 behaviour: 15 min cooldown per user in `post_beer`; `stop_beer` hides the pin and keeps the count
until 05:00; `notify-group` sends at most one push per level (1, 5, 10) per night.

## VAPID keys (web push)
```
npx web-push generate-vapid-keys
```
Put the public key in `docs/config.js` (`VAPID_PUBLIC_KEY`). Keep the private key secret.

## Function secrets
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are set by Supabase automatically. Set the rest:
```
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
```

## Deploy the function
```
supabase functions deploy notify-group
```
JWT verification can stay ON: the client sends the anonymous user's JWT with `supabase.functions.invoke`.

## Push v7: friend milestones + "Kaos i stan" (migration 0006)
1. Run `supabase/update-now.sql` (or `migrations/0006_push_nearby.sql`) in the SQL Editor. Safe to run again.
2. Function secrets (same as before, all three are needed):
   ```
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
   ```
   `VAPID_PUBLIC_KEY` must be the same key as in `docs/config.js`.
3. Deploy `notify-group` again (one file, `index.ts`).

Client contract:
- After `save_push_subscription`, and again when the app opens (at most about once a day), call
  `rpc('set_push_location', {p_lat, p_lng})` with the phone's position. The server rounds it to
  0.01° (about 1 km) and saves it on all of the user's subscriptions. Points outside Sweden are
  ignored. Without this call the user gets friend pushes but no "Kaos i stan" pushes.
- Call `functions.invoke('notify-group')` (fire-and-forget) after EVERY `post_beer` with
  `accepted = true`. Old clients that call it only on `milestone` keep working.
- The function sends friend pushes at beer 1, 5 and 10 (once per level per night), and a "Kaos i
  stan" push to subscribers within 10 km when ≥ 10 live beers or ≥ 3 on HOT STREAK are within
  5 km of the beer (once per subscriber per night, never to the beer's owner).
- Push payload `{title, body, url, tag}`. Friend url `/?focus=<beer id>`, tag `olnu-<beer id>-<level>`.
  Kaos url `/`, tag `olnu-kaos-<evening date>`.

Tests: `node --experimental-strip-types supabase/tests/notify-group.test.mjs`.

## v7 SOCIAL (migration 0007)
1. Run `supabase/update-now.sql` (= `migrations/0007_social.sql`) in the SQL Editor. Safe to run again.
   It has no remove-type statements (create-or-replace / if not exists / on conflict only).
   Needs Postgres 14+ (`create or replace trigger`); Supabase projects are 15+.
2. Deploy `notify-group` again (one file, `index.ts`). No new secrets.
3. New: weekly beers + lifetime titles (`week_beers`, trigger `olnu_week_beers`), Kung av baren
   (`record_bar`, `bar_kings`), group league (`group_league`), group chat (`post_group_msg`,
   `group_msgs`), reactions (`react`, `beer_reactions`), ghost pins (`ghost_points`), titles
   (`my_stats`, `friend_totals`). Edge events `comehere`, `sos`, `msg`, and the level-up push.
   Full contract: CONTRACT.md → "v7 SOCIAL".
4. Cleanup moved: `olnu_log_beer_event` no longer cleans `beer_events`; `notify-group` removes
   rows older than 10 days on 5% of calls (ghost pins show days 1–8). Old `group_msgs`,
   `reactions` and `bar_taps` rows are never shown (filtered by time / live beers). Optional
   pg_cron cleanup for them can be added later in the Dashboard.
5. Privacy: messages, kings' names and titles are only visible to group-mates. `group_league`
   hides other groups' names. Only the SOS push carries an exact location, and only to group-mates.

Tests: `node --experimental-strip-types supabase/tests/notify-group.test.mjs` (pure helpers, incl. v7).
