# Öl Nu — build contract (frontend ⇄ backend)

App: "Öl Nu" (Swedish: "beer now"). A live map of Sweden. Tap one big Beer button → a beer pin goes on the map for everyone. Groups: friends' pins get a green border, and group members get a push notification.

## Product rules
- Sweden only. Reject posts outside bbox lat 55.0–69.1, lng 10.9–24.2.
- No visible login. The client calls `supabase.auth.signInAnonymously()` once per phone (session kept in localStorage by supabase-js). No email, no stats.
- Display name lives in localStorage on the phone. It is sent to the server only when the user creates/joins a group or changes the name (stored in `group_members.display_name`, visible only to members of that group). Beer rows store NO name.
- One active beer per user. Tapping Beer again moves the pin to the new location and adds 1 to `beer_count`. Taps within 30 s of the last tap are ignored (return current row).
- Pin expires at the next 05:00 Europe/Stockholm after the tap ("end of the night").
- Precision is chosen per tap: `precise=true` → stored as given (rounded to 5 decimals). `precise=false` → snapped to grid: lat rounded to 0.005, lng rounded to 0.01 (~550 m).
- All active beers are visible to everyone (anonymous). Author identity is NOT exposed, except: if the caller shares a group with the author, `friend_name` is set.
- Notification: only on the FIRST beer of a night (beer_count = 1), once.

## Database (Postgres / Supabase, schema public)
- `beers(id bigserial pk, user_id uuid not null unique → one active row (delete expired before insert), lat float8, lng float8, precise bool, beer_count int default 1, created_at timestamptz default now(), updated_at timestamptz default now(), expires_at timestamptz, notified bool default false)`
- `groups(id uuid pk default gen_random_uuid(), name text 1–40 chars, code text unique 6 chars from 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', created_by uuid, created_at)`
- `group_members(group_id uuid → groups on delete cascade, user_id uuid, display_name text 1–30 chars, joined_at, pk(group_id,user_id))`
- `push_subscriptions(id bigserial, user_id uuid, endpoint text unique, p256dh text, auth text, created_at)`
- RLS ON for all tables, NO direct table policies for anon/authenticated. All access via the RPCs below (SECURITY DEFINER, `set search_path = public`, granted EXECUTE to `authenticated` only; revoke from public/anon). Every RPC requires `auth.uid()` not null.

## RPCs (called with `supabase.rpc(name, params)`)
| name | params | returns |
|---|---|---|
| `post_beer` | `p_lat float8, p_lng float8, p_precise bool` | json `{id, lat, lng, beer_count, is_new bool, expires_at}`; raises exception `outside_sweden` if outside bbox |
| `stop_beer` | – | void (deletes caller's beer) |
| `live_beers` | – | setof rows `(id bigint, lat float8, lng float8, beer_count int, precise bool, created_at timestamptz, is_mine bool, friend_name text)` — all beers with `expires_at > now()`; `friend_name` = author's display_name from any group shared with caller (null otherwise; null for own) |
| `create_group` | `p_name text, p_display_name text` | json `{id, name, code}` (creator becomes member) |
| `join_group` | `p_code text, p_display_name text` | json `{id, name, code}`; case-insensitive code; raises `group_not_found`; upsert membership |
| `leave_group` | `p_group_id uuid` | void; delete group if no members left |
| `my_groups` | – | setof `(id uuid, name text, code text, member_count int, active_count int)` — active_count = members with live beer |
| `set_display_name` | `p_display_name text` | void; updates all caller memberships |
| `save_push_subscription` | `p_endpoint text, p_p256dh text, p_auth text` | void; upsert on endpoint (reassign user_id) |
| `delete_push_subscription` | `p_endpoint text` | void |

## Edge Function `notify-group` (Deno, supabase/functions/notify-group/index.ts)
- Client calls `supabase.functions.invoke('notify-group')` right after `post_beer` returns `is_new = true`. Fire-and-forget; errors ignored by client.
- Function: read user from the Authorization JWT (createClient with anon key + forwarded header, `auth.getUser()`), then use service-role client. Load caller's beer: require `beer_count = 1`, `notified = false`, `created_at > now() - 5 min`; set `notified = true` first (atomic update ... returning) to avoid double send.
- Recipients: distinct users sharing ≥1 group with caller, excluding caller. Sender name per recipient = caller's display_name in a shared group.
- Push payload JSON: `{"title":"🍺 <name> dricker en öl","body":"Öppna kartan och se var","url":"/?focus=<beer id>"}`.
- Use `npm:web-push@3.6.7` with env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:). Delete subscriptions that return 404/410. Return `{sent:n}`. CORS headers for browser invoke (handle OPTIONS).

## Frontend config (docs/config.js)
```js
window.OLNU_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", VAPID_PUBLIC_KEY: "" };
```
Empty URL → COMING SOON mode (v4): real map and real bars, no beers, ÖL! button disabled with "Startar snart". No fake data anywhere.

## Deep links
- Join link / QR content: `<app origin+path>?join=CODE`. Opening it shows a join sheet (ask name if missing).
- `?focus=<id>`: pan to that beer.

## Bars layer (frontend only, added later)
- Bars/pubs/nightclubs/biergartens from OpenStreetMap (`amenity=bar|pub|nightclub|biergarten`).
- Source order: (1) `docs/bars.json` if present (array `[{id, name, lat, lng, type}]`, made by `scripts/fetch-bars.mjs` which queries Overpass for all of Sweden); (2) else Overpass API (`https://overpass-api.de/api/interpreter`) for the current map view when zoom ≥ 13, cached in localStorage per ~0.05° tile for 7 days, debounced, max 1 request in flight.
- Show bars as small glass icons at zoom ≥ 13 (hidden further out so the map stays clean).
- Crowd estimate: each live beer with `precise=true` is assigned to the nearest bar within 75 m. Bar badge shows the count ("40 🍺 nu"). Bars with beers show at every zoom ≥ 11 and float above other bars. Tapping a bar shows name, type, count, friends there (friend_name list), and "Approx — based on people who use the app".
- Done client-side (no backend change).

## v2 CHANGES (override anything above that conflicts)
Theme: beer + spec ops. Tactical HUD look. Name = "callsign" (Swedish UI: "anropssignal").

### Cooldown
- 15 minutes between beers per user (server-enforced). Replaces the 30 s rule.
- `post_beer` returns json `{accepted bool, wait_seconds int, id, lat, lng, beer_count, is_new, expires_at, milestone}`.
  - If last tap (updated_at) < 15 min ago: nothing changes, `accepted=false`, `wait_seconds` = seconds left, other fields = current row, `milestone=null`, `is_new=false`.
  - Else `accepted=true`, `wait_seconds=0`.
- `milestone` = 1, 5 or 10 when this accepted tap made beer_count exactly reach 1, 5 or 10 (null otherwise). Client calls `notify-group` when milestone is not null.

### Streak levels (frontend display, same rule everywhere)
- 1–4: normal. 5–9: HOT STREAK 🔥 (glow/fire ring on pin and on its bar badge). 10+: MEDEVAC 🚁 (big pulsing red/white pin, helicopter). Medevac popup adds a small caring line: "Drick vatten. Ta taxi hem. 🚕".

### Stop without reset
- New column `beers.stopped bool default false`. `stop_beer` sets `stopped=true` (no delete). `live_beers` hides stopped rows. `post_beer` on an active (non-expired) stopped row: sets stopped=false, counts as a normal tap (cooldown still applies, count +1). Count only resets after 05:00 expiry.
- Replace `notified bool` with `notified_level int default 0`.

### live_beers
- Unchanged shape (frontend derives streak level from beer_count). Excludes stopped and expired rows.

### notify-group
- Target level = 10 if beer_count>=10, else 5 if >=5, else 1. Atomic claim: `update beers set notified_level = target where user_id = caller and notified_level < target and stopped=false and updated_at > now()-5 min returning beer_count`. Nothing claimed → `{sent:0}`.
- Payload per level (Swedish):
  - 1: title "🍺 <name> är ute på uppdrag", body "Första ölen ikväll. Öppna kartan."
  - 5: title "🔥 <name> är på HOT STREAK", body "Öl nr 5 ikväll. Någon kör hårt!"
  - 10: title "🚁 MEDEVAC: <name>", body "Öl nr 10. Vi behöver medevac!"
  - url `/?focus=<beer id>`; tag `olnu-<user>-<level>`.

### Global ticker (frontend only)
- Top HUD ticker for ALL users from live_beers: entries for beers with beer_count>=5 ("🔥 Någon vid <bar name or 'okänd plats'> är på HOT STREAK (7)"; friends by name; medevac entries first). Also an in-app toast when a new streak/medevac appears between polls.

### Error codes the frontend must handle
`outside_sweden`, `invalid_name`, `group_not_found`, `not_authenticated`, `invalid_subscription`, `code_generation_failed`.

## v3 CHANGES (override anything above that conflicts)

### Skål! (cheers) — backend
- New table `skals(beer_id bigint → beers(id) on delete cascade, user_id uuid, created_at timestamptz default now(), pk(beer_id, user_id))`. RLS on, no policies.
- RPC `skal(p_beer_id bigint)` returns json `{skal_count int, already bool}`. Rules: caller must be authenticated; beer must be live (not expired, not stopped) else raise `beer_not_found`; caller cannot skål own beer → raise `own_beer`; one skål per caller per beer (second call returns `already=true`, count unchanged).
- Beer rows live for one night, so skåls reset with them. When post_beer makes a NEW row after expiry, old skåls go with the old row (delete cascade or the old row delete).
- `live_beers` gets two extra columns at the END: `skal_count int`, `i_skaled bool`. (Return type changes → `drop function if exists live_beers()` then recreate.)
- Shipped as `supabase/migrations/0002_skal.sql`, safe to re-run.
- No push for skåls (avoid spam). The app shows them.

### Frontend v3
- Heat glow layer (leaflet.heat) weighted by beer_count; streaks weigh more. Toggle in the map.
- "Topplista ikväll" sheet: hottest bars, hottest cities, top streaks (friends by name, others "Någon"). Tap a row → map flies there.
- Skål! button in every pin popup except own. Shows count. Own pin popup and HUD show "🍻 N skål". Toast when own skål count goes up between polls ("🍻 +2 skål!").
- Tap effects: vibration, a generated clink/pour sound (Web Audio, no files, mute toggle in settings), foam splash animation on the button, full-screen streak takeover animation at beer 5 (🔥 HOT STREAK) and 10 (🚁 MEDEVAC). Respect prefers-reduced-motion.

## COMPATIBILITY RULES (always follow)
Old and new app versions must work at the same time against one database.
- Database: changes are additive only. Never rename or remove an RPC, a parameter, or a returned field. New RPC parameters must have defaults. New returned columns go at the end. New error codes are allowed; clients show a generic message for unknown codes.
- If an RPC must change shape, make a new RPC (e.g. `live_beers_v2`) and keep the old one until no old clients remain.
- Clients: treat missing fields as empty (0 / false / null). Ignore unknown fields.
- Updates: `stamp-version.yml` gives sw.js a new cache version on every docs/ change; the app checks for updates when opened and every 10 min, and reloads once when the new version takes over (waits while you type).
- bars.json may change any time; the app must accept extra fields.

## v5 CHANGES — shots + 10 min beer cooldown (additive, old clients keep working)
- Beer cooldown is now 10 minutes (server). Clients must take the wait from `wait_seconds`; never hard-code it. Client-side restore of the countdown uses 10 min.
- New columns: `beers.shot_count int default 0`, `beers.shot_at timestamptz null`, `beers.beer_at timestamptz null` (time of last accepted beer; cooldown for beers uses coalesce(beer_at, updated_at)).
- New RPC `post_shot(p_lat float8, p_lng float8, p_precise bool)` → json `{accepted, wait_seconds, id, lat, lng, beer_count, shot_count, is_new, expires_at}`. Shot cooldown 15 min (own timer, uses shot_at). An accepted shot moves the pin (same rounding as beers), un-stops the row, and adds 1 to shot_count. If the user has no row tonight, a row is made with beer_count 0, shot_count 1. Shots do not change beer_count, streak level or milestones. No push for shots.
- `live_beers` gets `shot_count int` appended at the END (after i_skaled).
- A row with beer_count 0 and shot_count > 0 is a valid live pin ("0 🍺 · 1 🥃" → show as shots only).
- Errors: same as post_beer (`outside_sweden`, `not_authenticated`).

## v6 CHANGES — place names in the feed + heat where beers were drunk (additive)
- Feed/ticker/toasts name the spot with `BARS.describe(b)`: precise pin within 75 m of a named bar or restaurant → "vid X"; within 300 m → "nära X"; else, or for any approximate pin, the nearest town ("i Ludvika"); else "på okänd plats". Approximate pins never show a bar or restaurant name.
- `docs/places.json` = `[[name, lat, lng, t]]`, t = r (restaurant) | f (fast_food) | c (cafe). Made weekly by `scripts/fetch-places.mjs` (bars.yml). Used only for naming, never drawn. Optional: missing file → bars + towns.
- Migration `0005_heat_events.sql`: table `beer_events(kind, lat, lng, precise, n, created_at, expires_at)` with NO user_id, filled by a trigger on `beers` when beer_count or shot_count goes up. RPC `heat_points()` → setof `(lat, lng, w)` for tonight, precise events snapped to ~55 m cells. Weight: beer 1 (2 at beer 5–9, 3 at 10+), shot 0.5.
- Client: heat layer uses `heat_points` when it exists; when the RPC is missing it falls back to live pins weighted by count (old behaviour).

## v7 SOCIAL (additive; old clients keep working)
Migration `supabase/migrations/0007_social.sql` (also in `setup.sql`; `update-now.sql` = only 0007). Needs 0001–0006 first. All RPCs: authenticated only, raise `not_authenticated` without a session. "This week" = Monday 00:00 → Sunday, Europe/Stockholm. "Live beer" = not expired and not stopped. Clients must treat a missing RPC (old database) as "feature off" and hide that UI.

### Tables (RLS on, no policies, no client access)
- `week_beers(user_id, week date, n)`: filled by trigger `olnu_week_beers` on `beers` (every increase of beer_count). History starts with v7.
- `bar_taps(user_id, bar_id, week, n, bar_name, lat, lng, last_at)`, `group_msgs(id, group_id, user_id, body, created_at, expires_at)`, `reactions(beer_id, user_id, emoji, active, created_at, updated_at)`.
- `push_sent.sent_at` (new column) for edge-function rate limits.

### RPCs
| name | params | returns | errors |
|---|---|---|---|
| `record_bar` | `p_bar_id text, p_bar_name text, p_lat float8, p_lng float8` | void | none (silently ignored when rules fail) |
| `bar_kings` | `p_bar_ids text[]` (max 500 used) | setof `(bar_id text, king_name text, king_n int, is_me bool)` | – |
| `group_league` | – | setof `(group_id uuid, name text, total int, members int, rank int, is_mine bool)` | – |
| `post_group_msg` | `p_group_id uuid, p_body text` | json `{id bigint, created_at timestamptz}` | `not_member`, `invalid_msg`, `slow_down` |
| `group_msgs` | `p_group_id uuid, p_after_id bigint default 0` | setof `(id bigint, name text, body text, created_at timestamptz, is_me bool)` | `not_member` |
| `react` | `p_beer_id bigint, p_emoji text` | json `{counts: {"🔥": n, ...}, mine: ["🔥", ...]}` | `invalid_emoji`, `beer_not_found`, `own_beer` |
| `beer_reactions` | – | setof `(beer_id bigint, emoji text, n int, mine bool)` | – |
| `ghost_points` | – | setof `(lat float8, lng float8, w float8)` | – |
| `my_stats` | – | json `{total int, week int, title text, next_title text\|null, next_at int\|null}` | – |
| `friend_totals` | – | setof `(beer_id bigint, total int)` | – |

Rules:
- **Weekly beers**: each accepted beer adds 1 to the caller's row for this week.
- **Kung av baren**: call `record_bar` right after an accepted `post_beer` when the precise pin is at a bar (bars.json `id`, `name`, bar `lat/lng`). Counts only when the caller has a live **precise** beer accepted in the last 3 min within 150 m of `p_lat/p_lng`; max 1 per caller per bar per 9 min. `bar_kings`: one row per bar with check-ins this week (bars without rows = no king). King = highest `n` this week; tie → who reached it first. `king_name` = the king's display_name in a group shared with the caller (or own name when `is_me`), else null → show "En hemlig agent".
- **Grupp-mot-grupp**: `group_league` ranks all groups with ≥ 2 members by this week's sum of members' beers (`rank` 1.., unique; ties → older group first). Returns the top 10 plus all the caller's groups (≥ 2 members), ordered by rank. `name` is null for groups the caller is not in → show "Grupp #<rank>".
- **Kvittra**: body is trimmed (control chars removed), 1–140 chars, else `invalid_msg`. Max 1 message per 20 s per user (all groups) → `slow_down`. Messages expire at the next 05:00 (same as pins). `group_msgs(p_after_id = 0)` = newest 100, oldest first; `p_after_id > 0` = next ≤ 100 with `id > p_after_id`, oldest first (poll with the last id you have). `name` = sender's display_name in this group; null if the sender left → show "Någon". After `post_group_msg` succeeds, call `notify-group` with `{event:"msg", group_id}`.
- **Reaktioner**: emojis `🔥 😂 💀 💪` (exact strings). `react` toggles the caller's emoji on/off. `counts` only has emojis with n > 0 (missing = 0). Beer must be live and not own. `beer_reactions` covers all live beers (poll with `live_beers`).
- **Spökpins**: `ghost_points` = anonymous beers from 1 to 8 days ago (shots excluded), precise ones snapped to ~55 m cells, approximate ones on their ~550 m grid. `w` = number of beers in the cell. Draw faint "ghost" dots/heat.
- **Levels & titles**: lifetime beers = sum of `week_beers`. Title by lifetime total (exact strings; same list in `notify-group` `TITLES` and SQL `olnu_titles()`):

  | from | title |
  |---|---|
  | 0 | Rekryt |
  | 5 | Menig Mjöd |
  | 15 | Korpral Kork |
  | 30 | Sergeant Skum |
  | 50 | Löjtnant Lager |
  | 75 | Kapten Kapsyl |
  | 100 | Major Malt |
  | 150 | Öl-veteranen |
  | 200 | Överste Öl |
  | 300 | General Gambrinus |
  | 500 | Fältmarskalk Fatöl |
  | 750 | Bryggerilegenden |
  | 1000 | Ölguden |

  `my_stats`: `next_title`/`next_at` are null at "Ölguden". `friend_totals`: lifetime totals for live beers of the caller and of users who share a group with the caller only (strangers never returned → show no title for them). Frontend computes the title from `total` with the table above.

### Edge function `notify-group` — new body events
Call `supabase.functions.invoke('notify-group', {body})`. Old calls (no body, `home`, `pause`) work as before. Responses are `{sent, failed}` plus `reason` when nothing was sent: `no_beer`, `no_group`, `slow_down`, `bad_location`, `bad_group`, `no_msg`. HTTP errors as before (`unauthorized` 401, `server_not_configured`/`internal_error` 500).
| body | who gets it | limit | payload |
|---|---|---|---|
| `{event:"comehere", bar_name?: string, lat?, lng?}` | group-mates | 1 per 10 min per caller | title random line, e.g. "📍 {namn} vill att du kommer till {bar}!" (no bar: "📍 {namn} vill att du kommer hit"); body "Tryck för att se var."; url `/?focus=<caller's beer id>`; tag `olnu-come-<beer id>` |
| `{event:"sos", lat, lng}` | group-mates | 1 per 3 min per caller | title "🆘 {namn} behöver hjälp!", body "Tryck för att se var.", url `/?sos=<lat>,<lng>` (5 decimals), tag `olnu-sos-<ms>`, extra `sos: true`, `requireInteraction: true`. High priority. |
| `{event:"msg", group_id}` | other members of that group | 1 per sender per group per 2 min | title "💬 {namn}: {body}", body "i <group name>", url `/?chat=<group_id>`, tag `olnu-msg-<group_id>` |
- `comehere` needs a live pin (else `no_beer`). `bar_name` is used only when the pin is precise (an approximate pin never reveals a bar). `lat/lng` are accepted but not sent. Send the bar name from bars.json.
- `sos` needs `lat/lng` inside Sweden (else `bad_location`). It is the ONLY push with an exact location, and only to group-mates. It works without a pin.
- `msg` pushes the caller's newest live message in that group if it is < 5 min old (else `no_msg`).
- Service worker: show `requireInteraction` when set; open `url` on click.
- Deep links (new): `?sos=<lat>,<lng>` → fly to that point and show a red SOS marker with the sender's name from the notification if available ("🆘 Behöver hjälp här"). `?chat=<group_id>` → open that group's chat.
- **Friend pushes** (milestone 1/5): some lines now include the sender's title, e.g. "🎖️ Öl-veteranen Oskar dricker för fullo!". Level 10 lines stay caring (no title).
- **Level-up push** (automatic, in the normal after-beer call): when the caller's lifetime total reaches a new title, group-mates get "⬆️ {namn} har blivit befordrad till {titel}!" (or a variant), url `/?focus=<beer id>`, tag `olnu-title-<beer id>`. Once per title per user, ever. Response gets `levelup: n`.
- The function also cleans `beer_events` older than 10 days (5% of calls). The `beer_events` trigger no longer cleans.
