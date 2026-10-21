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

## v8 OTHER DRINKS + GROUP STATUS (additive)
- `post_other(p_kind text, p_lat, p_lng, p_precise)` → json `{accepted, wait_seconds, id, beer_count, other_count, other_kind, expires_at}`. p_kind ∈ rom, vin, cider, drink, shot, whisky, annat. 10 min cooldown between other drinks (own timer). Moves the pin. Never counts as beer (no streak, title, milestone, week_beers). Errors: outside_sweden, invalid_kind.
- `live_others()` → setof `(beer_id bigint, other_count int, other_kind text)` for live rows with other drinks. Join with live_beers by id. A live_beers row with beer_count 0 and other_count > 0 is a valid pin (show "🥃 1 rom").
- `group_status(p_group_id uuid)` → setof `(name, beers, others, other_kind, live, total, is_me)` — all members, tonight's counts (0 if none), live = pin visible, total = lifetime beers. Error: not_member.

## v9 INKALLELSE (rally / call-out; additive)
A group member calls friends to come ("🪖 Behöver män till skyttegraven! Ses på Pitchers", "hemma hos mig"). Members answer yes / no / maybe. Everyone in the group sees "7 på väg". Migration `supabase/migrations/0009_rally.sql` (also in `setup.sql`; `update-now.sql` = only 0009). Needs 0001–0008 first. All RPCs: authenticated only, `not_authenticated` without a session. A missing RPC (old database) = feature off, hide the UI.

### Tables (RLS on, no policies, no client access)
- `rallies(id bigserial, group_id uuid, user_id uuid, body text 1–100, place text ≤ 60 null, lat float8 null, lng float8 null, created_at, expires_at = next 05:00 Europe/Stockholm, closed bool default false)`
- `rally_answers(rally_id bigint, user_id uuid, answer 'yes'|'no'|'maybe', updated_at, notified bool default false, pk(rally_id, user_id))`
- "Live rally" = `expires_at > now()` and not `closed`.

### RPCs
| name | params | returns | errors |
|---|---|---|---|
| `create_rally` | `p_group_id uuid, p_body text, p_place text default null, p_lat float8 default null, p_lng float8 default null` | json `{id bigint}` | `not_member`, `invalid_msg`, `slow_down` |
| `answer_rally` | `p_rally_id bigint, p_answer text` | json `{yes int, no int, maybe int, mine text}` | `invalid_answer`, `rally_not_found`, `not_member` |
| `close_rally` | `p_rally_id bigint` | void | `rally_not_found` |
| `group_rallies` | `p_group_id uuid` | setof `(id bigint, name text, body text, place text, lat float8, lng float8, created_at timestamptz, yes int, no int, maybe int, my_answer text, yes_names text[], is_mine bool)` | `not_member` |
| `my_rallies` | – | setof: the same columns as `group_rallies`, then `group_id uuid, group_name text` | – |

Rules:
- **create_rally**: caller must be a member of the group. Body and place are trimmed (control chars → space). Empty body → `"Behöver förstärkning!"`. Body > 100 or place > 60 chars → `invalid_msg`. Empty place → null. `p_lat/p_lng` are optional: kept (rounded to 5 decimals) only when BOTH are given and inside the Sweden bbox, else silently ignored (no error). Max 1 new rally per 3 min per user, all groups → `slow_down`. The creator is answered `yes` automatically. Any older open rally by the same user in the same group is closed. After success, call `notify-group` with `{event:"rally", rally_id: id}`.
- **answer_rally**: rally must be live (else `rally_not_found`, also for unknown ids). Caller must be a member of the rally's group (else `not_member`). `p_answer` is trimmed and lower-cased; not yes/no/maybe → `invalid_answer` (checked first). Upsert: the caller can change the answer any time; the creator can too. Counts = current members only. When `mine` = `"yes"`, call `notify-group` with `{event:"rally_yes", rally_id}` (the server sends at most once per member per rally, so calling again is harmless).
- **close_rally**: creator only (else `rally_not_found`). Closing twice is fine. Closed rallies disappear from both lists.
- **group_rallies / my_rallies**: live rallies only, newest first (`created_at` desc), max 10. `my_rallies` covers all the caller's groups (for a HUD banner). Never returns rallies of groups the caller is not in. `name` = creator's display_name in that group (null if the creator left → show "Någon"). `yes/no/maybe` and `yes_names` count current members only. `yes_names` = display names of members who answered yes, creator first, then by time of last answer. `my_answer` = caller's answer or null. `is_mine` = caller created it. `lat/lng` may be null (no map point; show `place` or nothing).
- UI text: "{yes} på väg" (e.g. "7 på väg").

### Edge function `notify-group` — new body events
Old events work as before. Responses `{sent, failed}` plus `reason` when nothing was sent. New reasons: `no_rally`, `already_sent`, `no_answer` (plus `no_group`).
| body | who gets it | limit | payload |
|---|---|---|---|
| `{event:"rally", rally_id}` | members of the rally's group only (not the caller, not other groups) | once per rally (`push_sent` kind `rally:<id>`, night = rally `expires_at`) | title random line, e.g. "🪖 {namn}: {body}", "📯 {namn} blåser till samling! {body}", "🚨 Förstärkning behövs! {namn} kallar"; body `"📍 <place> · Svara i appen"` or `"Svara i appen"` (no place); url `/?rally=<id>`; tag `olnu-rally-<id>`; `rally_id: <id>`; `actions: [{action:"yes", title:"✅ Jag kommer"}, {action:"no", title:"❌ Kan inte"}]` |
| `{event:"rally_yes", rally_id}` | the rally creator only (never the caller) | once per member per rally (atomic `rally_answers.notified` claim; yes → no → yes does not push again) | title random line, e.g. "✅ {namn} är på väg! {yes} på väg nu", "🪖 {namn} har anslutit till skyttegraven! {yes} på väg", "🏃 {namn} springer mot dig. {yes} på väg."; body "Tryck för att se vilka som kommer."; url `/?rally=<id>`; tag `olnu-rally-<id>-yes` (one stacked notification per rally); `rally_id: <id>` |
- `rally`: caller must be the creator, the rally live and created < 5 min ago (else `no_rally`). Caller no longer in the group → `no_group`. Second call → `already_sent`.
- `rally_yes`: rally live (else `no_rally`); caller and creator must both still be members (else `no_group`); caller's answer must be `yes` and not yet notified (else `no_answer`). `{yes}` = current members who answered yes, creator included.
- `rally_id` may be a number or a digit string.
- **Service worker**: show `actions` when present. On `notificationclick` with `event.action` = `"yes"` or `"no"` (and a `rally_id` / rally url), open `/?rally=<id>&answer=yes|no`; plain click opens `url`.

### Deep link
- `?rally=<id>[&answer=yes|no|maybe]`: open the group's rally view and show that rally (look it up in `my_rallies`; not found → toast "Inkallelsen är över"). With `answer`, call `answer_rally(id, answer)` once (then `notify-group {event:"rally_yes"}` when the answer is yes) and remove `answer` from the URL so a reload does not answer again.

## v10 CHECKA IN (additive)
Tap a bar on the map → "📍 Checka in". Group-mates get "📍 Anton har anlänt till La Parma". Migration `supabase/migrations/0011_checkin.sql` (also in `setup.sql`). Needs 0001–0010 first. A missing RPC (old database) = feature off: hide the button, no error.

### Table (RLS on, no policies, no client access)
- `checkins(user_id uuid pk, bar_id text 1–80, bar_name text 1–60, lat float8, lng float8, created_at, expires_at = next 05:00 Europe/Stockholm)`. One row per user (a new check-in replaces the old one, upsert). Old rows are never removed; every read filters `expires_at > now()`.

### RPCs
| name | params | returns | errors |
|---|---|---|---|
| `check_in` | `p_bar_id text, p_bar_name text, p_lat float8, p_lng float8` | jsonb `{ok bool, bar_name text, wait_seconds int}` | `outside_sweden`, `invalid_bar`, `not_authenticated` |
| `live_checkins` | – | setof `(bar_id text, bar_name text, lat float8, lng float8, name text, is_mine bool, is_friend bool, created_at timestamptz)` | `not_authenticated` |
- `check_in`: lat/lng inside the Sweden bbox (else `outside_sweden`); bar name control chars → space, trimmed, 1–60 chars, bar id 1–80 (else `invalid_bar`). Rate limit: 1 per 2 min per user → `ok=false`, `wait_seconds` > 0, `bar_name` = current check-in, nothing changes. Stored lat/lng rounded to 5 decimals.
- `live_checkins`: tonight's live rows, oldest first, max 2000. `name` = own display_name (any group; null without a group — the app shows its local name) for `is_mine`, the user's display_name in a shared group for `is_friend`, else null (strangers are anonymous). Same rule as `live_beers.friend_name`.
- Spökläge (ghost mode): the client does NOT call `check_in` (toast only).

### Edge function `notify-group` — new body event
| body | who gets it | limit | payload |
|---|---|---|---|
| `{event:"checkin", bar?}` | group-mates | 1 per 10 min per caller (`push_sent` kind `checkin`) | title random line (25), e.g. "📍 {namn} har anlänt till {bar}"; body random short line; url `/`; tag `olnu-checkin-<ms>` |
- Needs a live check-in made < 5 min ago (else reason `no_checkin`). The bar name comes from the `checkins` row, not from the body. Other reasons: `no_group`, `slow_down`.

### Frontend
- Every bar popup (with or without beers): "📍 Incheckade här: Anton, Oskar + 2 till" (strangers only as a count) and a big "📍 Checka in" button (LIVE + signed in). Asks for a name first if none. After success: funny toast, clink + vibrate, then `notify-group {event:"checkin", bar}`. Own check-in is kept in localStorage `olnu.checkin` (until 05:00) and shown as a small HUD chip "📍 <bar>" (tap = fly there).
- `live_checkins` is fetched in the same 30 s poll as `live_beers`.
- ÖL! tap: a fresh own check-in (< 3 h) within 150 m of the GPS position → the beer goes on that bar, no "Var dricker du?" question.
- Ticker (`news.js`): `ctx.checkins`; kinds `checkin` (friend, last 45 min, imp 2), `meCheckin` (imp 1), `checkinCrowd` (bar with 2+ check-ins, imp 1), `friendBeer` (friends with n ≥ 1, imp 0). Swedish templates from `js/news-more.js` (`window.NEWS_MORE.sv`) are merged in; fallbacks in `i18n.js`.

## v11 CROWD LIST + FLYTTKOD (frontend only; no server change)
### Crowded spots
- Clusters never spiderfy and never switch off (no `disableClusteringAtZoom`). `maxClusterRadius` = 130 px at zoom ≥ 13 (a pill + name label is ~90–130 px wide), else 80.
- Cluster tap (`zoomToBoundsOnClick:false`, own `clusterclick`): if the pins span ≤ 120 m, or zoom ≥ 17, or zooming would not split them → bottom sheet "🍺 N dricker här" (+ "📍 vid X" via `BARS.describe`; approximate pins only name the town). Else zoom to the cluster bounds.
- Sheet rows: me first, then friends, then beer_count desc. Row = name (`whoOf`), "sedan HH:MM", beers + level + other drinks, Skål button (same `doSkal`; own row shows "🍻 N skål"). Tap a name → fly to the pin and open its popup (a popup on the pin's spot when it is still clustered).
- Bar popup with more than 8 people: "👥 Visa alla (N)" opens the same sheet.

### Flyttkod (move the account to the home-screen app / another phone)
- Code = base64url(JSON `{v:1, rt, u, name, ls}`): `rt` = current refresh token from localStorage `olnu.auth`, `u` = user id, `ls` = whitelisted `olnu.*` keys (lang, prec, intro, locOk, night, checkin, title, badges, ghostMode, mute, heat, …; big ones dropped to keep the code ≤ 900 chars). Not moved: auth, bar caches, push state, "already asked" flags. The code is a login credential: never logged, never sent anywhere.
- Import (before anonymous sign-in): `?flytt=<code>` / `#flytt=<code>`, or pasted (code or whole link). `auth.refreshSession({refresh_token})`; on failure the old session is put back and the app signs in as normal with a toast. Success → write keys, reload once (toast "✅ Kontot är flyttat"). A code whose `u` is already the current user, or that was tried before in this browser (`olnu.flyttUsed` = short hashes), is ignored (an iOS start URL may keep `?flytt=`).
- Export: the source never uses that session again (refresh tokens rotate; reuse can revoke the session). It removes `olnu.auth` WITHOUT signOut, stops auto refresh, sets `olnu.moved` (+ `olnu.movedTo`, `olnu.movedU`) and shows a full-screen notice with "Fortsätt här ändå" (= new anonymous account).
  - Settings "📲 Flytta till annan app / telefon": warning + confirm → push unsubscribed, logged out at once, sheet with QR + "Kopiera länk".
  - iOS Safari install guide: step 1 "📋 Förbered flytt" → `?flytt=` in the URL (replaceState) + link on the clipboard; `olnu.flyttPending`. The move finishes when the page comes back after ≥ 10 s hidden, on next load, when the server rejects the token (401), or before the access token expires.
  - In-app browser help: "📋 Kopiera flyttlänk" (same pending flow).
- Standalone first start with no session and no code: "Har du använt Öl Nu i Safari/webbläsaren förut?" → "📋 Klistra in flyttkod" (clipboard, text field fallback) / "Nej, börja nytt" (`olnu.flyttAsked`). Settings also has "📥 Jag har en flyttkod".

## v11 MEDALS & RANKS (additive)
Migration `supabase/migrations/0012_medals.sql` (also in `setup.sql`). Needs 0001–0011 first. A missing RPC (old database) = feature off: the app falls back to the old local badges sheet, no error.

### Ranks (36 steps)
**Superseded by v26 MERITER (0036): ranks are earned by meriter, 42 steps — see "v26 MERITER" at the end.**
Lifetime beers → title. `olnu_titles()` (SQL), `TITLES` in `notify-group` and `docs/js/social.js` are identical (same function names and return types as v7; `my_stats` unchanged). v25 (0035, 2026-10-20): titles with place names were renamed (same thresholds and order); the table below is the current list:

| from | title | from | title | from | title |
|---|---|---|---|---|---|
| 0 | Rekryt | 52 | Premiärlöjtnant Pilsner | 330 | Riksmarskalk Rundtur |
| 3 | Mönstrad Mellanöl | 62 | Kapten Kaggen | 380 | Baron av Bryggstugan |
| 5 | Menig Mjöd | 75 | Ryttmästare Humle | 430 | Hertig av Humlefältet |
| 7 | Vicekorpral Kapsyl | 90 | Major Mäsk | 490 | Ärkehertig av Ölkranen |
| 10 | Korpral Korkskruv | 110 | Överstelöjtnant Ölstop | 560 | Kung Kapsyl den Store |
| 13 | Skumsergeant | 130 | Överste Ölkorv | 640 | Ölkejsaren |
| 17 | Furir Flaskhals | 155 | Brigadgeneral Bärs | 730 | Bryggerilegenden |
| 22 | Överfurir Fatkran | 180 | Generalmajor Gambrinus | 830 | Halvguden vid Jäskaret |
| 28 | Fanjunkare Flasköppnare | 210 | Generallöjtnant Guldskum | 920 | Myten i Mässen |
| 35 | Fänrik Fatöl | 245 | General Gyllenbärs | 1000 | Legenden vid Långbordet |
| 43 | Löjtnant Lager | 285 | Fältmarskalk Fradga | 1100 | Sagofiguren i Skyttegraven |
| | | | | 1200 | Oraklet i Ölstugan |
| | | | | 1300 | Överbefälhavare Öl |
| | | | | 1500 | Ölguden |

- `notify-group` level-up push: only when the rank was reached just now (`total - rank_start <= 1`), so the ladder change itself sends no pushes. Still once per title per user ever.
- Client: a real promotion (lifetime total went up and the title changed) shows the BEFORDRAN popup (old ➜ new rank, random RPG-style line from 44, never one of the last 10, sound + vibration). A title that changed only because of the new ladder shows one quiet toast ("Armén har fått nya grader!").

### Tables (RLS on, no policies, no client access)
- `user_medals(user_id, medal text, earned_at, count int, updated_at)`, pk (user_id, medal). Never taken back; `count` never goes down.
- Fact logs (filled by triggers, because beers/checkins/skals rows only live one night): `medal_nights(user_id, night, beers, others, first_at, early, owl, home, cell)` (`cell` = ~50 km region, never a precise place), `medal_checkins(user_id, bar_id, night)` (from `checkins` and `bar_taps`), `medal_counts(user_id, skal_given, skal_got, msgs)`, `medal_claims(user_id, medal, night)`. Every trigger catches its own errors: a medal bug can never block a beer, check-in, skål or chat message.

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `award_medals` | `p_event text default null` | setof `(medal text, count int, is_new bool, earned_at timestamptz)` — only medals that are new or whose count went up in this call | – |
| `claim_medal` | `p_medal text` | same as `award_medals` | `invalid_medal` |
| `my_medals` | – | setof `(medal text, earned_at timestamptz, count int)` | – |
| `member_medals` | `p_group_id uuid` | setof `(name text, is_me bool, medal text, earned_at timestamptz, count int)` for all members of that group | `not_member` |
- `award_medals` evaluates every rule from server data and stores the result. `p_event = 'home'` marks tonight as "came home" (only when the caller has a beer row tonight). The client calls it after an accepted beer, after "Jag är hemma" (`'home'`), after chat/skål/rally taps, on a new check-in, when the app opens, and every 5 min while open.
- `claim_medal` whitelist (low stakes, the server cannot see them): `vatten` (tapped "💧 Druckit vatten" / "💧 Jag tar vatten"; once per night), `spoke` (beer in ghost mode; once per night), and once-only migration of old local badges: `dagsljus`, `uggla`, `sidospar`, `hemvarn`, `radio`, `krogrunda`.

### Medals (ids are stable; names and texts live in `docs/js/medals.js`)
No medal rewards drinking fast or many beers in a short time. Stacking medals show "×N".
- Lifetime beers: `m1` Första kapsylen, `m10` Tian, `m50` Femtiolappen, `m100` Hundringen, `m250` Kvartstusen, `m500` Halvtusen, `m1000` Tusenåringen.
- Nights out: `n5` Nattpatrull, `n25` Nattveteran, `n100` Hundra nätter.
- Bars (distinct, check-ins + king taps): `b5` Krogturist, `b15` Kartläsare, `b40` Krogkartograf; `krogrunda` (3 bars one night, stacks), `stammis` (same bar 5 nights, stacks per bar).
- Skål: `sg10`/`sg100` given (Skålbroder, Skålkanonen), `sr10`/`sr100` received (Folkkär, Skålmagneten).
- Rally: `inryckt` (said yes once), `alltid` Alltid redo (yes 10 times), `trumslag` Trumslagaren (sent a rally).
- Home: `hemvarn` Hemvärnet (nights with "Jag är hemma", stacks), `komhem` Kom hem säkert (per 5 such nights).
- Time: `dagsljus` (beer 05–16), `uggla` Nattugglan (beer 01–05), `tisdag` Tisdagstörst — all stack per night.
- Group: `fortrupp` Förtruppen (first of the group out, a mate out too; stacks), `kung` Barkungen (king of a bar in a week; stacks), `liga` Ligamästare (group won a finished week; stacks), `pluton` (in a group), `kompani` Kompanichef (created a group with 5+ members).
- Chat: `radio` (1 message), `signal` Signalisten (50).
- Holidays (evening date, stacks per year): `valborg` (30 Apr), `midsommar` (Friday 19–25 Jun), `lucia` (13 Dec), `nyar` (31 Dec).
- Other: `faltresa` Fältresa (beer in another ~50 km region; stacks), `sidospar` (other drink), `spoke` Spökpatrullen, `vatten` Vattenbäraren.
- "Varit med om" (hidden until earned, caring text, toast without fanfare, never a goal): `het` (a night with 5+), `medevac` (a night with 10+).

### Frontend
- `docs/js/medals.js` (`window.MEDALS`, driven through `extras.js` hooks) + `docs/medals.css`.
- **Uniform**: big rank, "Grad N/36", progress bar to the next rank, ribbon of all medals, then all medals: earned (emoji, name, ×N, funny line) and locked (grey, how to get it). "🎖️ Min uniform" = HUD rank chip / settings button. Tap a member in the group view or a name in the chat → that member's uniform (`member_medals` + `group_status.total`).
- **Group view**: medal row under each member (max 8 emojis + "+N").
- New medal → toast "🎖️ Ny medalj: … !" + clink + vibration. First run after the update: one summary toast instead of many.
- **Ta det lugnt** (client only, localStorage `olnu.beerTimes`): 3 beers within 40 min or 5 within 100 min → friendly popup with a random line (42 lines, not the last 10 again), max once per 30 min. Two lines have a "💧 Jag tar vatten" button (→ `claim_medal('vatten')`). The water toast every 3rd beer has a "💧 Druckit vatten" button too.

## OWNER STATS (owner only; additive)
Migration `supabase/migrations/0013_owner_stats.sql` (also in `setup.sql`). Needs 0001–0012.
- Page `docs/stats.html`: self-contained, NOT linked from the app, NOT in `sw.js`. Key from `#k=<key>` (removed from the address bar at once) or a password field; kept in `sessionStorage` (`olnu.ownerKey`) only. Refreshes every 60 s while visible.
- Tables (RLS on, no policies, no client access): `owner_keys(key_hash, created_at)` (SHA-256 hex of the key; the plain key is never stored in the DB or the repo), `owner_key_fails(at)`, `owner_hours(hour, beers)` (beers per hour, filled by trigger `olnu_owner_hours` on `beer_events`; no user id, no place).
- RPC `owner_stats(p_key text)` → one jsonb `{generated_at, night_ends, users, beers, places, social, care, tech}`. Aggregates only: no names (except bar names), no exact locations, no user ids. SECURITY DEFINER, EXECUTE for `anon` + `authenticated`.
  - Wrong key: logs a row in `owner_key_fails` and answers HTTP 403 `{"code":"PT403","message":"forbidden"}` (supabase-js: `error.message = "forbidden"`). Not a raise, so the log row is kept.
  - More than 20 fails in the last hour → raise `rate_limited` (for every key).
- Night = the 05:00 Europe/Stockholm boundary (`olnu_next_expiry`). History comes from `medal_nights` / `medal_checkins` (0012), `beer_events` (~10 days), `week_beers`, `owner_hours`. Skål, reactions and chat rows go away with the night, so the 7 d numbers for them are a lower bound.
- New key: `insert into public.owner_keys (key_hash) values (encode(extensions.digest('<key>', 'sha256'), 'hex'));` (run in the SQL editor; never commit the key).

## v12 KROGARNA (omgång 1; additive)
Migration `supabase/migrations/0014_bars_plus.sql` (also in `setup.sql`). Needs 0001–0013. Client module `docs/js/barsplus.js` (`window.BARSPLUS`, called through `mods()`) + `docs/barsplus.css`. A missing RPC (old database) = feature off: no v12 UI at all (the client checks `bar_status` first), no error.

### Tables (RLS on, no policies, no client access; rows are never removed, every read filters on time)
- `bar_queue(id, bar_id, user_id, queue 'none'|'short'|'long', entry null|'free'|'low'|'high', bar_lat, bar_lng, created_at, expires_at = now()+30 min)`
- `bar_offers(id, bar_id, bar_name, user_id, body 1–60, bar_lat, bar_lng, created_at, expires_at = next 05:00)`, `bar_offer_votes(offer_id, user_id, vote -1|0|1, updated_at)`
- `beer_types(user_id, night, n, type, lat, lng (rounded 0.01), created_at, updated_at)`, pk (user_id, night, n). Types: lager pilsner ipa apa stout vete ale sour alkfri annan.
- `group_flags(group_id pk, show_on_map bool default false, updated_at, updated_by)`
- `bar_takeovers(id, group_id, bar_id, bar_name, night, n, created_at, notified)`, unique (group_id, bar_id, night)
- `bar_tips(id, user_id, group_id, bar_id, bar_name, body, msg_id, created_at, notified)`

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `report_queue` | `p_bar_id, p_bar_name, p_bar_lat, p_bar_lng, p_lat, p_lng, p_queue text, p_entry text default null` | jsonb `{ok, wait_seconds, queue, entry, reports}` | `invalid_queue`, `invalid_entry`, `invalid_bar`, `outside_sweden`, `too_far` |
| `add_offer` | `p_bar_id, p_bar_name, p_bar_lat, p_bar_lng, p_lat, p_lng, p_body` | jsonb `{ok, id, is_new}` | `invalid_offer`, `offer_blocked`, `slow_down`, `invalid_bar`, `outside_sweden`, `too_far` |
| `vote_offer` | `p_offer_id bigint, p_vote int` (1, -1, 0 = take back) | jsonb `{up, down, mine, hidden}` | `invalid_vote`, `offer_not_found`, `own_offer` |
| `bar_status` | – | setof `(bar_id, queue, queue_at, queue_n, entry, offers jsonb, owner_name, owner_n, owner_mine, owner_named)` | – |
| `note_takeover` | `p_bar_id text` | jsonb `{ok, is_new}` | – |
| `set_beer_type` | `p_type text` | jsonb `{ok, type, n}` | `invalid_type`, `no_beer` |
| `beer_type_stats` | `p_lat float8 default null, p_lng float8 default null` | setof `(scope 'town'/'sweden', period 'night'/'week', type, n)` | – |
| `my_group_flags` | – | setof `(group_id, show_on_map, can_edit)` | – |
| `set_group_show` | `p_group_id uuid, p_on bool` | jsonb `{show_on_map}` | `not_member`, `not_admin` |
| `send_tip` | `p_group_id uuid, p_bar_id, p_bar_name, p_body text default null` | jsonb `{ok, wait_seconds, id, msg_id}` | `not_member`, `invalid_bar`, `invalid_msg` |

Rules:
- **Kö-rapport**: caller within 300 m of the bar position (server check with p_lat/p_lng, else `too_far`). 1 report per user per bar per 10 min → `ok=false` + `wait_seconds`. A report lives 30 min. Shown queue = the answer with most live reports; tie → newest report. Same rule for `entry` (non-null reports only). UI: "🚶 Kort kö · rapporterat 12 min sen (3 rapporter)" + a coloured dot / 🚶 on the bar marker.
- **Kvällens erbjudande** — LEGAL (Alkohollagen 7 kap., Konsumentverket): user-written and passive. Shown ONLY inside the bar popup (collapsed section, header "🍻 Rapporterat erbjudande", muted line "Användarnas egna tips. Drick lagom."). NO push, NO ticker line, NO toast that appears by itself, NO marker dot, NO medal. Neutral wording only. Server: body cleaned, 3–60 chars; links, e-mails, 7+ digit numbers (phone) and a bad-word list → `offer_blocked`. Caller within 300 m. Max 2 new offers per user per night (`slow_down`). Same text twice at a bar tonight → the old id (`is_new=false`). `bar_status.offers` = max 3, best first (`up - down`, then newest): `[{id, body, up, down, my_vote, is_mine, at}]`; an offer with 3 or more 👎 than 👍 is hidden. Own offer cannot be voted (`own_offer`).
- **Ölsorter**: after an accepted ÖL! the client shows a 4 s bottom strip with type chips (pauses while touched; last choice first as "Samma igen?"). A tap calls `set_beer_type` for the caller's newest beer tonight (works in ghost mode; changing again is fine). `beer_type_stats`: anonymous counts; town = within 20 km of the given point; week = Monday 00:00 Europe/Stockholm → now. Shown as "🍺 Vad dricker stan?" in the 🏆 sheet.
- **Ta över krogen**: tonight's candidate bars = bars with live check-ins or "Kung av baren" taps tonight (they carry the bar position). A user is at ONE bar: the newest of his live check-in and his live precise beer within 75 m of a candidate bar. Owner = the group with most such members at the bar, minimum 2; tie → the group that got there first. `owner_name` = group name when the group opted in (`group_flags.show_on_map`) or the caller is a member, else null ("🏰 En grupp äger …"). Group setting "🏰 Visa vår grupp på kartan" (default off) in the group list; only the creator may change it (if the creator left: the oldest member) → `not_admin`. When `bar_status` says the caller's group owns a bar, the client calls `note_takeover` once per bar per night (localStorage `olnu.takeNoted`) and, when `is_new`, `notify-group {event:"takeover", bar_id}`. Ticker kinds `takeover` (changes, imp 2), `queueLong`, `queueNone` (via `NEWS` hooks `newsTemplates` / `newsCands`).
- **Krogtips**: `send_tip` posts "📣 <namn> tipsar: Kom till <bar>! <text>" in the group chat (counts as a chat message). Text optional, max 40, same link/phone/bad-word filter (`invalid_msg`). 1 tip per 5 min per user → `ok=false` + `wait_seconds`. Then `notify-group {event:"tip", tip_id}`.
- **Medals** (ids stable; `olnu_medal_eval_bars`, merged in `olnu_medal_store`, same return type): `kospanare` Köspanaren (5 queue reports), `sommelier` Ölsommelieren (5 different types, not "annan"), `erovrare` Erövraren (your group took over a bar after you joined; stacks per bar and night), `tipsare` Kunskapsspridaren (3 tips). No offer medal (legal).

### Edge function `notify-group` — new body events
| body | who gets it | limit | payload |
|---|---|---|---|
| `{event:"tip", tip_id}` | other members of the tip's group | the tip row must be the caller's, < 5 min old, not pushed (atomic `bar_tips.notified` claim); else reason `no_tip` | title 1 of 15 lines, e.g. "📣 {namn} tipsar: Kom till {bar}!"; body `”<text>” · Tryck för att se baren.` or "Tryck för att se baren på kartan."; url `/?bar=<bar_id>`; tag `olnu-tip-<id>` |
| `{event:"takeover", bar_id}` | other members of the caller's group that owns the bar | `bar_takeovers` row of tonight, < 10 min old, not pushed (atomic `notified` claim) → max 1 per bar per group per night; else `already_sent` | title 1 of 15 lines, e.g. "🏰 Ni har tagit över {bar}!"; body "Tryck för att se kartan. Håll krogen!"; url `/?bar=<bar_id>`; tag `olnu-takeover-<group>-<bar>` |

### Deep link
- `?bar=<bars.json id>`: fly to that bar and open its popup (waits up to ~12 s for bars to load). Removed from the URL at once.

## v13 PRIVACY & POLL (server)
Migration `supabase/migrations/0015_privacy_poll.sql` (applied on the server 2026-10-17; also appended to `setup.sql`). Needs 0001–0013 (0014 optional). Additive: no old RPC, parameter or field changed shape. All new RPCs: authenticated only, `not_authenticated` without a session. A missing RPC (old database, PGRST202) = use the old calls.

### Privacy rules (server-enforced, also in the old `live_beers`)
- **Known** = the caller's own pin and pins of users who share a group with the caller. Known pins: exact `lat/lng`, numeric stable `id`, exact `created_at`, `friend_name`.
- **Stranger** pins:
  - precise pin within 75 m of an active bar in `bars_lite` → shown ON the bar point (`snap:"bar"`, `bar_id` set, `precise:true`);
  - other precise pin → the ~550 m grid point (lat rounded to 0.005, lng to 0.01; `snap:"area"`, `precise:false`);
  - "Bara område" pin → its own grid point (`snap:"area"`).
  - `created_at` floored to 15 min. In `poll_v2` the `id` is an opaque string `"p" + 15 hex` that changes every 10 min (`ids_until`). The old `live_beers` keeps numeric ids (old apps need them), but its positions/precise/created_at follow the rules above.
- The box filter uses the SHOWN position, so a tiny box cannot locate a stranger more exactly than the snap.
- `bars_lite(id, name, lat, lng, type, active)` = docs/bars.json + bars-extra.json (Sweden only; bars-closed.json → `active=false`). 1217 rows imported. After a bars.json refresh, re-import (upsert on id) and run `select public.olnu_resnap();` (re-snaps live pins and recent heat rows). Bars that only come from Overpass are unknown to the server → those strangers show as `area`.
- **Heat** (`heat_points`, `poll_v2.heat`, `ghost_points`): precise beer within 75 m of a bar → bar point; other precise beer → ~55 m cell; a ~55 m cell with fewer than 3 beers → its ~550 m grid point; "Bara område" → grid. Undone beers and ghost beers never appear. (Old 0010 ~10 m cells are gone.)

### RPCs
| name | params | returns | errors |
|---|---|---|---|
| `poll_v2` | `p_min_lat, p_min_lng, p_max_lat, p_max_lng float8, p_since timestamptz default null, p_heat bool default false` | json (below) | `invalid_bbox` (any null/NaN/Infinity) |
| `post_beer_v2` | `p_lat, p_lng float8, p_precise bool, p_hidden bool default false` | jsonb = `post_beer` fields + `hidden bool, undo_until timestamptz\|null, undos_left int` | `outside_sweden` |
| `undo_beer` | – | jsonb `{ok, beer_count, reason, undos_left, lat?, lng?, hidden?}` | – (refusals are `ok:false`) |
| `skal_v2` | `p_pin text` | json `{skal_count, already}` (same as `skal`) | `beer_not_found`, `own_beer` |
| `react_v2` | `p_pin text, p_emoji text` | json `{counts, mine}` (same as `react`) | `invalid_emoji`, `beer_not_found`, `own_beer` |

### poll_v2 → one json per poll (replaces live_beers + live_others + live_checkins + beer_reactions + friend_totals + my_rallies + heat_points + my_stats)
```
{ v:1, server_time, full:true, ids_until,          // stranger ids change at ids_until (10-min steps)
  bbox:[minLat,minLng,maxLat,maxLng],               // the box used: yours + 15 % margin (≥ 0.005°/0.01°), clamped to Sweden
  pins:[ { id,                                       // number (me / group-mate) or "p…" string (stranger) — treat as an opaque key: String(id)
           lat, lng, snap:"exact"|"area"|"bar", bar_id?, precise?, beer_count,
           other_count?, other_kind?, created_at,
           is_mine?, is_friend?, friend_name?,       // friend_name = shared-group display name
           skal_count?, i_skaled?, rx?:{"🔥":n,…}, my_rx?:["🔥",…],
           total? } ],                               // lifetime beers, me / group-mates only
  capped:bool, pins_in_view:int,                     // strangers in the box; max 1500 returned, nearest the box centre first
  live_total:int,                                    // all live visible pins in Sweden ("N dricker i Sverige")
  me:{ id?, beer_count, other_count, other_kind, lat, lng, precise, hidden, ghost, expires_at, beer_at,
       wait_seconds, undo_until|null, undos_left, total, week, title, next_title, next_at },
  checkins:[ {bar_id, bar_name, lat, lng, name, is_mine, is_friend, created_at} ],  // mine + group-mates anywhere, others in the box; stranger created_at floored to 15 min
  rallies:[ …same rows as my_rallies… ],
  heat: null | [[lat,lng,w],…] }                     // only when p_heat=true; box + 50 %, max 3000 cells
```
- Fields that are null / false / 0 / empty are LEFT OUT of `pins` rows (compat rule: missing = empty). Own pin and group-mates are always included, also outside the box. Ghost (hidden) pins are never in `pins`; the owner sees the state in `me.hidden/me.ghost`.
- Pins only exist when `beer_count ≥ 1` or `other_count ≥ 1` and not stopped.
- `p_since` is accepted but ignored in this version (`full:true` = always the full view).

### post_beer_v2 (Spökläge on the server)
- `p_hidden=false` → exactly `post_beer` (+ the 3 new fields).
- `p_hidden=true` → the beer counts (cooldown, beer_count, milestone, week_beers, medal_nights/medals, titles, owner stats) but the pin is hidden at once (`stopped`, `ghost=true`), stored on the ~550 m grid only, and NO heat point is written. A later visible beer shows the pin again. `p_precise` is ignored when hidden.
- `undo_until` = `beer_at + 2 min` when accepted, else null.

### undo_beer
- Takes back the caller's latest beer if it was accepted < 2 min ago (`beer_at`). Max 3 undos per night (per pin row).
- `reason` when `ok:false`: `no_beer` (no beer tonight), `too_late` (≥ 2 min, or already undone), `limit` (3 used). Nothing changes then.
- On success: `beer_count - 1`; `beer_at` back to the previous beer (so the 10 min cooldown is the old one; after undoing the first beer of the night there is no cooldown); position/precision/visibility/ghost back to before that beer (not if another drink moved the pin after it); first beer of the night undone → pin hidden (unless it has other drinks); its heat point flagged undone; week total, tonight's medal-night count, owner hour count and a "Kung av baren" tap made after the beer go down by 1. Earned medals are never taken back. Skåls/reactions on the pin stay.
- Old `post_beer` also feeds undo (a trigger stores the previous state), so undo works after either post RPC.

### skal_v2 / react_v2
- `p_pin` = the `id` from `poll_v2` as a string: numeric ids work only for the caller's own pin and group-mates (`own_beer` for own); `"p…"` ids work for the current and the previous 10-min step, else `beer_not_found` (re-poll and retry once).

### Client must
1. Poll with `poll_v2(view bounds, null, heatOn)` instead of the 6 RPCs; fall back to the old calls when it is missing. Ask heat at most every 60 s (send `p_heat=false` in between and keep the last heat).
2. Key pins by `String(id)`. Stranger ids rotate every 10 min: do not fire "new streak"/"new pin" toasts just because an id changed — compare by (`bar_id` or lat/lng) + `beer_count`, or skip such toasts for strangers.
3. Use `skal_v2` / `react_v2` with `String(pin.id)`; on `beer_not_found` re-poll once.
4. Count people per bar with `bar_id` (server-computed for every precise pin, 75 m); stranger pins sit exactly on the bar point. Pins with `snap:"area"` never belong to a bar.
5. Spökläge: call `post_beer_v2(..., p_hidden:true)` — do NOT call `stop_beer` after it, do not call `notify-group` or `record_bar`.
6. Undo: after an accepted beer show "ÅNGRA" until `undo_until`; call `undo_beer()`, then re-poll. Call `notify-group` only after the undo window has passed (or the toast closed without undo), so an undone milestone sends no push.
7. Header count from `live_total`; HUD/cooldown from `me` (`wait_seconds`, `undo_until`, `undos_left`, `hidden`, `ghost`, title fields).
8. DST: the server 05:00 logic (`olnu_next_expiry`, `olnu_night_of`) is DST-correct (tested 2026-10-24/25 and 2027-03-27/28). The client should use `expires_at` from the server instead of computing 05:00 itself (`U.next5am` is wrong across DST, review P3-1).

## v16 EFTERÅT (omgång 3: efteråt, socialt och krogar; additive)
Migration `supabase/migrations/0018_after.sql` (applied on the server 2026-10-17; also appended to `setup.sql`). Needs 0001–0015 (0014 optional). Client: `docs/js/after.js` (`window.AFTER`, called through `mods()`), `docs/js/after-content.js` (`window.AFTER_CONTENT`, texts), `docs/after.css`, `docs/qr.html`. A missing RPC (old database) = that feature hides, no error. All RPCs: authenticated only, `not_authenticated` without a session.

### Tables (RLS on, no policies, no client access; rows are never removed, reads filter on time)
- `olnu_towns(name pk, lat, lng)` — 80 towns (Dalarna + all larger towns). `olnu_town_of(lat,lng)` = nearest within ~30 km.
- `after_nights(user_id, night, town, out, checkins, skal_given, skal_got, home_at)` pk (user_id, night). Filled by triggers on `beers` (drink count up → `out`, town of the first pin), `checkins` (+1 per new check-in) and `skals` (given / got). Only a TOWN name is stored, never a place. History starts with v16.
- `medevac_checks(id, target, night, checker, created_at, notified)` unique (target, night).
- `voice_msgs(id, group_id, user_id, mime, dur_ms, audio bytea ≤ 60 KB, created_at, expires_at = next 05:00, notified)`.

### RPCs
| name | params | returns | errors |
|---|---|---|---|
| `mark_home` | – | jsonb `{ok, home_at}` / `{ok:false, reason:"no_night"}` | – |
| `home_status` | `p_last bool default false` | setof `(group_id, group_name, name, is_me, beers, others, was_out, home, home_at, live, night)` — every member of every caller group, tonight (or last night) | – |
| `claim_medevac` | `p_beer_id bigint` | jsonb `{ok, mine, id, checker}` (`ok:false` = someone was first) | `beer_not_found` (not live or < 10 beers), `own_beer`, `not_friend` |
| `medevac_checks` | – | setof `(id, beer_id, target_name, checker_name, target_is_me, checker_is_me, created_at)` tonight, where target or checker is the caller or a group-mate | – |
| `my_night_report` | `p_last bool default true` | jsonb `{night, evening, out, beers, others, first_at, bars, checkins, skal_given, skal_got, home, home_at, town, types:[{type,n}], nights_week_before}` | – |
| `my_wrapped` | `p_kind 'month'\|'year' default 'month', p_offset int default 1` | jsonb `{kind, from, to, nights, beers, others, home_nights, bars, towns, skal_given, skal_got, fav_bar_id, fav_bar_name, fav_bar_nights, best_evening, best_beers, best_bars, top_type, top_type_n, total, title}` | – |
| `post_voice` | `p_group_id uuid, p_mime text, p_b64 text, p_dur_ms int default 0` | jsonb `{id, created_at, left}` | `not_member`, `invalid_voice` (mime not audio/webm\|ogg\|mp4\|aac\|mpeg\|x-m4a, bad base64, < 100 B or > 60 KB), `voice_limit` (10 per user per night), `slow_down` (5 s) |
| `group_voices` | `p_group_id uuid, p_after_id bigint default 0` | setof `(id, name, mime, dur_ms, bytes, created_at, is_me)` live, newest 30, oldest first (no audio) | `not_member` |
| `voice_audio` | `p_id bigint` | jsonb `{id, mime, dur_ms, b64}` | `voice_not_found` (expired/unknown), `not_member` |
| `city_league` | `p_week_offset int default 0` | setof `(rank, town, points, users, nights, checkins, skal, home, is_mine)` top 12 + the caller's town | – |
| `bar_regulars` | `p_bar_id text` | setof `(rank, name, nights, is_me, last_at)` top 3 (min 2 nights) + the caller's own row | – |

Rules:
- **Kom hem säkert**: client calls `mark_home()` on "Jag är hemma" (hook `onStopped("home")`; also sets `medal_nights.home`). Group view shows "✅ hemma 01:32" / "🌙 ej hemma än". Morning (05:00–15:00, first open): mates who were out last night and never pressed home → in-app card only (`safeHome.missing` lines). NO automatic morning push. The existing `notify-group {event:"home"}` push (once per night) now also uses the 40 `safeHome.home` lines (some with "kl. {tid}").
- **Jag kollar**: a friend pin with ≥ 10 beers → toast "🚑 Oskar é på 10. Vem kollar läget?" + button (+ the one HUD chip "🚑 Oskar"). First tap owns it; everyone sees "💚 Lisa kollar på Oskar". Medal `kompisvakt` (stacks).
- **Bakisrapporten / Wrapped**: server facts only (`medal_nights`, `medal_checkins`, `after_nights`, `beer_types`). Best night = most social (bars×3 + skål + home safe), never most beers. Wrapped opens itself once on the 1st–3rd of a month (January: the year), else from settings.
- **Stad mot stad** (law: no competition drinking — total beers never count): per user and night in a town: 1 night out + 1 home safe + 0.5 per check-in (max 5) + 0.25 per skål given (max 10); `points = round(10 × sum / active users)`. Ranked only with ≥ 3 active users; week = Monday 00:00 Europe/Stockholm.
- **Stammis-krona**: most distinct NIGHTS at the bar in 30 days (check-ins + king taps via `medal_checkins`), min 2. Names only for self / group-mates (else "en hemlig agent"). `bar_kings` stays for old apps.
- **Holiday medals** (`olnu_medal_eval_after`, ids stable): `jul`, `fettis`, `pask` (Fri–Sun), `advent` (1st Sunday of Advent), `fredag13` (per date), `halloween` (31 Oct), `kraftskiva` (Fridays in August) — per year; `kompisvakt`. `olnu_holiday(date)` = same rules as `AFTER.holidayOf()`.
- **olnu_medal_store** now unions EVERY `public.olnu_medal_eval[_x](p_uid uuid) returns table(medal text, n int)` dynamically. Later rounds add an eval function only; never redefine the store again.

### Edge function `notify-group` — new body events
| body | who gets it | limit | payload |
|---|---|---|---|
| `{event:"medevac_check", check_id}` | group-mates of the checker who also share a group with the target, + the target | once per check (atomic `medevac_checks.notified`, row < 5 min, caller = checker) else `no_check` | title e.g. "🚑 {namn} kollar läget med {mal}" (target: "💚 {namn} kommer och kollar läget med dig"); body "Tack för att ni tar hand om varandra." / "Drick vatten. Ta taxi hem. 🚕"; url `/?focus=<beer id>`; tag `olnu-medcheck-<id>` |
| `{event:"voice", voice_id}` | other members of that group | atomic `voice_msgs.notified` (< 5 min, own row) else `no_voice`; 1 per sender per group per 2 min → `slow_down` | title 1 of 20 `voiceMsg` lines; body "i <grupp> · Tryck för att lyssna"; url `/?chat=<group_id>`; tag `olnu-voice-<group_id>` |

### Deep links / pages
- `docs/qr.html?bar=<id>[&n=<name>]`: printable A4 poster (qrcodejs) with a QR to `<app url next to qr.html>?bar=<id>&checkin=1` (live: https://tunela.github.io/Beer-map/docs/ or /Beer-map/, whichever serves qr.html). Link "🖨️ Skriv ut QR-affisch" in every bar popup.
- `?bar=<id>&checkin=1`: app opens the bar (v12 `?bar=`); `after.js` removes `checkin` from the URL and taps "📍 Checka in" when the GPS position is ≤ 300 m from the bar (else a toast with the distance). Ghost mode rules of check-in apply.
- `?hol=<holiday key>`: preview the holiday theme (testing).

### Röstskål — iOS caveats
- MediaRecorder: iOS Safari 14.5+ (records `audio/mp4`), Chrome/Android `audio/webm;codecs=opus`. Older iOS: no mic button (feature hidden).
- iOS < 17.4 cannot play WebM/Opus: the play button shows "🔇 kan inte spelas" via `canPlayType`. Android/desktop play `audio/mp4` fine.
- iOS PWA asks for the microphone again on most launches; the first press only asks for permission ("Mikrofonen é redo. Håll inne igen.").

## v15 LEK (omgång 2; additive)
Migration `supabase/migrations/0017_games.sql` (applied on the server 2026-10-17 as 0017_games_tables / _logic / _rpcs; also appended to `setup.sql`). Needs 0001–0014 (0015 optional). Client: `docs/js/games-content.js` (`window.GAMES_CONTENT`, all texts) + `docs/js/games.js` (`window.GAMES`, called through `mods()`) + `docs/games.css`. A missing RPC (old database, PGRST202) = the whole feature hides (no chip, no group button), no error.

"Tonight" = the night key `olnu_night_of(now())` (next 05:00 Europe/Stockholm, DST-correct). Everything resets at 05:00. No game asks anyone to drink more; no mission counts beers.

### Tables (RLS on, no policies, no client access; rows are never removed, reads filter on the night)
`game_mission_cat(id, kind, goal, needs_group, active)`, `game_missions(user_id, night, slot 1–3, mission, kind, goal, progress, done_at)`, `game_facts(user_id, night, water, water_at, home_at, bingo_changes)`, `game_sugen(user_id, night, status, changes, updated_at)`, `game_crawls(id, group_id, user_id, night, stops jsonb, n 2–6, created_at, closed, done_at)`, `game_agents(group_id, night, agent, mission, started_by, created_at, revealed_at, correct, votes)`, `game_agent_votes(group_id, night, voter, suspect)`, `game_guesses(user_id, night, guess 0–20000, town, lat, lng (0.01), changes, real)`, `game_oracles(group_id, night, user_id, guess, real, err, guessers)`, `game_bingo_cards(group_id, night, card int[9], n, lines, bingo_at)`, `game_bingo_ticks(group_id, night, idx 0–8, user_id, ticked)`.

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `game_poll` | – | jsonb `{v, server_time, night, me, groups:[summary + id, name]}` (max 20 groups) | – |
| `game_group` | `p_group_id uuid, p_bingo_n int default 40` | jsonb full group state (+ `members`, `points`, `guesses_prev`, `guessed`, bingo `card` + named `ticks`) | `not_member` |
| `game_water` | – | jsonb `{ok, water, wait_seconds, reason?:'limit'}` | – |
| `game_home` | – | jsonb `{ok, home_at}` | – |
| `set_sugen` | `p_status text` ('sugen'\|'kanske'\|'inte'\|'none'/'' = clear) | jsonb `{status, changed}` | `invalid_status`, `slow_down` |
| `create_crawl` | `p_group_id uuid, p_stops jsonb` (2–6 × `{id, name, lat, lng}`) | jsonb `{id, n}` | `not_member`, `invalid_crawl`, `slow_down` |
| `close_crawl` | `p_crawl_id bigint` | jsonb `{ok}` | `crawl_not_found` |
| `start_agent` | `p_group_id uuid` | jsonb `{ok, already, is_me}` | `not_member`, `not_enough` |
| `vote_agent` | `p_group_id uuid, p_member text` (member key `k`) | jsonb `{ok, already, revealed}` | `not_member`, `no_agent`, `is_agent`, `invalid_suspect` |
| `tick_bingo` | `p_group_id uuid, p_idx int, p_on bool default true` | jsonb `{ok, ticked int[], lines, new_bingo}` | `not_member`, `invalid_idx`, `no_card`, `not_yours`, `slow_down` |
| `guess_night` | `p_guess int, p_town text, p_lat, p_lng` | jsonb `{ok, guess, town, closes_at}` | `too_late`, `invalid_guess`, `outside_sweden`, `slow_down` |

`me` = `{night, missions:[{slot, id, kind, goal, progress, done, fresh, done_at}], done_n, water, home_at, guess:{guess, town}|null, guess_open, guess_closes, guess_so_far (only after 21:00), guess_prev:{guess, town, real}|null, sugen, out, agent:[{group_id, group_name, mission}]}` (`agent` = groups where the caller is tonight's secret agent).
Group summary = `{sugen:[{k, name, is_me, status, at, out}], crawl:{id, n, done_n, done, done_at, is_mine, created_at, by, stops:[{i, id, name, lat, lng, done, who(full only)}]}|null, bingo:{n, lines, bingo_at, ticks (count; full: [{idx, name, is_me}]), card (full only)}|null, agent:{active, is_me, mission (agent only), by}|null, agent_prev:{revealed, voting, reveal_at, votes, needed, is_agent, my_vote, mission (after reveal or agent), agent_name, agent_k, correct, correct_names, i_was_right}|null, oracle:{name, is_me, guess, real, err, guessers}|null, night}`. `k` = opaque member key (md5 of group + user, 12 hex), never a user id.

Rules:
- **Kvällens uppdrag**: 3 missions per user per night, 3 different kinds, picked once (deterministic md5 of user + night) and stored, so a reload never changes them. Group kinds (`chat`, `rally_yes`, `group_out`, `tip`) only for users in a group at assignment; `early` not given from 19:00, `home` not from 01:00. Progress from server facts: `checkin_bars` (distinct bars in `medal_checkins`), `skal_give`, `skal_get` (different people), `chat` (group_msgs), `rally_yes` (yes on others' rallies), `group_out` (max members of one group out right now: visible pin or live check-in; ghost never counts), `home` ("Jag är hemma" via `game_home`, after the first beer, before 02:00 local), `water` (`game_water`: 1 per 5 min, max 10 per night), `beer_type` (distinct, not "annan"), `queue_report`, `tip`, `early` (first beer before 20:00), `other_none` (beer and no other drink, from 23:00 or after home). A done mission stays done. Texts: `GAMES_CONTENT.missions` by id (catalog ids m001–m129 must match `game_mission_cat`).
- **Krogrunda**: any member makes a route of 2–6 distinct bars (Sweden bbox, name 1–60, id 1–80; else `invalid_crawl`). Max 1 new route per user per 2 min (`slow_down`). A new route closes the group's older open route tonight. A stop is done when any current member checked in there tonight (`medal_checkins`: check-ins + Kung av baren taps). All stops done → `done_at`. Only the creator can close it.
- **Hemlig agent**: once per group per night; group needs 3+ members and 2+ who were out tonight (else `not_enough`). The server picks one random member who was out; `mission` = random 0–999, client text = `secretAgent.missions[mission % length]`. Only the agent sees the mission. Voting is for LAST night's agent, from 05:00: one vote per member (not the agent: `is_agent`; not yourself: `invalid_suspect`), no changing. Reveal when every member except the agent voted, or at 12:00 local. Points: +1 per right guess, +2 for an agent nobody guessed (with 1+ vote).
- **Gissa kvällen**: before 21:00 local (`too_late` after), 0–20000, max 20 changes per night. Town = `CITIES.nearest()` centre (else the user's position rounded 0.01, "Närområdet"). Real = tonight's anonymous `beer_events` beers within 20 km (undone and ghost beers excluded). Next day each group's best guess (relative error, 2+ guessers among current members) = "Dagens orakel" (`oracle`), until the next 05:00.
- **Kvällsbingo**: the first `game_group` call of the night makes the card: 9 different square numbers below `p_bingo_n` (client sends its square count; text = `bingo[n % length]`, keep the list order, add new squares at the end). Members tick (honour system, everyone sees who); only the ticker can untick (`not_yours`). Lines = rows, columns, diagonals; `new_bingo` when the count of lines goes up for the first time. Max 100 tick changes per user per night.
- **Sugen-status**: tonight only; 1 change per 10 s and 40 per night (`slow_down`); same status again = `changed:false`. Shown in the group view and as chips in the group list. No push from the server (the group sees a toast on its next poll).
- **Medals** (`olnu_medal_eval_games`, merged by the generic `olnu_medal_store` that unions every `olnu_medal_eval_<x>(uuid)`; same body as 0018): `uppdrag` Uppdragstagaren (missions done, stacks), `uppdrag3` Fullt pådrag (3/3 nights, stacks), `runda` Rundvandraren (finished crawl with 2+ own stops, stacks), `detektiv` Detektiven (right agent guesses, stacks), `spion` Mästerspionen (agent nobody guessed, stacks), `orakel` Oraklet (Dagens orakel, stacks), `bingo` Bingo! (nights your group got a line and you ticked, stacks).
- **Radera allt om mig**: `olnu_g_anonymize(old, new)` moves all game rows to the new random id; the erase RPC should call it (see lead notes).

### Frontend (games.js)
- ONE HUD chip "🎯 1/3" (green at 3/3) → "Kvällens uppdrag" sheet: 3 missions with progress, "💧 Jag tog vatten" on a water mission, Sugen buttons, Gissa kvällen, buttons to each group's games.
- Group list (`groupItem`): Sugen chips + one "🎲 Lek" button with a short summary (🗺️ 1/3 · 🎱 2/9 · 🕵️ Rösta! · 🔮 name) → group sheet with tabs Sugen / Runda / Bingo / Agent / Gissa. Crawl picker = bars in the current map view, search, tap in order.
- Map: numbered flags (pane `gameflags`, zoom ≥ 11) for tonight's crawls of the user's groups; green with ✓ when done.
- Polls `game_poll` with the app poll (max every 45 s) and ~3 s after taps/beers. Toasts for changes (mission done = `missionDone` line + medal award, sugen, crawl created/stop/done, BINGO, agent picked/reveal/vote nudge, oracle), never repeated after a reload (`olnu.gameSeen` per night); the first poll after opening shows max 2.
- The existing "💧 Druckit vatten" toast button (`MEDALS.waterTaken`) also counts for the water mission (wrapped in `games.js`). "Jag är hemma" → `game_home` via `onStopped("home")`.

## v14 CLIENT (privacy, undo, poll_v2 client, restaurants, worldwide, all drinks)
Migration `supabase/migrations/0016_privacy_erase.sql` (applied on the server 2026-10-17; in `setup.sql` after 0015). Client files: `docs/app.js`, `docs/js/v14.js` (`window.PRIVACY` + v14 strings via `I18N.add`), `docs/v14.css`, `docs/js/bars.js`, `docs/js/news.js`, `docs/js/social.js`, `docs/js/rally.js`, `docs/js/extras.js`, `docs/js/util.js`. A missing new RPC = the old behaviour, silently.

### Poll (v13 "Client must" 1–8, done)
- One `poll_v2(view bbox, null, p_heat)` per poll. bbox = map bounds, lat clamped to ±85, lng wrapped to −180..180; a view ≥ 360° wide or across the date line asks the whole lng range. A pan outside the returned `bbox` polls again (max every 3 s).
- Every 30 s; every 60 s when the map was not touched (pointer/key/wheel/move) for 3 min; no polling while the tab is hidden. `p_heat=true` at most once per 60 s and only while the heat layer is on (toggling it on asks at once); the last heat is kept.
- `poll_v2` missing (PGRST202 / no `pins`) → `live_beers` + `live_others` + `live_checkins` (+ `heat_points`, `beer_reactions`, `my_rallies`, `friend_totals`, `my_stats` as before). `post_beer_v2` missing → `post_beer` (+ `stop_beer` for ghost, push at once, no undo). `skal_v2`/`react_v2` are used only while pins come from `poll_v2`.
- Modules get the raw poll through the hook `onPollData(d)` (null on the old path) before `onPoll`: social takes stats from `me`, reactions from `pins[].rx/my_rx`, lifetime totals from `pins[].total`; rally takes `rallies`.
- Keys are `String(id)`. Stranger streak toasts compare counts per level inside the overlap of the previous and current poll box (an id rotation or a pan never toasts). Skål/react on `beer_not_found` → re-poll once, find the same pin (bar_id/position + counts) and retry once.
- Header = `live_total` ("N dricker i världen just nu"). HUD/cooldown/count from `me`; a poll that started before an accepted beer does not overwrite its cooldown. `U.next5am` is DST-safe (offset at the target instant); `nightEnd()` prefers the server `expires_at`.
- Measured with the mocked app (fake clock): 4 requests/min while used (poll_v2 ×2, bar_status, bar_kings), 3/min idle (review: ~13/min).

### ↩️ Ångra
- After an accepted `post_beer_v2` with `undo_until`: a big toast "Nr N ikväll · ↩️ ÅNGRA" for 12 s, then a small one until `undo_until` (clamped 10 s – 125 s for clock skew); it survives other toasts (`data-keep`). Tap → `undo_beer()` → random line from 10 (`undoToasts`), local count/cooldown reset, re-poll. Refusals: `too_late`, `limit`, `no_beer` → own toasts.
- `notify-group` (milestone push) is sent only when the undo window has passed (`olnu.notifyAt`, survives a reload; sent if < 4 min late), or at once when the next beer is accepted; an undo cancels it. Ghost beers never push.

### Sheets
- One sheet at a time. `openSheet(title, build, {now, lock, onClose})`: while a `lock` sheet ("Var dricker du?") is open or a beer is being posted, other sheets wait in a queue and open afterwards. Replacing a sheet calls the old `onClose("replaced")`; ✕ / backdrop / Escape → `onClose("cancel")`.
- "Var dricker du?": closing it = NO beer ("Ingen öl rapporterad"); the ÖL! button is always enabled again. Bars first (🍺), then up to 4 restaurants/cafés/fast food within 150 m (🍽️, dashed; a place with a similar name ≤ 80 m from a listed bar is left out), then "🏠 Ingen krog".
- The service-worker reload waits while typing, posting, a sheet/intro/takeover is open or the undo toast is up. "Uppdatera nu" re-fetches the files listed in `sw.js` SHELL plus every local script/stylesheet of the page.

### Restaurants
- `places.json` places get `id = "pl_" + round(lat*1e5) + "_" + round(lng*1e5)`. `BARS.byId` finds bars and places. Server `bars_lite` holds the same 18,763 places (type restaurant | fast_food | cafe; re-import with `scripts/places-lite-sql.py`, then `select public.olnu_resnap();`).
- Snap/assign rule (server `olnu_near_bar`, client `BARS.nearestSpot`): a bar within 75 m wins; else a place within 40 m. With `poll_v2` the server `bar_id` decides (no `bar_id` = not at a spot; `snap:"area"` never). Old server: the client rule.
- A place is drawn (🍽️ marker, popup with check-in) only when someone is checked in there; beers there make the normal hot badge. `check_in` accepts `pl_…` ids.

### Privacy & law
- 🔒 Integritet (Settings + intro + 18+ card): what is stored, who sees what, how long (pins/chat/check-ins hidden at 05:00, rows kept until a cleanup exists; medal/stat facts kept), no ads/tracking/selling, Esri/Google Fonts see the IP, contact = GitHub issues. The old "Vi sparar ingen statistik" texts are gone.
- 🗑️ Radera allt om mig (Settings, two confirms): push off on this phone, `delete_my_data()`, then all `olnu*` localStorage keys and sessionStorage are cleared, `signOut()`, reload.
- `delete_my_data()` → jsonb `{ok, groups_left, subscriptions, moved_rows}`; authenticated only. Leaves every group (`leave_group`), removes push subscriptions (`delete_push_subscription`), then anonymizes: every row of the caller moves to a fresh random uuid that is no login (positions → 0/0 or null, chat/rally text → "🗑️", voice audio emptied, live things end now). A generic sweep moves every other public uuid column that equals the caller (game, voice, likes … and future tables). Rows are never removed; the auth user stays but owns nothing.
- 🔞 The intro needs "Jag är 18 år eller äldre" (`olnu.age18=1`); users who saw the intro before get a one-time 18+ card.
- 🏠 Hemzon (Settings, `olnu.home` = {lat, lng, r: 300}, phone only): a beer inside it is posted with `p_precise=false` unless a bar/restaurant is picked; the toast adds "🏠 Hemzon: ungefärlig plats".
- Session repair: a failed refresh, or a phone that had an account (`olnu.uid`) but lost the session, shows "Din inloggning gick ut" (🔄 Försök igen / 📥 Jag har en flyttkod / Fortsätt med nytt konto). A new anonymous account is made only after that choice.

### Owner decisions in the client
- G worldwide: no map bounds (minZoom 3, worldCopyJump); position checks are "finite, |lat| ≤ 85"; Sweden stays the start view; server `outside_sweden` → "Servern tar int' emot öl utanför Sverige än – snart!".
- H all drinks: levels, numbers and sorting use `U.drinks(b)` = beer_count + other_count (pins, HUD "Ikväll: N 🍺", crowd list, bar popup, top lists, group status/chat, chaos, heat fallback, news). HOT STREAK / MEDEVAC takeovers when the total crosses 5 / 10, also after ANNAT; water reminder every 3rd drink; "ta det lugnt" counts other drinks. Only the total is shown (no 🍺/🥃 split). Server-side totals come later.
- F ticker mix: group items (tk-friend / tk-me, kinds `group*`/`me*`/`friend*`) take up to 4 of 6 slots, then town items (bars, rates, check-in crowds, chaos, anonymous town lines), then general filler.

## v17 WORLDWIDE + ALL DRINKS + TOPPLISTOR (server + js/boards.js; additive)
Migration `supabase/migrations/0023_world_alldrinks_boards.sql` (applied on the server 2026-10-17 as 0023_world_alldrinks_a / _b / _c; also appended to `setup.sql`). Needs 0001–0022. No RPC changed its return type; new json fields are at the end. Client: `docs/js/boards.js` (`window.BOARDS`, through `mods()`) + `docs/boards.css`. A missing board RPC (old database, PGRST202) = the board sections and the switch hide.

### Worldwide (owner decision 1)
- Valid position = finite, |lat| ≤ 85, lng −180..180 (`olnu_world_ok`). Error code stays `outside_sweden` (now = invalid coordinates).
- World: `post_beer_v2`, `post_other_v2`, `check_in`, `record_bar`, `set_push_location`, `create_rally` (lat/lng kept), `report_queue` / `add_offer` / `beer_type_stats` (via `olnu_bp_in_sweden`, now world bounds), `create_crawl`, `guess_night`, `poll_v2`, notify-group `sos` (`validPt`).
- `poll_v2`: box clamped to |lat| ≤ 85 instead of Sweden. A box with `min_lng > max_lng` (across the date line) or a box that reaches past ±180 after the 15 % margin = the whole lng range (−180..180). `bbox` in the answer shows the box used.
- Still Sweden-only (bodies contain row removal, so they were not replaced): old `post_beer` and old `post_other`. Old apps that call them keep the old rule. `post_beer_v2` / `post_other_v2` post outside Sweden through the old bodies at a placeholder point; a BEFORE trigger (`olnu_a_world_pos`, runs first, transaction-local setting `olnu.world_pos`) writes the real rounded position before any other trigger sees the row (heat, medal cell, town, snap, undo state all get the real place).
- `post_beer_v2` gets new fields `lat`, `lng` (the stored row), `drinks` (= beer_count + other_count); `milestone` is now 1 / 5 / 10 when the accepted tap made **drinks** exactly 1 / 5 / 10. `post_other_v2` gets `lat`, `lng`, `drinks`, `milestone` (same rule).

### All drinks count (owner decision 2)
- `week_beers` (trigger `olnu_week_beers`, now on beer_count AND other_count) counts every drink. So lifetime total, titles (`my_stats`, `poll_v2.me`, `pins[].total`, `friend_totals`, `group_status.total`), `group_league` and Ligamästare count beers + other drinks. Undo still takes 1 off.
- Medals (`olnu_medal_eval`): nights, hot (5+), medevac (10+), holidays, Förtruppen, Fältresa use beers + others per night; m1…m1000 use the lifetime total. `medal_nights` gets first_at / early / owl / cell also from an other drink. `award_medals('home')` and `claim_medevac` (≥ 10) use drinks.
- Owner stats: per night `drinks`; `beers.drinks_tonight`, `beers.drinks_last_night`; `all_time` / `avg_per_person` / hot / medevac use drinks; `owner_hours` also counts other drinks (trigger `olnu_board_beers`).
- notify-group: levels (1 / 5 / 10), the "live drink" check, KAOS counts and level-ups use `drinksOf(beer)` = beer_count + other_count. Friend push texts are unchanged.
- **Backfill (2026-10-17)**: for every live row, this week's `week_beers` was raised so lifetime ≥ tonight's drinks. Quiet: the title each live user now holds was claimed in `push_sent` (`title:<titel>`, no level-up push), and `notified_level` was set to the current drink level (no late 5 / 10 push). Medals for the new totals come as normal in-app toasts (no push).

### 🏆 Topplista + 🏛️ Wall of Fame (owner decisions 3 + 4)
Tables (RLS on, no policies, no client access; rows are never removed): `board_optin(user_id, show default false, name 1–30 null)`, `board_nights(user_id, night, drinks, lat, lng)` (place rounded to 0.05° lat / 0.1° lng ≈ 5 km; filled by trigger `olnu_board_beers` on drink changes, also after undo; backfilled from `medal_nights` + `after_nights` town / check-in bars / cell and from `beers`), `board_bars(bar_id, lat, lng)` (from `checkins` + `bar_taps`, for bars abroad), `board_rl` (rate limit). "Radera allt om mig" moves `board_optin` to a new id and the trigger turns it off and clears the name.

| name | params | returns | errors |
|---|---|---|---|
| `set_board_optin` | `p_on bool, p_name text default null` | jsonb `{on, name}` | `invalid_name` (p_name given but not 1–30 chars after cleaning) |
| `my_board_optin` | – | jsonb `{on, name}` | – |
| `local_board` | `p_lat, p_lng float8, p_km float8 default 20, p_period text default 'tonight'` | setof `(rank int, name text, total int, nights int, is_me bool)` | `outside_sweden`, `invalid_period`, `slow_down` |
| `wall_of_fame` | `p_lat, p_lng float8, p_km float8 default 20` | setof `(category text, name text, value int, is_me bool, top bool)` | `outside_sweden`, `slow_down` |

Rules:
- **Names**: `name` is set only when that user switched the board on (`board_optin.show`): their board name, else their group display name (min), else null. Off (default) → null → client shows "Hemlig agent" / "Du (hemlig)". The caller's own row follows the same rule. Never a position, never a user id.
- Radius `p_km` clamped to 5–50 km; the centre is rounded to 0.01°. Max 30 board calls (both RPCs together) per user per minute → `slow_down`.
- `local_board` tonight: tonight's rows (live night, stopped/"hemma" included) with drinks > 0 whose pin is within the radius; ghost (Spökläge) rows never count. `nights` = 1. Week: `board_nights` from Monday (evening date Europe/Stockholm, i.e. Monday evening onward) whose night place is within the radius; `total` = sum of drinks, `nights` = count. Order: total desc, nights desc; `rank` = SQL rank() (ties share a rank). Top 10 + the caller's row.
- `wall_of_fame` (all time, nights whose place is in the radius): `best_night` (most drinks one night), `nights` (most nights out), `bars` (most different bars in `medal_checkins`, bar inside the radius), `stammis` (most nights at one bar in the radius), `skal` (skål given, `after_nights`, from v16), `home` (nights with "Jag är hemma": `medal_nights.home` or `after_nights.home_at`). One row per category with `top = true` (ties → who got there first), plus the caller's own row (`is_me`, `top = false`) when the caller has a value but is not the holder. Values > 0 only.

### Client (js/boards.js, owner decision 5)
- 🏆 sheet (hook `topSheet`): "🏆 <Stad>s törstigaste" (tabs Ikväll / Veckan, `local_board`), the switch "Visa mig på topplistan", "🏛️ <Stad>s Wall of Fame" (`wall_of_fame`). Town = `CITIES.nearest()` of the own pin → last GPS position → map centre (genitive: "Ludvikas", "Borås"); none → "Närområdets …". Results cached 60 s per place.
- Settings (hook `settingsSheet`): "🏆 Topplistan" with the same switch. The switch sends `set_board_optin(on, local name)`; a name the server refuses → saved without a name.
- Swedish texts with Dalarna humour inside boards.js, English fallback (`I18N.lang === "en"`). Old server → sections and switch hide (no error toast).

## v18 ETA ("🏃 Jag é på väg"; additive)
Migration `supabase/migrations/0024_eta.sql` (also appended to `setup.sql`). Needs 0001–0023. Client: `docs/js/barsplus.js` (ETA engine, `BARSPLUS.eta`), `docs/js/rally.js` (rally sheet), `docs/barsplus.css`. A missing RPC (old database, PGRST202) = no ETA UI at all, no error.

### Table (RLS on, no policies, no client access; rows are never removed, reads filter on time)
- `etas(id, user_id, group_id null (= the rally's group for a rally ETA), bar_id null, bar_name null, lat, lng null, rally_id null, minutes 5|10|15|20|30, created_at, eta_at = created_at + minutes, expires_at = next 05:00 (rally ETA: min(05:00, rally expires_at)), arrived_at null, cancelled_at null, notified bool)`.
- **Live** ETA = not expired, not cancelled, not arrived, `eta_at > now() − 20 min`, and (rally ETA) its rally still open and not expired.

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `set_eta` | `p_bar_id text, p_bar_name text, p_lat float8, p_lng float8, p_minutes int, p_rally_id bigint default null` | jsonb `{ok, wait_seconds, id, bar_id, bar_name, lat, lng, rally_id, minutes, created_at, eta_at, expires_at, mins_left, arrived, arrived_at, active}` | `invalid_minutes`, `invalid_bar`, `outside_sweden` (= invalid coordinates), `rally_not_found`, `not_member` |
| `cancel_eta` | `p_arrived bool default false` | jsonb `{ok, id, arrived}` / `{ok:false, reason:"no_eta"}` | – |
| `my_eta` | – | jsonb = the row fields above (newest live, or arrived < 15 min ago) / `{active:false}` | – |
| `group_etas` | – | setof `(id, name, is_me, bar_id, bar_name, lat, lng, rally_id, minutes, eta_at, mins_left, created_at, arrived, arrived_at)` | – |

Rules:
- **set_eta**: minutes must be 5/10/15/20/30. Bar ETA: bar id 1–80, name 1–60 (cleaned), valid world position (rounded to 5 decimals). Rally ETA (`p_rally_id`): rally must be live (`rally_not_found`), caller a member of its group (`not_member`); bar id/name/position optional — missing ones come from the rally (`place`, `lat/lng`); only that group sees it. Max 1 new ETA per user per 2 min → `ok:false` + `wait_seconds` + the current row, nothing changes. A new ETA cancels the caller's older live one (one live ETA per user).
- **Auto "framme"** (triggers that never block the write): a check-in at the ETA's bar (or, for an ETA without bar id, a check-in within 100 m), or a new drink with a precise, visible (not stopped, not ghost) pin within 100 m of the target or snapped to that bar (`beers.snap_bar`). `cancel_eta(true)` = "✅ Framme!", `cancel_eta()` = "✖️ Avbryt".
- **group_etas**: the caller's own ETAs plus ETAs of users who share a group with the caller (a rally ETA only for members of the rally's group). Live rows plus rows that arrived in the last 15 min. `name` = display name in the shared group (rally: in that group; own: smallest own name). Order `eta_at`, max 300. One call per poll (client: max every 25 s; 90 s after 3 empty answers).

### Edge function `notify-group` — new body event
| body | who gets it | limit | payload |
|---|---|---|---|
| `{event:"eta", eta_id}` | group-mates (rally ETA: that group only) who are AT the target now: check-in at that bar in the last 3 h (target without bar: check-in within 100 m), or a precise, visible live pin within 100 m / snapped to that bar; plus the rally creator for a rally ETA. Never the caller. | etas row must be the caller's, live, < 5 min old, not pushed (atomic `notified` claim) else `no_eta`; rally ended → `no_rally`; 1 ETA push per sender per 10 min (`push_sent` kind `eta`) → `slow_down`; nobody there → `nobody_there` | title 1 of 82 lines by minutes left (≤ 5 short, 10–15 mid, 20–30 long; dalmål + military; per recipient never the same line twice in a row), e.g. "🪖 {namn} é på marsch mot {bar}. ETA {min} min. Håll en stol!"; body 1 of 30, e.g. "Tryck för att se var {namn} é."; url `/?rally=<id>` for a rally ETA else `/?bar=<bar_id>`; tag `olnu-eta-<id>`; `rally_id` when a rally |
- Response `{sent, failed, recipients}`, or `{sent:0, failed:0, reason}`.

### Frontend
- Bar popup section "🏃 På väg hit" (hook `barPopupHTML`, before the v12 part): mates heading there ("🪖 Lisa marscherar hit · 7 min", 20 row lines; "✅ Oskar é framme"), own ETA with a live countdown + "✅ Framme!" / "✖️ Avbryt", else "🏃 Jag é på väg" → chips 5/10/15/20/30 min → `set_eta` + `notify-group {event:"eta", eta_id}` (when push is configured). Toasts: 40 "set" lines, 25 arrival lines, 20 cancel lines; the phone remembers the last 10 per kind (`olnu.etaSeen`) and never repeats them.
- Rally sheet: "🏃 ETA: Lisa (12 min), Anton (✅)"; after "✅ Kommer": "Hur långt bort é du?" chips (target = the bar the call-out resolves to, else its point + place text, plus `p_rally_id`), or my countdown + Framme/Avbryt. The "Kommer" toast gets a "⏱️ Ange ETA" button.
- In-app toasts (once per ETA, `olnu.etaToasted`): a mate's new ETA to the bar I am checked in at or to my own call-out, and their arrival.
- Swedish (dalmål/military) with an English fallback inside barsplus.js.

## v19 GÄNGET (group fun pack; additive)
Migration `supabase/migrations/0026_gang.sql` (applied on the server 2026-10-17 as 0026_gang_a_tables_helpers / _b_rpcs / _c_rpcs; also appended to `setup.sql`). Needs 0001–0025 (`create_rally`, `medal_nights`, `medal_checkins`, `after_nights`, `bars_lite`, `olnu_towns`, `etas`; `bar_takeovers` / `game_crawls` are read inside exception blocks). Client: `docs/js/gang-content.js` (`window.GANG_CONTENT`, all texts; keep list ORDER, add at the end) + `docs/js/gang.js` (`window.GANG`, through `mods()`) + `docs/gang.css`. A missing `gang_poll` (old database, PGRST202) = the whole feature hides (no chip, no group button, no 🏆 section, no chat option), no error. In-app only: no new push event; the only push is the existing `notify-group {event:"rally"}` for a call-out made by "Vart ska vi?".

### Tables (RLS on, no policies, no client access; rows are never removed — hide/close/cancel flags instead)
`gang_quotes(id, group_id, user_id (saver), who 1–30, body 1–140, msg_id, night, reveal_at, created_at, hidden, hidden_by, hidden_at)`, `gang_mt_rounds(id, group_id, user_id, q 0–9999, night, created_at, ends_at, closed_at)`, `gang_mt_votes(round_id, voter, target)`, `gang_polls(id, group_id, user_id, night, options jsonb [{id,name,lat,lng}], created_at, ends_at, ended_at, ended_by, winner, rally_id, rally_error)`, `gang_poll_votes(poll_id, user_id, opt 0–3)`, `gang_brunches(id, group_id, user_id, place 1–60, place_id, lat, lng, at_time 'HH:MM', created_at, expires_at, closed)`, `gang_brunch_answers(brunch_id, user_id, answer ja|kanske|nej)`, `kebab_ratings(id, user_id, place_id, place_name, lat, lng, town, stars 1–5, tag, night, month)` unique (user, place, night), `gang_debts(id, group_id, created_by, debtor, creditor, amount kr 1–50000, what 1–40, paid_at, paid_by, cancelled_at, cancelled_by)`, `gang_swish(group_id, user_id, number, changes)`. All user columns are uuids → "Radera allt om mig" moves them with the generic sweep.

### RPCs (authenticated only; `not_authenticated` without a session; members only → `not_member`)
Member key `k` = md5(group:user:olnu-gang) first 12 hex (never a user id). "Tonight" = `olnu_night_of(now())`; "last night" = the 05:00 boundary at or before now (DST-correct).
| name | params | returns | errors |
|---|---|---|---|
| `gang_poll` | – | jsonb `{v, server_time, night, last_night, hour, groups:[{id, name, mt_open, mt_voted, mt_last, poll_open, poll_id, poll_voted, poll_winner, poll_due, brunch:{id,by,by_me,place,at_time,mine,ja}\|null, quotes_pending, quotes_yday, paper, debt_net}]}` (max 20) | – |
| `gang_group` | `p_group_id` | jsonb `{server_time, night, last_night, hour, members:[{k,name,is_me}], mt:{round, history[]}, poll, brunch, quotes:{pending, next_reveal, yesterday[]}, debts:{open[], paid[], net[], swish[]}}`; finishes a poll past its 15 min | `not_member` |
| `add_quote` | `p_group_id, p_who, p_body, p_msg_id bigint default null` | jsonb `{id, reveal_at, who, body}` | `invalid_quote`, `slow_down` |
| `hide_quote` | `p_quote_id` | `{ok}` | `quote_not_found`, `not_yours` |
| `gang_quotes` | `p_group_id, p_before_id default null` | setof `(id, who, body, by_name, by_me, created_at, night, reveal_at, revealed, can_hide)` newest first, 30 | `not_member` |
| `mt_start` | `p_group_id, p_n int default 120` | `{id, q}` | `not_enough`, `round_open`, `slow_down` |
| `mt_vote` | `p_round_id, p_member text (k)` | round json `{id, q, by, by_me, created_at, ends_at, votes, needed, my_vote, done, results:[{k,name,is_me,n}]\|null}` | `round_not_found`, `round_done`, `invalid_member` |
| `mt_close` | `p_round_id` | round json | `round_not_found` (not the starter) |
| `create_bar_poll` | `p_group_id, p_options jsonb` (2–4 × `{id,name,lat,lng}`, distinct ids) | `{id, ends_at}` | `invalid_poll`, `poll_open`, `slow_down` |
| `vote_bar_poll` | `p_poll_id, p_option int` | poll json `{id, by, by_me, created_at, ends_at, ended, winner, rally_id, rally_error, rally_mine, my_vote, votes, options:[{id,name,lat,lng,i,n,names[]}]}` | `poll_not_found`, `poll_ended`, `invalid_option` |
| `end_bar_poll` | `p_poll_id` | poll json | `poll_not_found`, `not_yours` (non-creator before 15 min) |
| `create_brunch` | `p_group_id, p_place, p_place_id, p_lat, p_lng, p_at 'HH:MM'` (all but place default null) | `{id}` | `not_morning`, `invalid_brunch`, `brunch_open`, `slow_down` |
| `answer_brunch` | `p_brunch_id, p_answer ja\|kanske\|nej` | brunch json `{id, by, by_me, place, place_id, lat, lng, at_time, created_at, expires_at, mine, ja[], kanske[], nej[]}` | `invalid_answer`, `brunch_not_found` |
| `close_brunch` | `p_brunch_id` | `{ok}` | `brunch_not_found` (not the creator) |
| `rate_kebab` | `p_place_id, p_name, p_lat, p_lng, p_stars 1–5, p_tag default null, p_my_lat, p_my_lng` | `{ok, is_new, avg, n, town}` | `invalid_stars`, `invalid_tag`, `invalid_place`, `not_food`, `too_far`, `slow_down` |
| `kebab_top` | `p_lat, p_lng, p_month_offset int default 0` | `{town\|null, month, list:[{rank, place_id, name, lat, lng, avg, n, tag, my_stars}]}` top 10 | `outside_sweden` (= invalid coordinates) |
| `kebab_place` | `p_place_id` | `{avg, n, my_stars, my_tag, rated_tonight, tags:[{tag,n}]}` | – |
| `add_debt` | `p_group_id, p_debtor k, p_creditor k, p_amount int, p_what` | `{id}` | `invalid_debt`, `slow_down` |
| `settle_debt` | `p_debt_id, p_action 'paid'\|'unpaid'\|'cancel' default 'paid'` | `{ok}` | `invalid_action`, `debt_not_found`, `not_yours`, `too_late` |
| `set_swish` | `p_group_id, p_number` ('' clears) | `{number}` | `invalid_swish`, `slow_down` |
| `gang_paper` | `p_group_id, p_night default null` (= last night) | jsonb `{night, evening, group_name, town, out_n, ready, members:[{k,name,is_me,out,bars,bar_names[],first_at,home_at,skal,eta_max,rallies,mt_wins,quotes,kebab}], quotes:[{who,body}], mt:[{q,names[]}], takeovers[], crawl_done}` — NO drink counts | `not_member` |

Rules:
- **📖 Citatboken**: who 1–30, body 1–140 (trimmed, outer quotes stripped). With a `p_msg_id` of a message in this group, who = the sender's group name and body = the message (client values ignored). Reveal = 10:00 Europe/Stockholm on the morning the night ends (`olnu_gang_reveal`); before that only the saver sees it, others see a count. Same who+body twice in one night → the old id. 1 per 8 s, 40 per night per user. Hide: the saver, or a member whose group name equals `who` (no undo). Book keeps everything, newest first.
- **🤔 Mest troligt**: one open round per group; open = not closed, < 10 min, and not every current member has voted (min 2). Votes may change until done. `q` = random index < `p_n` (not used by the group in 30 days when possible); text = `GANG_CONTENT.mt[q % length]`. Results only when done. 1 start per 15 s per user. Questions: 120, kind, no drinking rules.
- **🗳️ Vart ska vi?**: one open poll per group, 15 min; the creator can end it any time; after 15 min any member's `end_bar_poll` / `gang_group` / `create_bar_poll` finishes it (advisory lock, idempotent). Winner = most votes of current members; tie → the option that reached the count first; no votes → no winner. Winner → `create_rally` AS THE CALLER (body "🗳️ Gänget har röstat: <bar>!", place, bar position) inside an exception block (`slow_down` etc. → `rally_error`, the client offers "🪖 Skicka inkallelse"). The client whose call made the call-out (`rally_mine`) sends the existing `notify-group {event:"rally", rally_id}` once (`olnu.gangRally`). 1 new poll per 2 min per user.
- **🥞 Bakisbrunchen**: create only 06:00–13:59 local (`not_morning`); lives to 16:00 (min 2 h); creator answers `ja`; one open per group (own older one replaced, someone else's → `brunch_open`); 1 per 2 min per user. Place = a café/restaurant near the user (places tiles) or typed text. Opening hours are not in our data → the card says "kolla innan".
- **🌯 Kebabtoppen** (food only): place = `bars_lite` row with type fast_food/restaurant (bars/pubs → `not_food`) or a `pl_<lat*1e5>_<lng*1e5>` id; caller position within 2 km; one rating per place per night (a second call changes it); tags whitelist `sas storst snabbast krispigast trevligast prisvard starkast raddare`. Town = `olnu_town_of` (else a ~50 km cell; `town:null`). Monthly list (Europe/Stockholm calendar month) uses each user's latest rating per place; rank avg desc, n desc, first rating.
- **💸 Skuldboken**: debts between current members only; net = Σ owed to − Σ owes (open). `paid` by debtor/creditor/writer, `unpaid` within 24 h, `cancel` by writer/creditor. Swish number: Swedish mobile `07xxxxxxxx` (+46/0046/spaces accepted), stored per group, visible to that group only (the UI says so), 20 changes. Client: "📱 Swisha" opens `swish://payment?data=<json {version:1,payee,amount,message}>` (widely used but not publicly documented) plus "📋 Kopiera nummer".
- **📰 Morgontidningen**: facts of last night only from the group's current members. The client draws a 1080×1350 canvas ("<TOWN> KVÄLLSPOST", 1 big + 3 small headlines from 80 templates, seeded by group+night so everyone sees the same paper) with Web Share (files) / download. Never drink counts; tease kindly.

### Frontend (gang.js)
- ONE HUD chip `data-hx="gang"`: "🗳️ Rösta!" (open poll, not voted) › "🤔 Rösta!" › "🥞 Brunch?" (06–14, not answered) › "📰" (05–15, paper of last night not opened; `olnu.gangPaper`).
- Group list (`groupItem`): "🍻 Gänget" button with a summary (🗳️!/✓ · 🏆 bar · 🤔 · 🥞 n · 📖 n / 🔒 n · 💸 ±kr · 📰) → sheet with tabs 📖 Citat / 🤔 Troligt / 🗳️ Vart? / 🥞 Brunch / 💸 Skulder / 📰 Tidning / 🌯 Kebab (`olnu.gangTab`). The open sheet refreshes `gang_group` every 3 s on the live tabs, else every 15 s; not while typing.
- Chat (social.js): long-press/double-tap menu gets "📖 Citat" (`GANG.chatPick`) → `add_quote` with `p_msg_id`.
- 🏆 sheet (`topSheet`): "🌯 Kebabkungen i <Stad>" top 10 + "Betygsätt". Food place popup (`barPopupHTML`, place type fast_food/restaurant): "🌯 Betygsätt käket".
- `gang_poll` with the app poll (max every 45 s). Toasts (in-app, once per night, `olnu.gangSeen`): new round, new poll, poll winner, brunch call, "📖 Gårdagens citat" after 10:00; first poll after opening shows max 2.
- Later push events (not built; notify-group is owned elsewhere): `gang_quotes_revealed` (10:00, once per group per day), `gang_mt_round` (new round), `gang_poll` (new poll + winner), `gang_brunch` (brunch call), `gang_paper` (morning paper ready), `gang_debt` (new debt to you / marked paid).

### Chat history switch (0029, social.js)
- Chat sheet: "💾 Spara chatten efter kl 05" switch (`group_keep_history` / `set_group_keep_history`; hidden when the RPC is missing; `not_admin` → "Bara den som skapade gruppen kan ändra det."), the footer note changes to "💾 Sparas i gruppen.". "⬆️ Visa äldre" appears when the first page had 100 messages: it steps back in id windows with `group_msgs(p_after_id)` (ids are global, max 12 calls per press, 100 messages per press). A cleaner server RPC would be `group_msgs_before(p_group_id, p_before_id)` (newest 100 with id < before).

## v22 GRUPPCHEF + LÄGESRAPPORT (+ stacked call-outs; additive)
Migration `supabase/migrations/0030_chief_status.sql` (applied on the server 2026-10-18 as `0030_chief_status`; appended to `setup.sql`). Needs 0001–0029 (groups, group_members, group_msgs, chat_photos, olnu_uid, olnu_night_of, olnu_next_expiry). Contains no removing statements (rows are never removed; reads filter on time). Client: `docs/js/chief.js` (`window.CHIEF`) + `docs/chief.css`; uses `PHOTO._shrink/_viewer/_url/_remember` from photo.js. A missing RPC (old database) = no chief row, no chip, no banner.

### Tables (RLS on, no policies, no client access; service_role has all)
- `group_chiefs(group_id pk, user_id, set_by, updated_at)` — the appointed chief.
- `status_reqs(id, group_id, user_id = chief, night, created_at, ends_at = created_at + 10 min, notified)` — `notified` is the push claim.
- `status_answers(req_id, user_id, photo_id → chat_photos.id, msg_id → group_msgs.id, created_at)`, pk `(req_id, user_id)`.
- Chief rule (`olnu_chief_of`): the appointed one while still a member, else `groups.created_by` while a member, else the member who joined first.
- Member keys are opaque: `k = md5(group:user:olnu-chief)[0:12]` (never a user id).

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `chief_state` | `p_group_id uuid` | jsonb `{group_id, chief_k, chief_name, is_chief, is_creator, can_hand, members[{k,name,is_me,is_chief}], used, max: 6, next_at, req}` — `req` = newest request of the last 2 h (status report shape) or null | `not_member` |
| `set_chief` | `p_group_id uuid, p_k text` | `chief_state` | `not_member`, `not_allowed` (only the chief or the creator), `invalid_member` |
| `request_status` | `p_group_id uuid` | status report of the new request | `not_member`, `not_chief`, `status_slow` (1 per 20 min per group), `status_limit` (6 per group per night, night = since the last 05:00) |
| `status_report` | `p_req_id bigint` | jsonb `{id, group_id, group_name, by, by_me, created_at, ends_at, now, late_until, needed, answered, done, mine, answers[{k,name,is_me,is_chief,photo_id,msg_id,at,sec,in_time,rank}], missing[{k,name,is_me}]}` (requests ≤ 12 h old) | `status_not_found`, `not_member` |
| `my_status` | — | jsonb array of status reports, all my groups, requests of the last 70 min, newest first | — |
| `answer_status` | `p_req_id bigint, p_b64 text, p_w int default 0, p_h int default 0, p_caption text default null` | jsonb `{photo_id, msg_id, rank, in_time, sec}` | `status_not_found`, `not_member`, `status_closed` (> 60 min after the start), `status_answered` (one per member), `invalid_photo` (same checks as `post_photo`), `invalid_msg` (caption > 100) |

Rules:
- `needed` = members who joined before the request, without the chief who asked (the chief may answer too, never "missing"). `answered` counts in-time answers of `needed` members. `done` = past `ends_at`, or every needed member answered in time.
- `answer_status` writes a normal chat photo (same as `post_photo`, same 0029 keep-history trigger): chat body `"📷 🎖️ Lägesrapport"` or `"📷 🎖️ Lägesrapport: <caption>"`. It does NOT count against the post_photo limits (it is limited to one per request and member). Late answers (after 10 min, up to 60 min) are kept with `in_time = false`.
- No penalty for a missed report; the client shows a fun "saknas i strid" line only.

### Edge function `notify-group` — new body event (v16 of the function)
- `{event:"status_req", req_id}` → every other member of that group. The row must be the caller's, < 3 min old, `notified = false` (atomic claim → true). Title from `STATUS_LINES` (15, `{namn}` = chief), body `"Ta ett foto på vad som händer – 10 min · <grupp>"`, url `/?status=<id>`, tag `olnu-status-<id>`, TTL 600 s. Reasons: `no_req`, `no_group`.

### Deep link
- `?status=<id>` opens the report sheet. App open: sw.js posts the url → `app.js routeOpen` → `mods("openStatusLink", id)`. Cold start: chief.js reads `location.search` in `onAuthed` / `onReadyShow` (returns "chief" so the notification question waits) and removes the param.

### Frontend (chief.js)
- Grupper sheet (`groupItem`): "🎖️ Gruppchef: X" + "Lämna över" (chief or creator → member chips → `set_chief`); latest report line (live countdown or "Visa"); for the chief "📸 Begär lägesrapport" (disabled with "Nästa om N min" / "Max 6 ikväll") + "n/6 ikväll".
- Request → `request_status` → `notify-group status_req` → the report sheet opens for the chief.
- Members: `my_status` on every poll (≥ 20 s apart) and on `visibilitychange`; a new request → toast once + fixed banner (bottom, above the dock) "📸 Lägesrapport! Ta ett foto på vad som händer · 9:41 · 📸 Foto · ✕" + urgent HUD chip `📸 9:41` (`hx-urgent`). Countdown from the server clock (`now`), 1 Hz text tick, no flashing.
- 📸 → file picker (camera or library) → `PHOTO._shrink` (≤ 1024 px JPEG ≈ 120 KB, no EXIF) → preview with countdown + optional text → `answer_status`. Toasts: first in ("🥇 Först in!…"), normal, late.
- Report sheet (refresh every 6 s while open): head (group, asked by, countdown / "Rapporten ä klar", n/m), "📸 Skicka min rapport" when I have not answered (late: "Skicka ändå"), photo grid (🥇 first, 🐢 last in time, ⏰ late; tap = PHOTO viewer), when done: "I tid", "Först in", "Sist in (men in)", "Kom sent", one "🫥 <namn>: Saknas i strid. …" line per missing member (seeded, 10 variants), or an "alla i tid" line.

### Stacked call-outs (rally.js, client only; no server change)
- Call-outs of ONE group that point to the same place are one stack: same bar (`barOf`, ≤ 60 m), or ≤ 60 m apart, or the same place text when neither has a position. Banner, bar-popup "Inkallelser" row, map pin, Grupper card and the detail sheet show one stack: every sender + message, one "N på väg" (distinct `yes_names`), one ✅ Kommer.
- Heading by stack size: 1 "Förstärkning begärd", 2 "Två trupper kallar – det brinner", 3 "LARM: hela plutonen behövs", 4+ "TOTALMOBILISERING" — 16 lines per level (sv; 6 en), stable per stack and level, no line used twice in one night (localStorage `olnu.rallyHeads`). Colours: green → amber → orange → red; level 4 has a soft 0.6 Hz glow (off with reduced motion).
- ✅ Kommer / 🤔 / ❌ on a stack answers EVERY call-out of the stack that is not mine (`answer_rally` per id + `rally_yes` push per id, so each sender sees it). A push action button (`?rally=<id>&answer=yes`) answers only that call-out, then the sheet shows the whole stack. "✕ Stäng" per own call-out in the sheet. 2 h expiry (0025) unchanged.
- `RALLY.barBadges()` now returns per bar `{bar, rallies: [one light row per stack: {id, yes (combined), my_answer, is_mine, n}], stacks}`; `RALLY.stacks()` is new; `RALLY.list()` still returns raw rows.

## v21 BILDER (photos in the group chat; additive)
Migration `supabase/migrations/0028_chat_photos.sql` (applied on the server 2026-10-17 as `0028_chat_photos`; also appended to `setup.sql`, after 0029). Needs 0001–0021; uses 0029 (keep history) when it is there. Client: `docs/js/photo.js` (`window.PHOTO`) + `docs/photo.css`. A missing RPC (old database, PGRST202) = no 📷 button, no error; the "📷 …" chat rows stay plain text.

### Table (RLS on, no policies, no client access; rows are never removed, reads filter on time)
- `chat_photos(id, group_id, user_id, msg_id → group_msgs.id, mime 'image/jpeg'|'image/webp', bytes bytea null, size, w, h, created_at, expires_at)`. `expires_at` = next 05:00, or `infinity` when the group keeps its chat (0029 insert trigger `olnu_keep_history_ins`). Switching keep on/off (`group_settings` trigger `olnu_photo_keep_tg`) moves the group's live photos to infinity / back to the next 05:00, same as messages and voice.
- **Space** (free plan: 500 MB DB): every `post_photo` first runs `update chat_photos set bytes = null where expires_at < now()`; the row stays (no removal), autovacuum reuses the space. Infinity rows never match. A keeping group can store up to 60 × ~120 KB ≈ 7 MB per night, forever — watch DB size (owner stats / dashboard) if many groups keep history.
- **Radera allt om mig**: the 0016 sweep moves `user_id`; trigger `olnu_photo_anon_tg` then empties `bytes` and ends the photo.

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `post_photo` | `p_group_id uuid, p_b64 text, p_w int default 0, p_h int default 0, p_caption text default null` | jsonb `{id, msg_id, created_at, expires_at, left, mime}` | `not_member`, `invalid_photo` (bad base64, not JPEG `FF D8 FF` / WebP `RIFF…WEBP`, < 200 B or > 160 KB, w/h not 1–2048), `invalid_msg` (caption > 138 chars), `slow_down` (1 per 15 s per user), `photo_limit` (10 per user per night), `group_photo_limit` (60 per group per night) |
| `group_photos` | `p_group_id uuid, p_after_id bigint default 0, p_before_id bigint default null` | setof `(id, msg_id, w, h, size, created_at, is_me)` — live photos with bytes, newest 100 (`id > p_after_id`, and `id < p_before_id` when given), oldest first, no bytes | `not_member` |
| `group_photo` | `p_photo_id bigint` | jsonb `{id, mime, w, h, b64}` | `photo_not_found` (expired / emptied / unknown), `not_member` |

Rules:
- `post_photo` also inserts a normal `group_msgs` row (same transaction, same `created_at`): body `"📷"` or `"📷 <caption>"` (caption cleaned, ≤ 138 so the body stays ≤ 140). Old apps show that text; it counts as a chat message (medals, missions, flood guard). The link is `chat_photos.msg_id`.
- "Night" for the limits = created since the last 05:00 Europe/Stockholm (DST-correct), so infinity rows count too.

### Client (photo.js)
- 📷 button next to the chat input (only after `group_photos` answered). `<input type=file accept=image/*>` (the phone offers camera + library). The phone decodes with `createImageBitmap(file, {imageOrientation:'from-image'})` (EXIF rotation), draws on a canvas (max 1024 px long side), JPEG q 0.7 → lower quality, then smaller, until ≤ 120 KB. The canvas re-encode drops all EXIF (GPS, phone model). Preview overlay: image, caption (≤ 138), "🔒 Bilden syns bara för gruppen och försvinner kl 05." (keeping group: "…Gruppen sparar chatten, så bilden ligger kvar."), size info, "Avbryt" / "📤 Skicka". 15 dalmål toasts on success.
- Chat rows come from social.js; photo.js watches the list (MutationObserver) and turns "📷" rows into image bubbles: match by `data-mid` (msg id) when social.js sets it, else by `data-at` = `created_at` + me/other. Rounded box sized from w/h (max 240 × 260 px), shimmer placeholder, image loaded only when scrolled into view (IntersectionObserver), cached in memory + IndexedDB (`olnu-photos`, cleared on each page load). Own photos are cached at send, never downloaded again. Unmatched older rows (history pages) → one `group_photos(p_before_id)` call per page.
- Tap = full-screen viewer (pinch / wheel / double-tap zoom, pan, tap outside or ✕ / Escape closes; the chat sheet stays). "💾 Spara" = download of the blob (iOS: share sheet with the file). Long-press / double-tap = the normal reactions picker (react_msg on the photo's msg id).
- Polls `group_photos(p_after_id)` every 6 s while the chat is open.
- Hooks: `PHOTO.init(api)` via `mods()`, `PHOTO.chatOpen(g, ctx)` from social.js (same ctx as `AFTER.chatOpen`). Until those lines exist, photo.js wraps `AFTER.init` / `AFTER.chatOpen` (guards make both paths safe together).
- Push: none yet. Wanted: `notify-group {event:"photo", photo_id}` → other members of the group, title e.g. "📷 {namn} skickade en bild" (+ caption), url `/?chat=<group_id>`, tag `olnu-photo-<group_id>`, 1 per sender per group per 2 min, atomic `notified` claim (needs a `chat_photos.notified` column).

## v20 TRUPPEN (crew pack; additive)
Migration `supabase/migrations/0027_crew.sql` (applied on the server 2026-10-17 as 0027_crew_a_tables_helpers / _b_group_json / _c_rpcs; also appended to `setup.sql`). Needs 0001–0025. Client: `docs/js/crew.js` (`window.CREW`, through `mods()`), `docs/js/crew-content.js` (`window.CREW_CONTENT`, all texts, sv dalmål + military with "ä", English fallback), `docs/crew.css`. A missing RPC (old server, PGRST202) = that feature hides, no error (`crew_poll` missing = everything off). In-app only: no pushes in this version.

### Tables (RLS on, no policies, no client access; rows are never removed, every read filters on time)
`crew_deps(id, group_id, user_id, night, leave_at, bar_id, bar_name, lat, lng, created_at, cancelled_at, notified)`, `crew_dep_going(dep_id, user_id, going, updated_at)`, `crew_date_polls(id, group_id, user_id, title, dates date[], created_at, ends_at, closed_at)`, `crew_date_votes(poll_id, user_id, d, answer kan|kanske|nej)`, `crew_byes(user_id, night, at, cleared_at)`, `crew_dance(id, bar_id, user_id, level 0–2, bar_lat, bar_lng, created_at, expires_at)`, `crew_torches(id, town, town_name, c_lat, c_lng, night, holder, pending, pending_from, pending_at, pending_until, passes)` unique (town, night), `crew_torch_hops(id, torch_id, from_group, to_group, how light|pass|random, by_user, bar_id, bar_name, lat, lng)`, `crew_tracks(id, user_id, night, at, kind ci|drink, bar_id, bar_name, lat, lng)`, `crew_moods(id, group_id, user_id, night, created_at, ends_at)`, `crew_mood_answers(mood_id, user_id, answer bra|snurr|hem)`.
- `crew_tracks` is filled by triggers: `olnu_crew_checkins` (check-in → bar point) and the deferred constraint trigger `olnu_crew_beers_end` (drink count up → re-reads the final row at commit; only visible, non-ghost pins; position = `snap_lat/snap_lng` = the bar point or the ~550 m grid point, never the exact pin, never a home). Max 300 points per user and night. Read only for the replay window (≤ 24 h after the night). Triggers never block a check-in or a drink.

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `crew_poll` | `p_lat, p_lng float8 default null` | jsonb `{v, server_time, night, me:{bye_at}, groups:[lite group state], torch, offers:[torch]}` (max 10 groups) | – |
| `crew_group` | `p_group_id uuid` | jsonb full group state (+ `members`, `going_names`, `kan_names`, mood `answers`) | `not_member` |
| `crew_dep_set` | `p_group_id, p_leave_at timestamptz, p_bar_id, p_bar_name text default null, p_lat, p_lng default null` | `{id, leave_at}` | `not_member`, `invalid_time`, `invalid_bar`, `slow_down`, `board_full` |
| `crew_dep_join` | `p_dep_id bigint, p_on bool default true` | `{i_going, going_n}` | `dep_not_found`, `not_member` |
| `crew_dep_cancel` | `p_dep_id bigint` | `{ok}` | `dep_not_found` (not creator) |
| `crew_dates_create` | `p_group_id, p_dates date[], p_title text default null` | `{id}` | `not_member`, `invalid_dates`, `invalid_msg`, `slow_down` |
| `crew_dates_vote` | `p_poll_id bigint, p_date date, p_answer text` | `{ok, d, answer}` | `invalid_answer`, `poll_not_found`, `not_member`, `invalid_dates` |
| `crew_dates_close` | `p_poll_id bigint` | `{ok}` | `poll_not_found` (not creator) |
| `crew_bye` | `p_on bool default true` | `{ok, bye_at}` | – |
| `crew_mood_start` | `p_group_id uuid` | `{id, already}` | `not_member`, `slow_down` |
| `crew_mood_answer` | `p_mood_id bigint, p_answer text` | `{ok, answer}` | `invalid_answer`, `mood_not_found`, `not_member` |
| `crew_dance_report` | `p_bar_id, p_bar_name text, p_bar_lat, p_bar_lng, p_lat, p_lng float8, p_level int` | `{ok, wait_seconds, n, avg, level, at}` | `invalid_level`, `invalid_bar`, `outside_sweden` (= invalid coordinates), `too_far` |
| `crew_dance_bar` | `p_bar_id text` | `{n, avg, level, at, wait_seconds}` | – |
| `crew_torch` | `p_lat, p_lng default null` | jsonb torch state (below) | – |
| `crew_torch_light` | `p_group_id, p_lat, p_lng default null` | `{ok, already, id}` | `not_member`, `no_town`, `not_out` |
| `crew_torch_pass` | `p_group_id uuid, p_key text` | `{ok, until}` | `not_member`, `no_torch`, `torch_pending`, `invalid_target` |
| `crew_torch_answer` | `p_group_id uuid, p_accept bool default true` | `{ok, holder}` | `not_member`, `no_offer` |
| `crew_replay` | `p_group_id uuid` | `{available:false, empty?, opens_at}` / `{available:true, night, evening, members:[{k, name, is_me, home_at, bye_at}], points:[{k, at, lat, lng, bar_name, kind}], summary:{members_out, bars, checkins, points, first_at, last_at, top_bar, torch}}` | `not_member` |

Group state: `{id, name, me_state, out_n, gone_n, alone:{k, name, is_me, bar_name}|null, deps:[{id, by, is_mine, leave_at, bar_id, bar_name, lat, lng, created_at, going_n, i_going, going_names(full)}], dates:{id, title, by, is_mine, closed, ends_at, voters, i_voted, winner, dates:[{d, kan, kanske, nej, my, kan_names(full)}]}|null, mood:{id, by, is_mine, created_at, ends_at, my, bra, snurr, hem, waiting, answers(full):[{k, name, is_me, answer, at, bar_name, near:[names]}]}|null, replay bool, members(full):[{k, name, is_me, state, bar_name, left_at, at}]}`. `k` = md5 member key, never a user id.
Torch state: `{id, town (null = ~50 km zone), night, passes, lit, no_town?, holder:{name|null, mine}, holder_bar, holder_group (only for members), pending:{to, to_group (only for members), from, at, until}|null, hops:[{at, how, bar_name, lat, lng, to:{name, mine}, by}], cands:[{key, label:{name, mine}, bar_name, n}] (holder members only), my_groups:[{id, name, n}]}`.

Rules:
- **Presence** (`olnu_crew_pres`): newest of a live check-in (< 3 h) and a live visible pin (not stopped, not ghost). Member states: `out` (presence newer than Hej då / Jag är hemma), `left` (Hej då), `home` (`after_nights.home_at`), `quiet` (was out tonight, no presence), `none`.
- **🚌 Avgångstavlan**: time between now − 1 min and now + 12 h (client sends the ISO time made from the phone's clock). 1 new departure per user per 30 s; a new one by the same user in the same group replaces the older; max 4 live per group; live until 15 min after `leave_at`. The creator is "Med!". T−5 and "Avgång!" are in-app toasts on every member's open app (client timers + poll).
- **🗓️ Vilken kväll?**: 2–5 distinct dates from tonight's evening date to +90 days; one open poll per group (a new one closes the old). Ends 05:00 after the last date. Winner = most `kan`, then `kanske`, then fewest `nej`, then earliest; needs ≥ 1 kan/kanske.
- **👋 Ingen lämnas kvar**: `crew_bye` = Hej då for all groups tonight (`p_on=false` undoes). A newer check-in / drink after Hej då = out again. **Alone card** when exactly one member is `out` and at least one member is `left`/`home`/`quiet`: "{namn} ä kvar ensam på {bar} — nån som hänger kvar eller följer hem?" (bar name only from the check-in / snapped bar).
- **💬 Hur mår truppen?**: one live check per group (40 min; starting again returns it, `already`); max 1 new per user per 10 min. `near` (for 😵 answers only) = other `out` members within 400 m (server positions; names only). The client shows water / food / taxi tips (`EXTRAS.taxiHTML`, `AFTER.showKebab`).
- **🕺 Dansgolvsmätaren**: caller within 300 m of the bar (server uses the `bars_lite` point when the bar is known); 1 report per user per bar per 10 min (`ok:false` + `wait_seconds`); a report lives 30 min; `level` = weighted average (newer weighs more), rounded. Shown in the bar popup (`barPopupHTML`, class `cr-dance`); not for restaurants/cafés.
- **🔥 Skålstafetten**: one torch per town per night (town = nearest `olnu_towns` town, else a ~50 km zone; from the caller's presence, else `p_lat/p_lng`). Lit by a group with a member out in that town. Candidates = other groups with members out in the same town (Hej då/home not counted). Names only when the viewer is a member or the group opted in (`group_flags.show_on_map`, 0014); else client "en grupp vid <bar>" / "en grupp i stan". A pass waits 10 min for accept; timeout or "Låt den gå vidare" → a random other group in town (not the giver, not the decliner); nobody else → it stays with the holder. Route points = bar points only (from check-ins / snapped pins), never homes. Client: dotted line + 🔥 at zoom ≥ 11 (pane `crewtorch`), route list in the Truppen sheet and the 🏆 sheet.
- **📼 Kvällsrepris**: available 05:00–18:00 local the day after (last night = `olnu_night_of(olnu_night_of(now) − 26 h)`, DST-safe), current members' points of last night only. Client plays 20–40 s on the map (pane `crewreplay`, dots move only in the last 15 min before the next point), slider + pause, summary card at the end (places, check-ins, time span, top bar, torch count, home times — no drink counts). `olnu.crew_now` is a server-side test setting only (clients cannot set it).

### Frontend
- Group list (`groupItem`): alone card + one "🎖️ Truppen" button with a summary (🚌 22:30 · 🗓️ fre 24/10 · 💬 ? · 👋 2 · 🔥 · 📼) → sheet with tabs Avgång / Kväll? / Läget / Facklan / Repris (default tab picks what needs attention).
- ONE HUD chip at most (`hudChipsHTML`, `data-hx="crew"`): 🔥 Ta emot! (torch offer) > 🚌 N min (departure within 30 min) > 💬 Läget? (unanswered check).
- Polls `crew_poll` with the app poll (max every 40 s; no poll while hidden); the open sheet refreshes `crew_group` every 20 s. Toasts once per item (`olnu.crewSeen`, per night); first poll after opening max 2.
- `stopSheet`: "👋 Säg hej då till truppen" when in a group and not said yet. `onStopped("home")` re-polls (server counts `home_at` as left).
- Wanted pushes later (notify-group, not done): `dep` (new departure → group), `dep_t5` (T−5 to members who said Med!), `dates` (new poll + winner when closed), `mood` (check started → group), `alone` (caring card → group-mates of the alone member, once per night per member), `torch_offer` (→ receiving group), `torch_got` / `torch_random` (→ new holder group).

## v23 ÖNSKELISTAN + GRUPPDUELLEN (additive)
Migration `supabase/migrations/0031_wishes_duels.sql` (applied on the server 2026-10-18 as `0031_wishes_duels` + `0031_wishes_duels_b_side_inclusive`; also appended to `setup.sql`). Needs 0001–0029 (`chat_photos` from 0028 is optional). No row is ever removed (status flags + time filters). Client: `docs/js/wish.js` (`window.WISH`), `docs/js/duel.js` (`window.DUEL`), `docs/duel.css` (both). A missing RPC (old database, PGRST202) = that feature hides, no error. In-app only: no push events.

### Tables (RLS on, no policies, no client access)
`feature_wishes(id, user_id, name 1–30 null, body 3–500, category kartan|grupper|chatt|lek|texter|annat null, created_at, status ny|planerad|byggs|klar|nej|dold, status_at, votes)`, `wish_votes(wish_id, user_id, active, created_at, updated_at)`, `duels(id, group_a = challenger, group_b, created_by, via qr|code|near, status pending|active|declined|cancelled|expired, created_at, answer_by, answered_by, accepted_at, ends_at = 05:00, finished_at, drinks_a/b, spirit_a/b, winner a|b|draw)`, `duel_sides(duel_id, user_id, side a|b, first_at, changed_at, changes)`, `duel_tokens(token 8 chars, group_id, user_id, created_at, expires_at)`, `duel_open(group_id, open)`, `duel_log(user_id, kind drink|checkin|skal|photo, n, at)` (filled by triggers on `beers` (drink delta, −1 after undo), `checkins`, `skals`, `chat_photos`; only users in a group; triggers never block the write). View `owner_wishes_v` (all wishes, votes desc, newest; no user ids; no grants for anon/authenticated → SQL editor / execute_sql only).

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `submit_wish` | `p_text, p_category default null, p_name default null` | jsonb `{id, dup, left_today, votes}` | `invalid_wish` (3–500 chars after cleaning, no links), `invalid_category`, `slow_down` (5 per user per Stockholm day; 1 per 15 s) |
| `vote_wish` | `p_wish_id bigint` | jsonb `{votes, mine}` (toggle) | `wish_not_found`, `slow_down` (40/min) |
| `top_wishes` | `p_limit int default 30 (1–100), p_category default null` | setof `(id, body, category, name, votes, status, created_at, mine, is_mine)` — not `dold` (own always), open first, votes desc, newest | – |
| `owner_wishes` | `p_key text` (owner key, anon allowed) | jsonb `{generated_at, total, wishes:[{id, body, category, name, votes, status, created_at}]}` max 1000 | wrong key → 403 `forbidden` (logged like owner_stats), `rate_limited` |
| `owner_set_wish` | `p_key, p_wish_id, p_status` | jsonb `{ok, status}` | `invalid_status`, `wish_not_found`, 403 |
| `duel_invite` | `p_group_id` | jsonb `{token, expires_at, group_name}` | `not_member`, `slow_down` (20 tokens/h), `code_generation_failed` |
| `duel_token_info` | `p_token` | jsonb `{group_name, members, expires_at, mine, groups:[{id, name, state ok\|same\|dueling\|full}]}` | `token_not_found` |
| `duel_accept_token` | `p_token, p_group_id` | duel json + `already bool` | `token_not_found`, `not_member`, `same_group`, `too_many_duels` |
| `duel_challenge` | `p_group_id, p_code default null (group code), p_handle default null (from duel_nearby)` | duel json (status pending) | `not_member`, `group_not_found`, `same_group`, `already_dueling`, `too_many_duels`, `slow_down` (1/20 s) |
| `duel_answer` | `p_duel_id, p_accept bool` | duel json | `duel_not_found` (not in the challenged group), `duel_over` |
| `duel_cancel` | `p_duel_id` | `{ok}` | `duel_not_found`, `duel_over` |
| `duel_pick_side` | `p_duel_id, p_group_id` | duel json | `duel_not_found`, `not_both`, `duel_over`, `invalid_side`, `side_locked` |
| `duel_set_open` | `p_group_id, p_on bool` | `{open}` | `not_member` |
| `duel_nearby` | `p_group_id, p_lat, p_lng` | jsonb `{open, groups:[{handle, name, members, out}]}` | `not_member`, `outside_sweden` (= invalid coordinates) |
| `duel_poll` | – | jsonb `{v, server_time, night, open:[group ids], duels:[duel json]}` (max 40) | – |

Duel json (caller's view): `{id, status pending|active|done|expired|declined, via, incoming, outgoing, created_at, answer_by, accepted_at, ends_at, finished_at, group:{id, name, wins}, opp:{name, members, wins}, us:{drinks, spirit, members, undecided}, them:{…}, both, needs_pick, pick:{group_id, can_switch, locked_at}|null, sides:[{id,name}]|null (only for a member of both), winner us|them|draw|null}`. Never user ids or member names of the other group.

Rules:
- **Önska**: text one line (control chars → space), 3–500 chars, no links. Same text as a visible wish → no new row, the caller's +1 goes on that wish (`dup`). The writer's own +1 is added automatically. `name` only when the user ticks "Visa mitt namn". Owner statuses: `ny` (default), `planerad`, `byggs`, `klar`, `nej`, `dold` (hidden from everyone but the writer). Owner: docs/stats.html section "💡 Önskelista" (sorted votes → date, status select) or `select * from owner_wishes_v;`.
- **Duel start**: QR = `duel_invite` token (8 chars, 30 min, never past 05:00, reused while > 10 min left, many opponents may use it), link `./?duel=TOKEN`. The scanner taps "⚔️ Anta för <grupp>" → `duel_accept_token` → live at once (a pending challenge between the pair is accepted; a live one is returned with `already`). Fallback: `duel_challenge` with the other group's 6-char group code or a `duel_nearby` handle → pending for 30 min; any member of the challenged group answers. `duel_nearby` lists only groups that switched on `duel_set_open`, with ≥ 1 member out tonight (visible non-ghost live pin or live check-in) within 30 km; handle = md5(group, night) — never the group id or code.
- **Limits**: one live/pending duel per pair per night; max 10 live + pending duels per group per night (`too_many_duels`).
- **Score**: `drinks` = plain sum of `duel_log` drink deltas (beer + other drinks) since `accepted_at` until `ends_at`, per counted member, floored at 0 per member; no cap. The server's 10-min gap between drinks is unchanged. `spirit` (Truppanda) per member = min(3, check-ins)×3 + min(10, skål given) + min(3, photos)×2 — side stat + tiebreaker. Winner: more drinks; tie → more spirit; else `draw`. Counted members = current members of that group; a member of BOTH groups counts only for the side picked in `duel_sides` (before picking: for neither; `undecided` shows how many). Pick: any time while pending/live; one switch within 10 min of the first pick; then `side_locked`. Per duel.
- **End**: at `ends_at` (05:00 local). `duel_poll` settles ended duels (stores drinks/spirit/winner, idempotent, advisory lock) and returns them for 16 h (winner card). `opp.wins` / `group.wins` = all-time duel wins (the group medal count).

### Frontend
- **wish.js**: entry "💡 Önska en feature" in ⚙️ (`settingsSheet`), at the bottom of the 🏆 sheet (`topSheet`), and a small "💡 Önska" chip in the HUD Ikväll panel (`hudChipsHTML`/`hudClick` `data-hx="wish"`; `HUD_ALWAYS` in wish.js — with it the Ikväll pill also shows at 0 drinks). Sheet: textarea (counter /500), category chips, "Visa mitt namn", send, "🔥 Mest önskat" (top 30, "👍 Jag vill också · n" toggle, status badge). 20 thank-you toasts (dalmål, never twice in a row).
- **duel.js**: group row button (`groupItem`) "⚔️ Utmana grupp" / "⚔️ Dueller" + summary. Sheet per group: pick cards (member of both), duel table when 3+ live/done duels, one card per duel (score, tug-of-war bar, 42 commentary lines (start/lead/behind/tied/big) — rivalry only, never "drink more/faster", drinks/members/Truppanda rows, time left, wins), pending answer/cancel, winner card with 🥇. Challenge: "⚔️ Visa utmaningskod" (QR + code + copy/share), type a code (8 = duel token → accept sheet, 6 = group code → challenge), "📍 Grupper nära er ikväll" + "Låt grupper nära oss utmana oss". HUD chip (`data-hx="duel"`): incoming › pick side › winner card › live score. Toasts once per event (`olnu.duelSeen`). `duel_poll` on auth and with the app poll (max every 30 s; every 15 s while the sheet shows a live duel). Deep link `?duel=TOKEN` is read and removed by duel.js; it opens the accept sheet after sign-in and the intro.

## v24 KVÄLLENS FÖRLOPP (Morgontidningen story; additive)
Migration `supabase/migrations/0032_night_story.sql` (applied on the server 2026-10-18 as `0032_night_story`; also appended to `setup.sql`). Needs 0001–0031. Read only: no new tables, two new indexes (`crew_tracks (night, bar_id, at)`, `duel_log (kind, user_id, at)`). Client: `docs/js/gang.js` (`renderPaper`, `storyModel`, `drawStory`) + texts in `docs/js/gang-content.js` (`GANG_CONTENT.story`). A missing RPC (old database, PGRST202) or a thin night = the classic 1080×1350 paper from `gang_paper`.

### RPCs (authenticated only, SECURITY DEFINER, members only via `olnu_uid()`)
| name | params | returns | errors |
|---|---|---|---|
| `group_night_story` | `p_group_id uuid, p_night date default null` (= the evening date, `olnu_evening`; null = the night that ended last; a later date is capped to tonight) | jsonb (below) | `not_member`, `not_authenticated` |
| `night_story_photo` | `p_photo_id bigint` | jsonb `{id, mime, w, h, b64}` — a group photo from the last two nights while its bytes are still there (also after 05:00) | `photo_not_found`, `not_member` |

`group_night_story` json (night = 05:00–05:00 Europe/Stockholm, same rule as `olnu_next_expiry`): `{v:1, night (05:00 end), evening, from, to, group_name, town, ready (drinks or check-ins),
members:[{k, name, is_me, drinks, first_at, last_at, hours:[{h:"22", n}], checkins, bars, first_ci, skal_given, skal_got, home_at, out}],
checkins:[{at, k, name, bar, bar_id, from_bar}] (crew_tracks 'ci', one row per bar change, max 80),
arrivals:[{at, last_at, bar, bar_id, n, names[], ks[], from_bar (most common previous bar = a move), first, met_n (other app users checked in at the bar −60/+30 min, count only), met_group (name of a duel opponent group with a member there, or null)}] (check-ins at the same bar within 30 min merged; max 30),
rallies:[{id, at, by, by_k, place, body, yes, yes_names[], maybe, no, etas:[{name, minutes, eta_at, arrived_at}]}] (max 12; NOTE: yes/yes_names include the creator's automatic yes — the client removes `by`),
drinks:{total, hours:[{h, at, n}], peak:{h, at, n}|null, first_at, last_at} (from `duel_log` drink deltas, undo = −1, floored at 0; member `drinks` = max(log, medal_nights beers+others)),
skal:{total, top:{name, n}|null}, status:[{at, by, needed, answered, fastest:{name, sec}|null}] (0030),
duels:[{at, opp, status, winner us|them|draw|null, us, them}] (0031, accepted duels ending this night),
chat:{texts (count of text rows), top:[{name, body, at, reacts, emoji}]} (max 6, most reactions = active `group_msg_reacts` + liked `group_msg_likes`; no 📷 photo rows, no 📣 tips; only current members),
photos:[{id, by, at, w, h, reacts, caption, status (lägesrapport photo)}] (max 4 by reactions then newest; only rows with bytes, expired included), photos_n, voice_n}`. Never user ids.

### Frontend
- The 📰 tab calls `gang_paper` and then `group_night_story` with `p_night = gang_paper.evening`. Story paper: masthead "<TOWN> KVÄLLSPOST" (black/yellow/red, Black Ops One), EXTRA kicker, headline from the strongest event (duel win > meeting another group > rally > peak hour > bars > status > total > photos > crowd; else the classic headline), the top photo as front image (cover crop + "BILDBEVIS: <namn> kl. HH:MM – caption"), "KVÄLLENS FÖRLOPP" timeline (open, arrivals, moves, meets, rally/ETA, peak hour "22:00–23:00", status, duels, first photo, last drink, first home; max 10, trimmed by priority), CITAT box (1–2 chat quotes, else Citatboken), photo strip (up to 3), MEDALJREGN (Kvällens general, Längst ute, Törstigast, Skålmästare, Stigfinnaren, Krigsfotografen, Snabbast till fronten; max 4), stats row (drycker, krogar, skål, inkallningar, bilder), voice-count line.
- Canvas 1080 wide, height grows to fit (min 1350, aim ≤ 2400; shrink order: timeline 8 → no sub line → compact photo → timeline 7 → one quote → no strip → timeline 6 → 3 medals → timeline 5 → no voice line).
- Photos: `PHOTO._url(id)` first (cache / `group_photo`), then `night_story_photo`; drawn from blob URLs so the canvas is never tainted (`toBlob`, share and save keep working). A photo that fails to load is skipped (a strip photo takes the front spot).
- Texts: `GANG_CONTENT.story.big` (11 kinds) and `.line` (19 kinds), ≥ 15 dalmål/military variants each; seeded per group + night; a paper never shows the same line twice.
- Thin night (< 2 timeline lines, or timeline + photos + quotes < 4) → classic paper.

## v25 ROLLER + TA BORT MEDLEM + HEMSTAD + GRADER UTAN ORTNAMN (additive)
Migrations `0033_home_town.sql`, `0034_roles_remove.sql`, `0035_titles_no_places.sql` (applied on the server 2026-10-20 under the same names; also appended to `setup.sql`). Needs 0001–0032. No migration contains a row-removing statement. Client: `docs/js/chief.js` (roles, group page, member actions), `docs/js/social.js` (Medlemmar list, chat names), `docs/js/hometown.js` (`window.HOMETOWN`, through `mods()`), `docs/js/boards.js`, `docs/hometown.css`. A missing RPC (old database, PGRST202) = that part hides (old RPCs are used).

### Roles (owner decision 2026-10-20, enforced on the server)
- **👑 Ägare** = `groups.created_by` while a member. Never moved, never removable. When the owner is not a member (left / erased), the gruppchef holds the owner powers.
- **🎖️ Gruppchef** = 0030 `olnu_chief_of`. Only owner powers can change it (`set_chief`; before v25 the chief could too).
- **🎗️ Vice gruppchef**: any number. Only owner powers add / clear a vice (`set_vice`). The owner and the chief cannot be vice; a new chief stops being vice. A vice role belongs to one membership (`member_since = joined_at`): leaving / being removed and joining again = plain member.
- **Lägesrapport**: the chief or any vice (`request_status`); limits per group as before (1 per 20 min, 6 per night).
- **Acting chief**: when the chief shows no sign of life for 12 h (`mark_seen` app ping, a drink, a chat message, joining, being made chief), the vice appointed first who was seen in the last 12 h is acting (`acting_k`). Shown in the app; vices already have the chief's powers except removing the chief / vices.
- **Ta bort medlem**: owner powers remove anyone except themselves and the owner. The chief and vices remove plain members only (a vice never removes the chief or another vice; the chief never removes a vice). Nobody removes themselves (Lämna). 20 removals per remover per hour. A removed chief → the chief role goes back to the owner; a removed vice loses the role. The removed user can rejoin only with the code.
- **How the row goes**: `remove_member` writes an archive row (`group_members_removed`), then runs the existing `leave_group()` for the target by switching the transaction-local JWT claim (`request.jwt.claims` / `request.jwt.claim.sub`) to the target for that one call and back (checked; any error rolls back). So every "row exists = member" query stays right.

### Tables (RLS on, no policies, no client access; service_role has all; the 0016c erase sweep moves their uuids)
`group_vices(group_id, user_id, member_since, active, set_by, created_at, updated_at)` pk (group_id, user_id) · `group_members_removed(id, group_id, user_id, display_name, joined_at, group_name, removed_by, removed_at, seen)` · `user_seen(user_id pk, seen_at)` · `user_home(user_id pk, town, updated_at, changes)`.

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `remove_member` | `p_group_id uuid, p_user_id text` (the member key `k` from chief_state / group_status_v2, or a uuid string) | jsonb `{ok, name, group_name, state}` (`state` = chief_state) | `not_member` (caller or target), `not_allowed`, `cannot_remove_creator`, `cannot_remove_self`, `slow_down` |
| `set_vice` | `p_group_id uuid, p_k text, p_on bool default true` | chief_state | `not_member`, `not_allowed`, `invalid_member` |
| `set_chief` | unchanged params | chief_state | `not_allowed` now = not owner powers |
| `request_status` | unchanged | unchanged | `not_chief` = neither chief nor vice |
| `group_status_v2` | `p_group_id uuid` | setof group_status columns + `k, is_owner, is_chief, is_vice, is_acting, home_town, can_remove, joined_at` | `not_member` |
| `my_removals` | – | jsonb `[{group_name, at}]` not shown before (14 days); marks them shown | – |
| `mark_seen` | – | void (max one write per 60 s) | – |
| `set_home_town` | `p_town text` ('' clears) | jsonb `{town}` | `invalid_town` (1–30 chars; letters, digits, space, `. , ' ’ ( ) & / -`; needs a letter), `slow_down` (1 per 3 s, 40 per day) |
| `my_home_town` | – | jsonb `{town}` | – |
| `local_board_v2` / `wall_of_fame_v2` | as v1 | v1 columns + `home_town` (null when the name is hidden) | as v1 |
- `chief_state` json gets new fields at the end: `my_k, owner_k, owner_name, is_owner, is_vice, owner_powers, can_vice, can_req, can_remove, vices[{k,name,is_me}], chief_idle, acting_k, acting_name, is_acting, chief_home, owner_home`; `members[]` get `is_owner, is_vice, is_acting, home_town, can_remove`. `can_hand` = owner powers (old apps show "Lämna över" only to the owner).
- `group_msgs` (RETURNS TABLE) cannot grow: chat names get roles and home town from `group_status_v2` (by name, like the rank).

### Ranks (0035)
`olnu_titles()`, notify-group `TITLES` (function v17) and `docs/js/social.js TITLES` renamed every title with a place name (same 36 thresholds, same order; table in v11 above). The client ladder key `olnu.ladder` is now `"12"`, so a renamed rank shows the quiet "Armén har fått nya grader!" toast, not a BEFORDRAN. The level-up push only fires for a rank reached just now, so the renaming sends no pushes.

### Frontend
- Group page (chief.js `groupItem`): "🎖️ Gruppchef: X <demonym>", "👑 Ägare: Y · 🎗️ Vice: A, B", acting line; "Roller" (owner powers) → sheet with chief chips and vice toggles; "📸 Begär lägesrapport" for chief and vices.
- Medlemmar (social.js `showStatus`, `group_status_v2`): badges 👑 Ägare / 🎖️ Chef / 🎗️ Vice (+ Tjänstgörande chef) and the demonym. Tap a member → action row (🎖️ Uniform, owner: 🎖️ Gör till chef, 🎗️ Gör till vice / Ta bort vice; anyone allowed: 🚪 Ta bort ur gruppen → inline "Säker? {namn} åker ut ur {grupp}" → toast). No actions → the uniform opens as before.
- Chat names: rank + name, then small role badges and the demonym.
- 🏆 boards: "· Ludvikabo" after a shown name.
- Removed user: `my_removals` (chief.js poll, max every 5 min) → toast "🚪 Du ä utplockad ur {grupp} …" with "👥 Grupper".
- 📍 Hemstad (hometown.js): ⚙️ row under the name field (hook `settingsName` in app.js) → searchable list (52 taxi towns + CITIES + more, each with its demonym) or free text; one gentle toast after the next level-up ("📍 Var är du mest baserad?"), only once (`olnu.homeAsked`), after the BEFORDRAN popup and never while the beer-type strip is up (`OLNU_STRIP`). Demonym map in `HOMETOWN.DEMONYM` (e.g. Ludvikabo, Smedjebackare, Grängesbergare, Grangärdebo, Borlängebo, Faluguing, Stockholmare, Göteborgare, Malmöbo, Kirunabo); unknown → "från {stad}" (English "from {town}").

## v26 MERITER (ranks earned by meriter, not by total beers; additive)
Owner decision 2026-10-20, web and app alike. Migrations `0036_meriter.sql` (ledger, triggers, ladder, RPCs), `0036_meriter_b_rpcs.sql` (poll_v2 / my_wrapped patched in place), `0036_meriter_c_backfill.sql` (history backfill) — applied on the server 2026-10-20 under the same names; appended to `setup.sql`. No migration contains a row-removing statement. notify-group **v18** (TITLES + rank value only). Client: `docs/js/meriter.js` (`window.MERITER`, in the `mods()` list), `docs/meriter.css`, `docs/js/social.js`, `docs/js/medals.js`, `docs/js/extras.js`. A missing RPC (old database, PGRST202) = that part hides; ranks then fall back to lifetime drinks.

### Meriter per action (one table; same numbers in 0036, meriter.js `ACTS`)
Night = 05:00–05:00 Europe/Stockholm. Caps are points per user, night and kind.
| kind | action | pts | cap per night |
|---|---|---|---|
| `squad` | Natt med truppen: a drink or check-in within 150 m of a group-mate's pin, check-in or crew track point tonight (both get it) | 10 | 1× (10) |
| `duel_win` | member of the winning duel side who drank in the duel | 15 | per duel |
| `duel` | counted duel member with any duel activity (drink, check-in, skål, photo) | 5 | per duel |
| `rally_yes` | ✅ Kommer on someone else's call-out | 5 | 3 (15) |
| `arrive` | ETA "framme" for that call-out, or a check-in within 150 m of it, within 2 h | 5 | 3 (15) |
| `callout` | own call-out with answers from ≥ 2 others, or a "Kom hit!" push that went out (`push_sent` comehere) | 5 | 2 (10) |
| `buddy` | "Jag kollar" on a friend at 10+ (`medevac_checks`) | 5 | 2 (10) |
| `home` | "Jag är hemma" (`after_nights.home_at` / `medal_nights.home`) | 5 | 1× (5) |
| `status` | lägesrapport answered in time | 5 | 3 (15) |
| `checkin` | check-in at a bar (1 per bar) | 3 | 6 bars (18) |
| `game` | Lek: mission done, bingo line you ticked, Dagens orakel | 3 | 3 (9) |
| `photo` | chat photo (not a lägesrapport photo) | 2 | 5 (10) |
| `skal_give` / `skal_get` | skål given / received | 1 | 10 each |
| `drink` | every accepted drink (undo + re-drink pays once) | 1 | no cap |
A social night (squad, 2 bars, a call-out, skål, home, a photo) gives ~40–60; drinking alone ~6–12.

### Server
- Tables (RLS on, no policies, service_role only): `meriter_log(id, user_id, night, kind, ref, pts, bf, created_at)` unique (user_id, night, kind, ref) — append only, filled by AFTER triggers `olnu_zz_mer_*` on beers, checkins, skals, rally_answers, etas, push_sent, medevac_checks, after_nights, medal_nights, status_answers, chat_photos, duels, game_missions, game_bingo_cards, game_oracles (every trigger catches its own errors); `meriter_totals(user_id, total)` kept by an insert trigger. Helper `olnu_mer_add(uid, night, kind, ref, pts, cap)` (advisory lock per user). The 0016 erase sweep moves both tables' uuids.
- `olnu_titles()` = the 42-step meriter ladder below; `olnu_meriter(uid)`, `olnu_rank_of(m)` → (idx, title, at, next_title, next_at, n).
| name | params | returns | errors |
|---|---|---|---|
| `my_stats` | – | v7 fields (`total` = lifetime drinks, `week`), `title/next_title/next_at` by meriter, + `meriter, rank, ranks, rank_at, tonight_meriter` | – |
| `poll_v2` | unchanged | `me` = my_stats (so the new fields too); `pins[].meriter` for me / group-mates | as before |
| `my_meriter` | `p_after_id bigint default 0` | jsonb `{meriter, title, rank, ranks, rank_at, next_title, next_at, tonight, week, last_id, events:[{id, kind, pts, at}]}` — events only when `p_after_id > 0` (id > after, newest 40, oldest first, never backfill rows) | `not_authenticated` |
| `group_status_v3` | `p_group_id uuid` | group_status_v2 columns + `meriter int, rank int` | `not_member` |
| `meriter_board` | `p_scope 'group'\|'town' default 'group', p_group_id uuid, p_lat, p_lng float8, p_period 'tonight'\|'week'\|'all' default 'week', p_km default 20` | setof `(rank, name, meriter, title, is_me, home_town)` top 20 + the caller. Group: members' display names. Town: users with a night place / live pin / check-in within p_km in 30 days; names only with board opt-in (as `local_board`). Shares the board rate limit (`slow_down`). | `not_member`, `invalid_period`, `invalid_scope`, `outside_sweden`, `slow_down` |
| `my_wrapped` | unchanged | `title` by meriter + `meriter` | – |
- **Backfill** (0036c): per night from medal_nights (drinks), week_beers (rest of the lifetime drinks), medal_checkins (bars, squad = mate at the same bar), crew_tracks / tonight's pins and check-ins (squad within 150 m), after_nights (skål, home), medal_counts (skål before v16), rallies / rally_answers / etas, push_sent comehere, medevac_checks, status_answers, chat_photos, game_*; same caps. Rows `bf = true`, dated ≥ 4 h back. The rank each user holds was claimed in `push_sent` (`title:<titel>`) → no false level-up push. 2026-10-20: 41 users; before (lifetime drinks, 0035 ladder) 32 Rekryt, 2 Vicekorpral Kapsyl, 2 Korpral Korkskruv, 4 Skumsergeant, 1 Furir Flaskhals; after (meriter) 19 Rekryt, 2 Mönstrad Mellanöl, 3 Menig Mjöd, 8 Vicekorpral Kapsyl, 2 Korpral Korkskruv, 3 Översergeant Sejdel, 3 Furir Flaskhals, 1 Fanjunkare Flasköppnare (max 101).
- **notify-group v18**: `TITLES` = the ladder below; the rank value is `meriter_totals.total`; the level-up push fires only when the meriter of the last 3 h crossed the rank start (`reachedNow`), still once per title per user ever.

### Ranks (42 steps by meriter; `olnu_titles()`, notify-group `TITLES`, `docs/js/social.js TITLES` identical)
| from | title | from | title | from | title |
|---|---|---|---|---|---|
| 0 | Rekryt | 255 | Kommendörkapten Krus | 1640 | Baron av Bryggstugan |
| 5 | Mönstrad Mellanöl | 300 | Ryttmästare Humle | 1830 | Hertig av Humlefältet |
| 10 | Menig Mjöd | 350 | Major Mäsk | 2040 | Ärkehertig av Ölkranen |
| 18 | Vicekorpral Kapsyl | 410 | Överstelöjtnant Ölstop | 2270 | Kung Kapsyl den Store |
| 28 | Korpral Korkskruv | 475 | Överste Ölkorv | 2520 | Ölkejsaren |
| 40 | Skumsergeant | 550 | Brigadgeneral Bärs | 2800 | Bryggerilegenden |
| 52 | Översergeant Sejdel | 630 | Flottiljamiral Flaskpost | 3100 | Halvguden vid Jäskaret |
| 66 | Furir Flaskhals | 720 | Generalmajor Gambrinus | 3450 | Myten i Mässen |
| 82 | Överfurir Fatkran | 820 | Generallöjtnant Guldskum | 3850 | Legenden vid Långbordet |
| 100 | Fanjunkare Flasköppnare | 930 | General Gyllenbärs | 4300 | Sagofiguren i Skyttegraven |
| 125 | Fänrik Fatöl | 1050 | Amiral Ankarstout | 4800 | Oraklet i Ölstugan |
| 150 | Löjtnant Lager | 1180 | Fältmarskalk Fradga | 5400 | Överbefälhavare Öl |
| 180 | Premiärlöjtnant Pilsner | 1320 | Storamiral Skumtopp | 6200 | Generalissimus Glaset |
| 215 | Kapten Kaggen | 1470 | Riksmarskalk Rundtur | 7000 | Ölguden |
New in v26: Översergeant Sejdel, Kommendörkapten Krus, Flottiljamiral Flaskpost, Amiral Ankarstout, Storamiral Skumtopp, Generalissimus Glaset. First social night ≈ rank 4–7; Brigadgeneral ≈ 2 months, Ölguden ≈ 1½ years of active weekends.

### Client
- Ladder key `olnu.ladder` = `"13"`: the first rank that changed with this update shows the quiet toast "Armén har fått nya grader!" once, never a BEFORDRAN. A real promotion (meriter grew and the title changed, from `my_stats`/`poll_v2.me` or `my_meriter`) shows the BEFORDRAN popup ("Nästa: X vid N meriter"); it still waits for the beer-type strip (`OLNU_STRIP`).
- `meriter.js`: `my_meriter(after)` with the app poll (max every 20 s), ~2.5 s after a beer / home / chat and ~3 s after skål / call-out / check-in / photo taps. First call per phone (`olnu.merLast` missing) = no toasts. New events → ONE batched toast "+14 meriter · <line of the biggest kind> (📍 +3 🍺 +1)", ≥ 10 dalmål/military lines per kind (`MERITER.LINES`, "ä" for dialect "é", the last 6 per kind not repeated), waiting for a free slot in the app toast queue.
- Rank chip (Ikväll panel): "🎖️ <rank> · N meriter" + progress bar; "⭐ +N meriter ikväll" chip → "Hur får jag meriter?" sheet (rank, bar, every action with points and cap). Also from the uniform ("❓ Hur får jag meriter?") and the 🏆 board.
- Uniform: "Grad N/42 · M meriter · D drycker totalt", bar and "X meriter kvar till …" by meriter.
- Member list (`group_status_v3`, fallback v2 → v1; an empty v3 answer counts as missing): "🎖️ <rank> · N meriter". Chat names: "🎖️ <rank> <name> · N meriter". Friend pins: rank by `pins[].meriter`.
- 🏆: "🎖️ Meriter" board before the town boards — 👥 Gruppen (group chips when several) / 🏙️ <stad>, Ikväll / Veckan / Totalt.

## FÖRFESTLÄGET (🎉 pre-party card game, one phone passed around; client only, no migration, no push)
- Files: `docs/js/forfest.js` (`window.FORFEST`, defer), `docs/js/forfest-content.js` (`window.FORFEST_CONTENT`, `type="text/x-lazy"`, so start-up size does not grow), `docs/forfest.css` (`<link rel="x-lazy-css">`: the browser does not load it at start; forfest.js adds it as a stylesheet on the first open; the stamp workflow gives it `?v=` and the service worker precaches it like every `./*.js|css` in index.html, so the game works offline).
- Ways in: group page tile "🎉 Förfest" (hook `groupItem`, row class `ff-gi`), and "🎉 Förfestläget" in the Lek sheets (games.js calls `FORFEST.lekButton(g)`: my-missions sheet, under "Gruppens lekar"; a group's Lek sheet, under the tabs). `FORFEST.open({id,name}|null)` opens a full-screen overlay (`#ff`, z-index 2150: above sheets and toasts, below the intro and takeover). It waits for the beer-type strip (`OLNU_STRIP.after`) and closes the open sheet. Android back: game → start screen → closed (`history.pushState({ff:1})`).
- Players: the group's names from `group_status` (existing RPC; own row = own display name), cached per group in `olnu.ffNames` for offline use. Tick who is here; guests by name (max 12, 20 chars). Prefs in `olnu.ff` `{gid, nodrink, guests[], off{gid:[names]}}`. Names are only shown on this phone; nothing is sent.
- Modes: `u` Uppvärmning, `k` Kaos, `s` Skyttegraven (army). Each card line is `"MODES|text"` or `"MODES|start|end|N"` (virus and some kapten cards). Kaos prefers cards without `u`, Skyttegraven prefers army-only (`s`) cards. 347 cards: mest 52, aldrig 52, utm 58, kat 35, virus 27, rost 31, duo 37, kapten 23, order 32 (u 210, k 230, s 324).
- Rules: no repeated card in one browser session (`sessionStorage olnu.ffUsed`, card id = `type:index`, so only ADD cards at the end of a list); "🔀 Blanda om" when the deck is empty clears that mode's ids. Never the same type 3 in a row; max 2 running viruses, 4+ cards apart; a running virus counts down on every new card, then its end card comes next. A water card every 22 cards. Players named fairly (least named first).
- Penalties: `{k1}` tar en klunk, `{k2}` tar två klunkar, `{d3}` delar ut 3 klunkar (upper case = imperative "Ta en klunk", capitalised only at a sentence start). "🥤 Utan dricka" swaps them for squats, push-ups, planks and compliments (`nodrink`).
- Screen Wake Lock while a game screen is shown (re-taken on `visibilitychange`), released on the start screen and on close. 🔆 in the top bar while it holds.
- Look: big card on a full-screen colour per type (mest blue, aldrig pink, utmaning orange, kategori teal, virus green, omröstning purple, duo red, kapten gold-brown, order olive camo, water blue). Tap or swipe left = next, swipe right / ‹ = previous (history, not a new card). Keys: → Space Enter / ← / Esc. No flashing; reduced motion = no card motion.

## NÄRA — VÄNNER + TRUPPEN SAMLAD + HITTA KOMPISEN (additive)
Migrations `0045_friends.sql`, `0046_squad.sql`, `0047_find.sql` (applied on the server 2026-10-20 under the same names). Needs 0001–0035 (`olnu_chief_k` 0030, `olnu_crew_pres` 0027, `olnu_home_town` 0033, `olnu_town_of` 0018). No migration contains a row-removing statement: rows end with status / expiry UPDATEs. Client: `docs/js/near.js` (`window.NEAR`, through `mods()`) + `docs/near.css`. A missing RPC (old database, PGRST202) = that part hides, no error.

### Tables (RLS on, no policies, no client access; service_role has all)
`friend_codes(user_id pk, code 7 chars unique, created_at, changes)` · `user_names(user_id pk, name, updated_at)` (own name for friends, sent with friend calls) · `friendships(id, a, b, requester, status pending|accepted|declined|removed|cancelled, via code|group, created_at, updated_at, accepted_at, ended_by, notified)` unique (least(a,b), greatest(a,b)) · `squad_gatherings(id, group_id, night, bar_id, place_name, place_kind bar|town|none, lat, lng (4 decimals), n, members uuid[], created_at, updated_at)` · `squad_checks(group_id pk, at)` · `find_share(user_id pk, groups, friends, until, updated_at)` · `find_pos(user_id pk, lat, lng, acc, target_uid, updated_at, expires_at)` (ONE row per user, overwritten = no history) · `find_reqs(id, from_uid, to_uid, group_id, friendship_id, status pending|accepted|declined|cancelled|auto, created_at, answer_by (+5 min), answered_at, until, notified)`.
"Radera allt om mig" (0016c uuid sweep): BEFORE UPDATE triggers end the friendship (`removed`), clear the friend name, replace the friend code, switch the share off, clear the position and cancel live find requests. `squad_gatherings.members` is an array (the sweep does not move it); names come only from current group members, so an erased user (who left every group) never shows.

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `my_friend_code` | `p_new bool default false, p_name text default null` | jsonb `{code}` | `slow_down` (10 new codes per day), `code_generation_failed` |
| `friend_code_info` | `p_code text` | jsonb `{name, home_town, mine, state none\|pending_out\|pending_in\|accepted}` | `friend_not_found` |
| `friend_request` | `p_code default null, p_group_id uuid default null, p_k text default null, p_name default null` | jsonb `{id, status, name, already, auto}` | `friend_not_found`, `own_code`, `not_member`, `invalid_member`, `slow_down` (30/h), `friend_limit` (300) |
| `friend_answer` | `p_id bigint, p_accept bool, p_name default null` | jsonb `{id, status, name}` | `friend_req_not_found`, `friend_limit` |
| `friend_remove` | `p_id bigint` | jsonb `{id, status}` | `friend_req_not_found` |
| `my_friends` | `p_name default null` | jsonb `{code, friends:[{id, key, name, home_town, out, town, since, via}], incoming:[{id, name, home_town, at, via}], outgoing:[{id, name, at}]}` | – |
| `squad_poll` | – | jsonb `{v, server_time, squads:[gathering + nights]}` | – |
| `squad_group` | `p_group_id uuid` | jsonb `{nights, total, best_n, last:[gathering] (10)}` | `not_member` |
| `set_find_share` | `p_groups bool, p_friends bool` | jsonb `{groups, friends, until}` | – |
| `find_request` | `p_key text, p_name default null` | jsonb request + `{auto, allowed}` | `invalid_target`, `slow_down` (1 per 15 s, 60 per 12 h) |
| `find_answer` | `p_id bigint, p_accept bool` | jsonb request | `find_req_not_found` |
| `find_cancel` | `p_id bigint` | `{ok}` | `find_req_not_found` |
| `find_ping` | `p_key text, p_lat, p_lng float8, p_acc float8 default null` | jsonb `{ok, name, allowed, status (pending\|accepted\|auto\|share), req_id, until, answer_by, target:{lat, lng, acc, age_s}\|null, finding_me}` | `invalid_target`, `outside_sweden` (= invalid coordinates), `no_find` |
| `find_stop` | – | `{ok}` | – |
| `near_poll` | `p_name default null` | jsonb `{v, server_time, share:{groups, friends, until}, find_in:[request], find_out:[request], friends_in:[{id, name, home_town, at}], squads:[gathering + nights]}` | – |
Gathering json: `{id, group_id, group_name, place, kind bar|town|none, bar_id, n, names[] (current members, arrival order), here, at, updated_at}` (+ `nights`). Request json: `{id, key, name, group_name, status pending|accepted|auto|declined|cancelled|expired|ended, at, answer_by, until, mine, finding}` (`finding` = the other person's finder is open towards the viewer right now). Never user ids.

Rules:
- **👥 Vänner**: target = owner of a 7-char friend code (alphabet of group codes; group codes have 6, duel tokens 8) or member `k` (0030 `olnu_chief_k`, = `group_status_v2.k`) of a shared group. The other person must accept (`friend_answer`); a request to someone who already asked you accepts at once (`auto`). A request the target declined in the last 24 h answers `pending` again and changes nothing (no spam, no "declined" leak). Remove = `friend_remove` (status UPDATE). Friend name = `user_names.name` (sent by the client as `p_name`), else the smallest group display name. `out` = 0027 presence (live check-in < 3 h or visible live pin, newer than Hej då / Jag är hemma); `town` = `olnu_town_of` of that presence (never a bar or a point).
- **🪖 Truppen samlad**: `near_poll` runs `squad_poll`, which checks each caller group (max 20) at most every 20 s per group (`squad_checks`). Positions = what the server stores (5 decimals): a live check-in < 3 h → its bar point; a live, visible, **precise** pin with a drink in the last 2 h → its snapped bar point (0015 `snap_bar`), else the pin. "Bara område" and ghost pins never count; Hej då / home after the position = not counted. Anchor = the member with most members within **50 m** (self included); n ≥ 3 → a gathering of everyone within 50 m of the anchor. Place = the most common bar of the cluster (name from `bars_lite` / the check-in), else the town (`olnu_town_of`), else none. Max one gathering per group per place per 90 min (same bar, or ≤ 150 m): later arrivals only raise `n` / `members`. "Nätter tillsammans" = distinct `night` values. Why 50 m and not 20 m: phone GPS in town jitters 10–30 m (indoors more), and check-ins sit on the bar point while pins sit where the phone was, so 20 m would miss three people at one table.
- **🧭 Hitta kompisen**: target keys `f<friendship id>` (accepted friend) or `g<group uuid>:<k>`. The target's live position is visible to the viewer only when (a) a request between them was accepted (30 min, capped at 05:00), or (b) the target's `find_share` covers the viewer (friends / groups) and is on (until 05:00 or off), or (c) the target's finder is open towards the viewer. `find_request` gives `auto` when (b) holds, else `pending` (5 min to answer). `find_ping` writes the caller's exact position only when a live request exists or the target shares (else `no_find`), at most every 3 s, `expires_at = now + 2 min`; `find_stop` clears it. The client pings every 6 s only while the finder sheet is open.

### Edge function `notify-group` — new body events (merged on top of deployed v18; the client sends them only when `PUSH_EVENTS = true` in near.js — an older function would treat an unknown event as the after-beer call)
| body | who gets it | limit | payload |
|---|---|---|---|
| `{event:"friend", friend_id}` | the other person of the friendship | row must be the caller's pending request, < 5 min, `notified=false` (atomic claim) else `no_friend`; 1 per 20 s per sender (`push_sent` kind `friend`) → `slow_down` | title 1 of 6, e.g. "🤝 {namn} vill bli din vän"; body "Tryck för att svara."; url `/?friends=1`; tag `olnu-friend-<id>` |
| `{event:"find", req_id}` | the request's target | row must be the caller's, status pending/auto, < 2 min, `notified=false` (atomic claim) else `no_find`; 1 per 30 s per sender (kind `find`) → `slow_down` | title 1 of 8, e.g. "🧭 {namn} letar efter dig i vimlet!"; body "Tryck för att svara – frågan gäller i 5 min." / (auto) "Tryck och öppna kompassen så hittar ni varann."; url `/?find=<id>`; tag `olnu-find-<id>`; TTL 300 s |
`{namn}` = the caller's display name in the request's group, else `user_names.name`, else the smallest group name.

### Deep links
- `?friend=CODE` → "🤝 Bli vänner?" sheet (`friend_code_info`, then `friend_request`). `?friends=1` → the friends sheet. `?find=<id>` → the answer sheet (pending) or the finder (accepted/auto). Cold start: near.js reads and removes them after sign-in; app open: `routeOpen` → `mods("openNearLink", find, friend)`.

### Frontend (near.js)
- ⚙️ "👥 Vänner & 🧭 Hitta" (`settingsSheet`) → sheet: incoming requests (✅ Acceptera / Nej tack), friend list (name, demonym via `HOMETOWN.label`, "🍺 ute ikväll i <stad>" / "🌙 int' ute", 🧭, ✕ → confirm → `friend_remove`), pending outgoing (Ångra), "➕ Lägg till vän" (code field; a pasted link works), "📲 Min vänkod" (code, QR via `window.QRCode` like the invite sheet, copy / share / 🔄 new code), "🧭 Låt mig hittas ikväll" switches (groups / friends, until 05:00), privacy line.
- Medlemmar (social.js `showStatus`): tapping any member opens the action row with "🎖️ Uniform", "➕ Lägg till vän" and "🧭 Hitta" (`NEAR.memberPanel`, after the v25 role buttons).
- Group page (`groupItem`): one tile "🪖 Nätter tillsammans: N · Senast vid X, 4 man" + "🧭 Hitta nån" (member chooser from `group_status_v2`).
- `near_poll` on sign-in, with the app poll (every 30 s; 10 s while a find request is live), and when the app becomes visible. Toasts once (`olnu.friendSeen`, `olnu.findSeen`): new friend request ("Visa"), new find request ("🧭 Svara"), a friend looking for you with the share on ("🧭 Öppna"). ONE HUD chip `data-hx="near"` (urgent, `.nr-chip`) only while a find request waits for you or someone's finder is open towards you.
- **Celebration** (once per gathering id, `olnu.squadSeen`; only when < 60 min old, < 30 min on the first poll after opening, max 1 then): waits for the beer-type strip (`OLNU_STRIP.after`), vibration `[70,50,70,50,200]`, clink, 40 confetti pieces that fall once in ~2.6 s (pointer-events none, no blinking, none with reduced motion), toast "🪖 TRUPPEN SAMLAD vid Pitchers – 4 man!" + one of 14 dalmål lines + names. English: "🪖 SQUAD ASSEMBLED at Pitchers – 4 strong!".
- **Ticker** (rides on `BARSPLUS.newsTemplates/newsCands` like after.js): kinds `groupSquad` (8 lines, gathering < 2 h, imp 2 when < 45 min) and `groupSquadNights` (4 lines, nights ≥ 2), class `tk-friend`.
- **Finder sheet** "🧭 Hitta <namn>": big arrow (CSS rotate with a 0.35 s ease, no flashing), distance "40 m ±6", "🔥 Varmare / 🧊 Kallare / 👀 Du ä framme" (change > 2 m between pings; ≤ 8 m = there; a warm/cold line stays 15 s), status line (waiting for answer with countdown, declined, waiting for the friend to open the compass, live / seen N s ago). Heading: `deviceorientationabsolute` alpha (Android) or `webkitCompassHeading` (iOS, after the "🧭 Slå på kompassen" tap → `DeviceOrientationEvent.requestPermission()`), plus the screen angle. No heading after 2.5 s or permission refused → north-up Leaflet mini map (me blue, friend amber, dashed line) and the arrow shows the bearing from north. GPS `watchPosition` (high accuracy) only while open; close → `clearWatch`, `find_stop`.

## v27 MORGONEN EFTER (medaljceremoni, helgstreak, ölpass, kvällskod; additive)
Migrations `0050_ceremony.sql`, `0051_helg_streak.sql`, `0052_passport.sql`, `0053_night_code.sql` (applied on the server 2026-10-20 under the same names, plus `0050_ceremony_b_how` = the final `olnu_cer_json` that is in the 0050 file). Needs 0001–0035. No row is ever removed; no file contains a row-removing statement. Client: `docs/js/ceremony.js` (`window.CEREMONY`) + `docs/ceremony.css`, `docs/js/helg.js` (`window.HELG`) + `docs/helg.css`, `docs/js/passport.js` (`window.PASSPORT`) + `docs/passport.css`, `docs/js/koden.js` (`window.KODEN`) + `docs/koden.css`, all through `mods()`. A missing RPC (old database, PGRST202) = that feature hides, no error. Test clocks: settings `olnu.cer_now` / `olnu.helg_now` (SQL editor only; PostgREST clients cannot set them).

### 🎖️ Medaljceremonin (0050)
Tables (RLS on, no policies; service_role has all): `cer_votes(group_id, night, voter, cat, target, created_at, updated_at)` pk (group_id, night, voter, cat) · `cer_rl(group_id, night, user_id, n)` · `cer_done(group_id, night, done_at, how 'all'|'time', voters)` · `cer_results(group_id, night, cat, winner, votes)`. The 0016 erase sweep moves the uuids.
| name | params | returns | errors |
|---|---|---|---|
| `ceremony_poll` | – | jsonb `{v, now, night, evening, opens_at, closes_at, groups:[lite state]}` (max 20) | – |
| `ceremony_group` | `p_group_id uuid` | jsonb full state | `not_member` |
| `ceremony_vote` | `p_group_id uuid, p_cat text, p_k text` | jsonb full state | `not_member`, `invalid_cat`, `not_open`, `ceremony_done`, `not_out`, `invalid_member`, `self_vote`, `slow_down` (120 changes per group and night) |

State: `{v, group_id, group_name, night, evening, now, opens_at, closes_at, phase 'none'|'before'|'open'|'done', how, eligible, cats[9], voters_n, done_n, my_votes:{cat:k}, my_n, my_done, my_wins:[cat], members (full: [{k, name, is_me}] = the out members), done_names (full), results (full + done: [{cat, votes, winners:[{k, name, is_me}]}])}`. `k` = md5(group:user:olnu-cer)[0:12], never a user id.
Rules:
- Night = the night that ended at the last 05:00 (`olnu_night_of(olnu_night_of(now) − 26 h)`, DST-safe). Voting 06:00–18:00 Europe/Stockholm that day.
- Voters and candidates = current members who were out that night (`medal_nights` drinks > 0, or `medal_checkins`, or `after_nights.out/checkins`). Fewer than 2 → `phase:'none'`.
- Categories (stable ids, `olnu_cer_cats()`): `hjalte` Kvällens hjälte, `clown` Kvällens clown, `citat` Bästa citat, `ankaret` Ankaret (fick hem alla), `dansgolv` Dansgolvets general, `filosof` Kvällens filosof, `kebab` Kebabgeneralen, `stil` Stilikonen, `comeback` Comebacken. One vote per category (can be changed while open), never yourself.
- Done when every out member voted in all 9 categories (`how:'all'`, votes lock) or at 18:00 (`how:'time'`, finished by the first read after 18:00). Winner per category = most votes; ties share. Results stay visible until the next ceremony night.
- Medals: `olnu_medal_eval_cer` → stacking `cer_<cat>` per category won (picked up by the generic `olnu_medal_store`). The client adds names to `MEDALS.CAT` so the uniform and member uniforms show them.
Frontend: group page tile "🎖️ Ceremoni" (`groupItem`, class `cer-gi`; sub line Rösta! n/9 · ✓ röstat · resultat · öppnar 06:00); ONE HUD chip `data-hx="cer"` "🎖️ Rösta!" while open, eligible and not all voted; sheet with 9 category cards and name chips; results with a gold "CEREMONIKORT" for the caller's wins and "🎖️ Se uniformen". Toasts once per group and night (`olnu.cerSeen`): voting open / you won / results. Polls `ceremony_poll` max every 90 s (20 s while the sheet is open); the sheet refreshes every 15 s. In-app only (no push).

### 🔥 Helgstreak (0051, + notify-group v18)
No new tables (computed from `medal_nights`, `medal_checkins`, `after_nights`).
| name | params | returns | errors |
|---|---|---|---|
| `helg_state` | – | jsonb `{v, now, week, weekend, friday_evening, me:{week, streak, best, freezes, max_freezes:2, used, done, at_risk, will_freeze, next_freeze_in, weeks:[{w, s}]}, groups:[{id, name, week, streak, best, this_week, need:3, done, members, weeks:[{w, n, now?}]}]}` | – |
| `helg_remind_targets` | `p_caller uuid` | setof `(user_id, streak, name)` — service_role only | – |
Rules:
- Week = Monday of the evening date (Europe/Stockholm; Monday 00–05 still belongs to the old week). A week counts when the user was out on a Friday, Saturday or Sunday evening (a drink or a check-in).
- Streak: consecutive counted weeks; the current week adds 1 once it counts and never breaks the streak while it runs. Freeze passes: start with 2; a missed week with streak > 0 uses one (`s:'frozen'`, the streak stays); while < 2, one comes back every 4 weeks. No pass → the streak resets (`s:'miss'`). `at_risk` = not out this week, streak > 0, no pass left.
- Group streak: a group week counts when ≥ 3 current members were out that weekend (no passes); last 52 weeks.
- `notify-group {event:"helg_remind"}` (function v18): Friday 17:00–23:59 Europe/Stockholm only. Recipients = group-mates of the caller (not the caller) with `at_risk` and streak ≥ 1; atomic claim in `push_sent` (kind `helg`, night = the week's Monday 00:00) → max 1 per person per week, whoever triggers it. Payload: title 1 of 8 `HELG_LINES` ("🗓️ Fredag! Din helgstreak på {n} veckor vill gärna leva vidare"), body "En öl eller en incheckning fre–sön räcker. Vila ä oxå bra – ingen press.", url `/?helg=1`, tag `olnu-helg-<date>`, TTL 6 h. Reason when nobody: `no_target`.
Frontend: section "🔥 Helgstreak" in the 🏆 sheet (`topSheet`: big number, 8 week squares, 🧊 passes, best, group rows, "Så funkar det"); one line on the group page ("🔥 Helgstreak 3 v · 2/3 ute denna helg · du: 4 v" → sheet). The app calls `helg_remind` once per week (`olnu.helgCall`) on the first poll after Friday 17:00; the caller gets one in-app toast when the own streak is at risk (`olnu.helgToast`). Deep link `?helg=1` opens the sheet (removed from the URL). `helg_state` max every 10 min.

### 🛂 Ölpasset (0052)
| name | params | returns |
|---|---|---|
| `my_passport` | – | jsonb `{v, bars:[{id, name, lat, lng, type, nights, first, last, town, in_se}], towns:[{town, nights, first, last}], bars_n, towns_n, nights_n, abroad, first_abroad}` |
- Bars = `medal_checkins` (check-ins + king taps) ∪ `crew_tracks` kind `drink` with a `bar_id` (drinks snapped to a bar). Position/name from `bars_lite`, else `board_bars` + the caller's own `crew_tracks`/`bar_taps`/`checkins` bar name. Towns = `after_nights.town` ∪ `olnu_town_of(bar)`. `in_se` = known in `bars_lite` or near a Swedish town. Own data only; positions are public bar points. Dates are evening dates.
- Client: country of an abroad bar = nearest of ~85 big world cities within 450 km (else "Utlandet"); the city also becomes a town stamp when ≤ 40 km. Milestones (visa stamps): 5 / 10 / 25 / 50 bars, first bar abroad; toast once when newly reached (`olnu.passMiles`; the first load sets them quietly).
Frontend: "🛂 Ölpasset" button in the 🏆 sheet and in ⚙️. Sheet: passport cover (bars · towns · countries · nights), a small Leaflet map (Esri dark tiles) with round ink pins, visa row, country list, ink stamps (paper page, rotated, 6 inks, 5 shapes, SVG turbulence for the ink edge) for towns and up to 60 bars. The map is removed when the sheet closes.

### 🟨 Kvällskoden (0053)
| name | params | returns |
|---|---|---|
| `my_night_code` | `p_last bool default true` | jsonb `{v, night, evening, out, drinks, bars, checkins, skal, skal_given, skal_got, rallies_sent, rallies_yes, water, home, medals}` |
- Counts only (no town, no place, no time). Built on `my_night_report`; rallies = own call-outs + yes to others' that night; water = `game_facts.water`; medals = medal rows updated during that night/morning.
- Text (`KODEN.text`): `"Öl Nu D/M " + drinks + " 📍bars 🪖rallies 🍻skål 💧water 🎖️medals 🏠✅|🏠❔"`; drinks 1–4 = one 🍺 each, 5–9 = 🍺🍺🍺🔥, 10+ = 🍺🍺🍺🚁, 0 drinks but out = 🫗; zero counts are left out; no night out = "Öl Nu D/M 🛋️ Vilokväll". Example: `Öl Nu 18/10 🍺🍺🍺🔥 📍3 🪖1 🍻9 🏠✅`.
- Buttons "🟨 Kvällskoden" (`KODEN.button(row)`) in the morning report (after.js `showBakis`) and in the 📰 morning paper (gang.js `renderPaper`): shows the line, copies it at once, "📋 Kopiera" / "↗️ Dela" (Web Share text).

## v26 EXTRAS — 📅 EVENTS, 🚩 BAR REPORTS + CLEANUP, 🐴 GULDHÄSTEN, DELIGHT MORE, DB WARNING, iPHONE HAPTICS (additive)
Migrations `0065_bar_events.sql`, `0066_bar_reports.sql`, `0067_golden_horse.sql`, `0068_owner_db_size.sql`, `0069_bar_cleanup.sql` (applied on the server 2026-10-20 under the same names). No migration contains a row-removing statement. Client: `docs/js/events.js` (`window.EVENTS`), `docs/js/golden.js` (`window.GOLDEN`), `docs/js/delight-more.js` + `docs/js/delight-more-content.js` (`window.DELIGHT_MORE`), `docs/events.css`, `docs/stats-extra.js` (stats.html). Scripts: `scripts/import-events.mjs` + `scripts/event-feeds.json` + `.github/workflows/events.yml`, `scripts/clean-bars.mjs`. A missing RPC (old database, PGRST202) = that part hides, no error. No new push event (Vi går! uses the existing `notify-group {event:"rally"}`).

### 📅 Events ("Ikväll i stan")
Table `bar_events(id, source user|owner|ticketmaster|ical|jsonld, source_id, url, title 3–80, kind quiz|live|dj|karaoke|sport|standup|party|other, starts_at, ends_at, bar_id, place ≤ 60, lat, lng, town, status pending|ok|hidden, created_by, created_at, updated_at, status_at, expires_at)`, unique (source, source_id). Rows are never removed; `expires_at` (= ends_at or starts_at + 5 h) and `status` filter reads.
| name | params | returns | errors |
|---|---|---|---|
| `events_near` | `p_lat, p_lng float8, p_days int default 1` (1–14) | setof `(id, title, kind, starts_at, ends_at, bar_id, place, lat, lng, town, url, source, is_mine, pending, km)` — status ok within ~30 km, started < 12 h ago and not expired, starting before now + days; plus the caller's own pending ones (`pending`, url hidden). Max 100, by time. | `outside_sweden` (= invalid coordinates) |
| `submit_event` | `p_title, p_starts_at timestamptz, p_bar_id, p_place, p_lat, p_lng, p_kind, p_url` (all but title/time default null) | jsonb `{id, status:"pending", bar_id}` — a known bar_id gives the bar position; else the nearest bar ≤ 75 m | `invalid_event` (title 3–80, no links; time −1 h…+60 d; url http(s) ≤ 300), `outside_sweden`, `slow_down` (1 / 30 s, 5 per Stockholm day) |
| `owner_events` | `p_key, p_status default 'pending'` (or ok / hidden / all) | jsonb `{generated_at, counts, events[]}` | 403 `forbidden` (logged like owner_stats), `rate_limited` |
| `owner_set_event` | `p_key, p_id, p_status` | jsonb `{ok, status}` | `invalid_status`, `event_not_found`, 403 |
| `import_events` | `p_rows jsonb` (≤ 2000 × `{source, source_id, title, starts_at, ends_at?, url?, place?, lat, lng, kind?}`) | jsonb `{inserted, updated, skipped}` — **service_role only**; upsert on (source, source_id); imported rows are `ok`; a row the owner hid stays hidden | `invalid_rows` |
| `import_event_towns` | – | jsonb `[{name, lat, lng}]` (olnu_towns) — service_role only | – |
- Client (events.js): 🏆 sheet section "📅 Ikväll i stan" (tabs Ikväll / 7 dagar; rows time · emoji + title · place · "⏳ väntar på godkännande"; "🪖 Vi går!", 🌐 link; "➕ Tipsa om ett event" form: title, datetime, bar from the map area, kind chips, link; legal note "inga erbjudanden om billig sprit"). Bar sheet: `.ev-line` "🧠 Pubquiz med Bosse 20:00 · 🪖 Vi går!" (app.js lifts `.ev-line` right under the title), and in ℹ️ Info "🚩 Fel plats / stängt?" + "➕ Tipsa om ett event". Ticker kinds `evTonight` (8 lines, imp 1/0) and `evCount` (3 lines), ride on `BARSPLUS.newsTemplates/newsCands` like after.js. One in-app toast per event when I am checked in at its bar (`olnu.evSeen`). `events_near` at sign-in, then max every 10 min, and when the 🏆 sheet opens (cache 2 min).
- **Vi går!** = `my_groups` (group chips when 2+) → `create_rally(group, "📅 <title> <HH:MM>", place, event position)` → `notify-group {event:"rally", rally_id}`.

**Sources (research 2026-10-20)**
- ✅ **Ticketmaster Discovery API v2** — free key (developer.ticketmaster.com), 5000 calls/day, 5/s; `events.json?geoPoint=<geohash>&radius=25&unit=km&startDateTime…&size=100`. Covers concerts / sport / shows at arenas and bigger venues (Sweden is a Ticketmaster market); small pub nights are mostly NOT there.
- ✅ **Public iCal (.ics) feeds** — a bar's own Google Calendar / WordPress "The Events Calendar" export (`?ical=1`), weekly RRULE (pub quiz every Thursday) expanded for 14 days, EXDATE respected, DST-safe.
- ✅ **schema.org Event JSON-LD on a bar's own web page** (many venue sites/plugins emit it) — robots.txt respected, polite User-Agent.
- ❌ **Facebook / Instagram events**: NOT allowed. Meta's Automated Data Collection Terms: "Platform APIs are the only allowable means to access data programmatically, unless you have our prior written permission" (developers.facebook.com/documentation/development/terms-and-policies/automated-data-collection). The importer refuses facebook.com / fb.me / instagram.com URLs.
- ❌ Songkick API: not accepting new API key applications. ❌ Bandsintown: API only for artists / their partners (non-artists must e-mail and be approved), events by artist, not by place. ❌ Eventbrite: public event search (/v3/events/search) shut down Dec 2019 / Feb 2020; only events by your own organization / venue id.
- ❌ visitdalarna.se (Citybreak / Visit Group, JS-rendered, no public iCal/RSS/API) and ludvika.se evenemang (not reachable from the research tools; Ludvika links to Visit Dalarna). Ask Visit Dalarna for a Citybreak feed, or add single events by hand (owner approves).
- Pitchers / O'Learys / local pubs: no public machine-readable event feed found; their events are on Facebook/Instagram (not allowed). If a bar has an iCal or JSON-LD page, add it to `scripts/event-feeds.json`.

**Owner setup (GitHub Actions, no secrets in the repo)**
1. Supabase dashboard → Project Settings → API → copy the Project URL and the `service_role` key.
2. https://developer.ticketmaster.com → Get your API key (free) → copy the "Consumer Key".
3. GitHub → repo → Settings → Secrets and variables → Actions → New repository secret: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TICKETMASTER_KEY`.
4. Optional feeds: edit `scripts/event-feeds.json`, e.g. `[{"type":"ical","url":"https://calendar.google.com/calendar/ical/…/public/basic.ics","bar_id":"n3472634175","kind":"quiz"}, {"type":"jsonld","url":"https://enpub.se/evenemang","bar_id":"x-la-parma-ludvika"}]` (`bar_id` from bars.json gives the position; or give `lat`/`lng`/`place`).
5. Actions → "Events (import)" → Run workflow (then daily 09:23 UTC). Local test: `node scripts/import-events.mjs --dry` (env `TICKETMASTER_KEY`, `EVENT_TOWNS="Ludvika:60.15:15.19"`).
6. Approve user tips in `docs/stats.html` → "📅 Event".

### 🚩 Bar reports + bar list cleanup
Table `bar_reports(id, bar_id, bar_name, kind closed|wrong_place|duplicate|not_bar|other, note ≤ 200, bar_lat, bar_lng, user_lat, user_lng (0.001 ≈ 100 m), user_id, status new|fixed|ignored, created_at, status_at)`.
| name | params | returns | errors |
|---|---|---|---|
| `report_bar` | `p_bar_id, p_bar_name, p_kind, p_note default null, p_lat, p_lng default null` | jsonb `{ok, id, already, reports}` — one report per user per bar per 7 days (again = update, `already`) | `invalid_bar`, `invalid_kind`, `invalid_msg`, `slow_down` (1 / 20 s, 10 per day) |
| `owner_bar_reports` | `p_key` | jsonb `{generated_at, total_new, bars:[{bar_id, bar_name, users, reports, kinds, notes[], user_pos[], lat, lng, active, first_at, last_at}]}` | 403, `rate_limited` |
| `owner_bar_action` | `p_key, p_bar_id, p_action close|reopen|ignore` | jsonb `{ok, action, rows}` — close = `bars_lite.active=false` + reports fixed | `invalid_action`, 403 |
- `scripts/clean-bars.mjs [--server server-bars.json] [--write] [--stale] [--offline]`: duplicates (same name ≤ 150 m; "name inside name" ≤ 25 m; keeps the OSM way / older node over x- rows), closed (OSM element deleted, amenity gone, `disused:/was:/abandoned:` lifecycle tag for the SAME amenity, past `end_date`, `opening_hours=closed`, "stängd/nedlagd/closed" in the name), very old data (last edit before 2015, version 1, only amenity/name/source tags — report only unless `--stale`; such rows include open places like Oliver Twist, so they are not switched off), wrong positions (outside Sweden, OSM node moved > 75 m), server rows missing from bars.json / > 50 m off. Uses the OSM editing API multi-fetch (≈ 5 calls, User-Agent), not Overpass. `--write` appends to `docs/bars-closed.json` and prints the server UPDATE.
- Run 2026-10-20: 1213 bars + 4 extra; 7 duplicates, 0 closed by tags, 35 very old (kept), 0 moved, 1 server-only row (Lilla London `n2466676052`, gone from OSM). Switched off (0069 + bars-closed.json): `n11360925580`, `n2293728903`, `n8415344232`, `n9846285868`, `n1211022409`, `n874275166`, `n6063629632`, `n2466676052` (+ Solo `n1471185136`, already in bars-closed.json).

### 🐴 Den gyllene dalahästen
Table `golden_horses(id, town, week (Monday, Stockholm), bar_id, bar_name, lat, lng, appears_at, ends_at, claimed_by, claimed_at)`, unique (town, week). Made on the first `golden_horse` call of the week per town (`olnu_gh_get`): a bar/pub/nightclub ≤ ~4 km from the town centre (md5 of id + week), one evening left this week Wed–Sat (or today), 19:00–22:59 local, until 02:00 (min 2 h). A town without bars gets a row with `bar_id = null` (nothing appears).
| name | params | returns |
|---|---|---|
| `golden_horse` | `p_lat, p_lng default null` | jsonb `{v, server_time, badges:[{name, is_me, until}], mine_total, state none|waiting|live|claimed|gone, town, week, id?, bar_id?, bar_name?, lat?, lng?, appears_at?, ends_at?, claimed_at?, winner_mine?, winner_name?}` — the bar is secret while `waiting`; `winner_name` / badge names only for self and group-mates |
- Catch: AFTER trigger `olnu_gh_checkin` on `checkins` (insert, or a new bar / time): the first check-in at the live horse's bar sets `claimed_by` (atomic `claimed_by is null`). Never blocks the check-in. Medal `guldhast` (stacks) via `olnu_medal_eval_golden` (merged by the generic `olnu_medal_store`); 🐴 badge = caught in the last 7 days.
- Client (golden.js): golden pin on the bar (pane `goldhorse`, zoom ≥ 11, 0.5 Hz glow, still with reduced motion), one toast (counts as seen after 1.5 s on screen, else retried), ONE urgent HUD chip "🐴 Guldhästen!" while live, `.ev-line` in the bar sheet, 🏆 section, ticker kinds `ghLive` (imp 2) / `ghCaught`, celebration card + `MEDALS.award` when I caught it, "🐴 Guldhästfångare" in pin popups (`beerTitleHTML`) of badge holders. Polls at sign-in, every 3 min, 3 s / 8 s after a check-in tap.

### 🎉 Delight more (client only)
16 map events added to `DELIGHT.events` (same seeding, tiers and captions): varg, rav, bandy (Nov–Mar), kanot (May–Sep), buss, blabar (Jul–Sep), lov (Sep–Nov), mus, raket (rare), hare, fyrverkeri (31 Dec–1 Jan), pingvin (rare, Nov–Mar), vasman (Dec–Mar), fallskarm, isbjorn (rare, Dec–Feb), svamp (Aug–Oct). 8 easter eggs (each max once per 10 min, off with the delight switch): ticker ×5, live counter ×4, 13:37, 00:00, zoom out to the world, zoom ≥ 18 at old Solo (memorial), "vatten" in chat (drops), "dalarna" in chat (wild Dala horse). `DELIGHT.caption` is exported for them.

### 💾 Owner DB warning (stats.html)
`owner_db_stats(p_key)` → jsonb `{generated_at, db_bytes (pg_database_size), limit_db_bytes 500 MB, db_pct, tables:[{name, bytes, table_bytes, index_bytes, toast_bytes, rows_est}] (top 25, pg_total_relation_size), media:{photos, voices, camera (lägesrapport photos)}, egress:{est_bytes_30d, media_bytes_30d, api_bytes_30d, user_nights_30d, limit_bytes 5 GB, pct, basis}}`. Egress is an estimate (media created in 30 d × 3 downloads + user-nights × 1.4 MB); the real number is Supabase → Usage. stats.html panels "💾 Databas" (meters, ⚠️ at 60 %, 🚨 at 80 %), "📅 Event" (approve / hide), "🚩 Barrapporter" (OSM link, stäng av / ignorera / slå på igen) — `docs/stats-extra.js`.

### 📳 iPhone haptics (fx.js)
iOS Safari has no `navigator.vibrate`. A programmatic click on the `<label>` of a hidden `<input type="checkbox" switch>` gives one system haptic tick on iOS 17.4–26.4 (works in Safari and home-screen apps, needs a user gesture); Apple disabled the programmatic path in iOS 26.5 (ios-haptics README). A real tap on a transparent switch overlay still ticks. So: `FX.vibrate()` keeps the programmatic tick (inside a user gesture only, `userActivation.isActive`), and on iOS `FX.hapticTrigger(el)` puts a transparent switch over ÖL! and ANNAT (their click handlers do not `preventDefault`, so the toggle and the tick happen and the click bubbles on). A tick from the overlay suppresses the programmatic one for 600 ms. Android/desktop: unchanged `navigator.vibrate`. System Haptics must be on (Settings → Sounds & Haptics).

## v27 SKÅLTIMMEN + ENGÅNGSKAMERAN (additive)
Migrations `0040_skal_film_tables.sql`, `0041_skal_hour.sql`, `0042_film_camera.sql`, `0043_film_story.sql`, `0044_film_roll_reveal.sql` (applied on the server 2026-10-20 under the same names). Needs 0001–0034 (`olnu_chief_of`, `olnu_owner_of`, `olnu_is_vice`, `olnu_gang_k/name/reveal`, `olnu_group_keeps`). No migration contains a row-removing statement. Client: `docs/js/skal.js` (`window.SKAL`), `docs/js/film.js` (`window.FILM`), `docs/skal.css`; uses `PHOTO._shrink` (photo.js pipeline). A missing RPC (old database, PGRST202) = that feature hides (no tile, no banner, no chip), no error.

### Storage (why not chat_photos)
Photo bytes live in `snap_photos`, not in `chat_photos`: `group_photo` / `group_photos` / `night_story_photo` give any chat photo to any member, which would break "post to see" and "hidden until 10:00", and the 0031 duel / 0036 meriter triggers on `chat_photos` would count these shots as chat photos. Same validation as `post_photo` (`olnu_snap_decode`: JPEG `FF D8 FF` / WebP, 200 B – 160 KB, w/h 1–2048, base64 ≤ 220000 chars). Every write first runs `olnu_snap_sweep()` (`update … set bytes = null where expires_at < now()`; rows stay). Expiry (`olnu_snap_exp`): skål photo = 12:00 the day the night ends; film photo = 7 days after its 10:00 reveal; a group that keeps its chat (0029) = +30 days instead (trigger `group_settings_snaps` moves live rows when the switch changes). "Radera allt om mig": trigger `snap_photos_anon` empties the bytes when the 0016 sweep moves `user_id`.

### Tables (RLS on, no policies, no client access; service_role has all)
`snap_photos(id, kind skal|film, group_id, user_id, ref_id (skal_hours.id), night (05:00 end), mime, bytes, size, w, h, created_at, reveal_at (film), expires_at)` · `skal_hours(id, group_id, started_by (null = random), fired_by (push claim owner), auto, night, created_at, ends_at = +3 min, notified)` · `skal_hour_posts(hour_id, user_id, group_id, night, photo_id, created_at, sec, in_time, rank, pts)` pk (hour_id, user_id) · `skal_settings(group_id pk, random_on, changed_by, changed_at)` · `skal_plans(group_id, night, plan_at, hour_id (0 = skipped), created_at)` pk (group_id, night) · `film_reacts(photo_id, user_id, emoji, active, updated_at)` pk (photo_id, user_id) · `film_rolls(group_id, night, claimed_by, claimed_at, notified)` pk (group_id, night).

### Meriter event (for 0036 meriter, not wired here)
`skal_hour_posts` is the event: one row per member per skåltimme, written once (never updated). `in_time` = posted ≤ 3 min after the start; `pts` = 5 when in time, else 0. A meriter trigger can award it like the status trigger: `after insert on skal_hour_posts … if new.in_time then perform olnu_mer_add(new.user_id, new.night, 'skal_hour', new.hour_id::text, new.pts, 20)` (cap 4 × 5 per night). Until then the client toast says "+5 meriter" from `pts`.

### RPCs (authenticated only; `not_authenticated` without a session; members only → `not_member`)
Skåltimme json (`olnu_skal_json`): `{id, group_id, group_name, auto, by (name, null when auto), by_me, created_at, ends_at, now, late_until (+60 min), needed (members who joined before the start, the starter too), posted (in-time posts of needed), done (past ends_at or all needed in time), mine, posts:[{k, name, is_me, at, sec, in_time, rank, photo_id (ONLY when the caller has posted, else null), w, h, gone}], missing:[{k, name, is_me}]}`. `k` = `olnu_gang_k` (never a user id).
| name | params | returns | errors |
|---|---|---|---|
| `skal_poll` | – | jsonb `{v, now, hours:[skåltimme json, my groups, last 70 min, newest first], fired:[hour ids]}`; also runs the random mode for my groups | – |
| `skal_state` | `p_group_id` | jsonb `{group_id, can_start, random_on, used, max: 4, next_at, win_from, win_to, now, hour (newest of the last 2 h) \| null}` | `not_member` |
| `skal_start` | `p_group_id` | skåltimme json | `not_member`, `not_allowed` (not chief / owner / vice), `skal_slow` (1 per 30 min per group), `skal_limit` (4 per night per group) |
| `skal_set_random` | `p_group_id, p_on bool` | `skal_state` json | `not_member`, `not_allowed`, `slow_down` (1 per 3 s) |
| `skal_hour` | `p_hour_id bigint` | skåltimme json (≤ 12 h old) | `skal_not_found`, `not_member` |
| `skal_post` | `p_hour_id, p_b64, p_w, p_h` | jsonb `{photo_id, rank, in_time, sec, pts, hour}` | `skal_not_found`, `not_member`, `skal_closed` (> 60 min), `skal_posted` (one per member), `invalid_photo` |
| `skal_photo` | `p_photo_id` | jsonb `{id, mime, w, h, b64}` | `photo_not_found`, `not_member`, `skal_locked` (caller has not posted in that skåltimme) |
| `film_shoot` | `p_group_id, p_b64, p_w, p_h` | jsonb `{left, mine, group_n, develop_at, night}` (no photo id) | `not_member`, `invalid_photo`, `slow_down` (1 per 3 s), `film_empty` (10 per member per group per night), `film_full` (60 per group per night) |
| `film_state` | `p_group_id` | jsonb `{now, night, develop_at, mine, left, max: 10, group_n, group_max: 60, shooters, keeps, rolls:[{night, evening, develop_at, n, alive}] (developed, newest first, max 10)}` | `not_member` |
| `film_roll` | `p_group_id, p_night timestamptz default null` (= newest developed) | jsonb `{night, evening, develop_at, developed, n, gone, expires_at, photos:[{id, k, name, is_me, at, w, h, reacts:[{e, n}], n, my}]}`; before 10:00 `developed:false`, no photos | `not_member` |
| `film_photo` | `p_photo_id` | jsonb `{id, mime, w, h, b64}` (developed, alive) | `photo_not_found`, `not_member` |
| `film_react` | `p_photo_id, p_emoji` (🔥 😂 😍 🍻 💀 👑 🫡 🥴) | photo json; same emoji again = off, another = replace | `photo_not_found`, `not_member`, `invalid_emoji`, `slow_down` (60/min) |
| `film_poll` | – | jsonb `{v, now, night, develop_at, groups:[{group_id, mine, left, group_n}], rolls:[{group_id, group_name, night, develop_at, n, push_mine}] (developed in the last 20 h)}` | – |
| `film_story` | `p_group_id, p_night date default null` (same night rule as `group_night_story`) | jsonb `{night, evening, develop_at, developed, n, skal_n, camera_photos:[{id, by, at, w, h, reacts, caption: null, camera: true}] (developed only, top 4 by reactions, then oldest)}` | `not_member` |

Rules:
- **Who starts**: 🎖️ gruppchef (`olnu_chief_of`), 👑 owner (`olnu_owner_of`) or 🎗️ vice (`olnu_is_vice`). The same people switch the random mode. Limits count manual + random together: 1 per 30 min, 4 per night (night = since the last 05:00 Europe/Stockholm).
- **Random mode (no pg_cron)**: pg_cron/pg_net are available on the project but not installed; a cron job would need a service key in the database to call notify-group and would run for every group every minute. Instead the first `skal_poll()` of a night by any member of a `random_on` group writes the secret `skal_plans.plan_at` (uniform 20:00–01:00 Europe/Stockholm; if that first poll is after 20:00, uniform from now + 2 min to 01:00). The first `skal_poll()` by any member at or after `plan_at` (before 01:00) fires it under the group advisory lock (`auto = true`, `started_by = null`, `fired_by = that member`) and returns its id in `fired`; that member's app sends the push. Blocked by the 30-min rule → retried 31 min after the blocking one (inside the window); 4 tonight → skipped (`hour_id = 0`). Trade-off: a random skåltimme fires only when somebody in the group has the app open (polls every ~20 s) — usually true on a night out, and nothing runs for idle groups.
- **Post to see**: `photo_id` / `skal_photo` only after the caller's own post (late posts unlock too). Before that the client shows blurred tiles with names. Late posts (3–60 min) are kept with `in_time = false`, `pts = 0`.
- **Engångskameran**: night = 05:00–05:00 Europe/Stockholm (`olnu_night_of`); develop = `olnu_gang_reveal(night)` = 10:00 the morning the night ends. Before that nobody (not even the shooter) gets a photo or an id — only counts. `film_poll` after 10:00 claims `film_rolls` (insert-on-conflict; the claimer gets `push_mine:true` for 10 min) → `notify-group {event:"film"}`.

### Edge function `notify-group` — new body events (v20 of the function, deployed 2026-10-20 on top of v19)
- `{event:"skal_hour", hour_id}` → every other member of that group. The row must have `fired_by = caller`, be < 3 min old and `notified = false` (atomic claim → true). Title `"🍻 SKÅLTIMMEN! 3 min – visa din dricka!"`, body from `SKAL_HOUR_BODIES` (15, `{namn}` = starter or "Slumpen", `{grupp}`), url `/?skal=<id>`, tag `olnu-skal-<id>`, TTL 180 s. Reasons: `no_hour`, `no_group`.
- `{event:"film", group_id, night}` → every other member. The `film_rolls` row must be claimed by the caller < 10 min ago, `notified = false` (atomic claim). Title `"Filmen är framkallad! 📸"`, body from `FILM_BODIES` (10, `{n}` photos, `{grupp}`), url `/?film=<group_id>`, tag `olnu-film-<group_id>`, TTL 4 h. Reasons: `no_roll`, `no_group`.

### Deep links
`?skal=<hour id>` → the skåltimme sheet; `?film=<group id>` → the newest developed roll. App open: sw.js posts the url → `app.js routeOpen` → `mods("openSkalLink", id)` / `mods("openFilmLink", gid)`. Cold start: skal.js / film.js read `location.search` in `onAuthed` / `onReadyShow` and remove the param.

### Frontend
- **Group page tiles** (`groupItem`, class `sk-gi` / `fm-gi`): "🍻 Skåltimmen!" (sub: `LIVE 2:31` / `📋 21:14 · 2/4 ikväll · 🎲`) and "📸 Engångskamera" (sub: `7 bilder kvar` / `Filmen slut · kl 10` / `🎞️ Ny film! 23 bilder`). No new map buttons.
- **Skåltimmen**: `skal_poll` with the app poll (≥ 20 s, not while hidden) and on `visibilitychange`. New live skåltimme → one toast (after the beer-type strip, `OLNU_STRIP.after`) + fixed foam-gold banner above the dock "🍻 SKÅLTIMMEN! 3 min – visa din dricka!" with a 1 Hz countdown, "📸 Visa", ✕ (hidden while the strip is up; stacks above the chief banner) + ONE urgent HUD chip `🍻 2:41` (`data-hx="skal"`). 📸 → file input (`accept=image/*`, `capture=environment`) → `PHOTO._shrink` → preview (Skicka / Ta om / Avbryt) → `skal_post`. Sheet: hero (countdown), blurred tiles + "🔒 Visa din dricka först…" before posting, photos after, results card when done (🥇 först in, 🐢 sist in, 🎖️ +5 meriter, ⏰ sent, 🫥 "Saknas i strid. …" per missing member, or an all-in line). Group sheet: start button (disabled with "Nästa om N min" / "Max 4"), 🎲 random switch (powers only), who-can-start line. Texts: 18 banner lines, 8 auto heads, 8 start, 6 first, 12 in time, 8 late, 16 missing, 5 all-in, 4 none-in, 5 locked, 6 result heads; the phone never repeats the last 12 of a list (`olnu.skalLines`). Keys: `olnu.skalSeen`, `olnu.skalHidden`, `olnu.skalPushed`.
- **Engångskameran**: `film_poll` on auth / app poll (≥ 45 s). Camera sheet = plastic camera: brand line, viewfinder with corner marks, green LCD frame counter, 10 film frames, red shutter → file input (`capture=environment`) → `PHOTO._shrink` → `film_shoot` at once (no preview), white flash (off with reduced motion), 12 click lines. Developed roll → banner "Filmen är framkallad! 📸" (once per roll, `olnu.filmSeen` / `olnu.filmHidden`) → film-strip gallery (sprocket holes, edge print "12A ▸ ÖL NU 400", name + time, 8 reaction chips, tap = viewer with 💾 Spara). Earlier rolls listed in the camera sheet.
- **Morgontidningen** (gang.js, patch `03-gang-paper.py`): after `group_night_story`, `FILM.addToStory(gid, evening, story)` sets `story.camera_photos` (+ `story.film`) from `film_story`; `storyModel` puts camera photos first (ids `"film:<id>"`, caption "engångskameran") for the front photo and the strip; `storyImg` loads them with `FILM._url`. Before 10:00 the paper uses the chat photos as before.
- **DB size**: film ≤ 60 × ~120 KB ≈ 7 MB per group per night, kept 7 days → up to ~50 MB per group that shoots the full roll every night (30-day keep: ~210 MB). Skål ≤ 4 × members × 120 KB per night, gone at 12:00. On the 500 MB free plan, watch `pg_total_relation_size('snap_photos')`; the next step would be Supabase Storage for the bytes.

## review2 (2026-10-20) — limits, poll lanes, group page folds
- Migration `0093_review2_abuse_limits.sql` (live). Same signatures and return shapes; new error `slow_down` where noted.
  - `create_group`: max 6 new groups per user per 24 h → `slow_down`.
  - `film_shoot`: max 30 film shots per user per night across all groups → `film_empty` (was only 10 per group).
  - `find_request`: max 3 requests to the same person per 30 min → `slow_down`.
  - `friend_request`: a request re-opened within 24 h of the last change keeps `notified = true` (no second push).
  - `owner_db_stats`: search_path `pg_catalog, public`.
- Client poll lanes (app.js): `onPoll` goes to every module each poll, EXCEPT the slow lane (MERITER, FILM, CEREMONY,
  HELG, PASSPORT, GOLDEN, EVENTS, HOMETOWN, KODEN): at most once per 60 s, all in the same wave. A new module that shows
  slow-changing data should join the slow lane. Hidden tab = no poll at all. Quiet chat (60 s without a new message or
  typing, `window.OLNU_CHAT_AT`) = slower photo / voice / reaction polls.
- Lazy start: `<script type="text/x-lazy">` and `<link rel="x-lazy-css">` load after the load event, or at once on the
  first `openSheet()` (`window.OLNU_LAZY_NOW()`). A module that reads a lazy content file must read the global on use
  (not at eval) and must not toast before it is there (see games.js / gang.js).
- Group page (js/gpage.js, LAST in mods): module tiles are sorted into folds by their wrapper class
  (`sk-gi, fm-gi, nr-tile, ff-gi, cr-gi` → Kvällen; `gm-gi, gg-gi, du-gi` → Spel; `cer-gi, hs-gline` → Dagen efter;
  unknown → Mer). Chat, gruppchef card, rally cards and any tile with a `.live`/`.new` child stay on top.
  A new module tile: give its wrapper a `<x>-gi` class and add it to BY_CLASS in gpage.js.
- Bottom banners: one at a time (skåltimme > gruppchef > film roll), CSS in skal.css.

## v26 LÄNKKORT + EGEN DOMÄN + PLAY-APP (additive)
### Link cards (migration 0060, edge function `card`, docs/js/cards.js)
- Shared links go to `<SUPABASE_URL>/functions/v1/card?t=<kind>&id=<id>[&l=en]` (override: `OLNU_CONFIG.CARD_URL`).
  Crawlers (UA regex: WhatsApp, facebookexternalhit/Facebot = Messenger + iMessage, Twitterbot, Telegram, Slack, Discord, …)
  get HTML with og:/twitter: tags; everybody else gets **302** to the app link at once. `&img=1` = 1200×630 PNG
  (resvg-wasm + Black Ops One / Chakra Petch from jsDelivr, black/yellow tabloid style); on render failure 302 to `docs/og-image.png`.
  Supabase rewrites text/html to text/plain on *.supabase.co, which is why people never see the page.
- Kinds: `invite` (no id) · `join` (group code) · `duelinv` (duel token) · `group` / `rally` / `duel` / `paper` (10-char share token).
- `share_card(p_kind, p_group_id, p_ref bigint default null)` → `{token, expires_at, kind}`; member only; ref = rally id / duel id
  of that group; reuses a live token of the same caller; 40 new per hour; expiry group 30 d, rally +12 h, duel ends+1 d, paper 3 d.
- `card_public(p_kind, p_id, p_ip)` (service_role only) → only safe data: group name, member / out-now counts (ghost pins not
  counted), bar name, rally sender FIRST name, yes/maybe counts, duel names + drinks, paper people + drinks; `go` = app query
  (`join=CODE`, `duel=TOKEN`, `chat=<gid>`, `rally=<id>`, `invite=1`). Rate limit: 60/min per IP bucket (4096 fixed rows) +
  1500/min global (table `card_rl`). Sequential ids are never accepted as card ids.
- Edge env: `OLNU_APP_URL` (default https://tunela.github.io/Beer-map/docs/). verify_jwt = false. Read-only except hit counter + rl.
- Client `window.CARDS` (mods: init): `url, prep, link, inviteUrl, joinUrl, duelInvUrl, withLink, rallyRow, duelRow`.
  Group-code + invite sheets share/copy the card URL (QR codes keep the plain app link). Rally sheet: "📤 Dela inkallelsen".
  Duel card (active/done): "📤 Dela ställningen". Morgontidningen: share text gets the paper card link.
  Tokens are made when the sheet renders (navigator.share must run inside the tap). Missing RPC = plain links, no button breaks.
- Static fallback: og:/twitter: tags + `docs/og-image.png` in docs/index.html and the root index.html.
### Own domain (prepared, OFF): `10-domain-switch.py <root> <domain>`, `docs/js/bridge.js`, scratchpad/domain-plan.md
- Pages source becomes `main /docs` (+ docs/CNAME, docs/.nojekyll, docs/docs/index.html for old links).
- `OLNU_CONFIG.APP_ORIGIN` + `BRIDGE_URL`: first start on the new origin with no account → once to
  `https://tunela.github.io/olnu-flytt.html` (repo TuNeLA/tunela.github.io) → back with `#flytt=<code>` (normal flytt import)
  or `#bridge=none`. The old origin is then locked like a flytt export (olnu.auth removed without signOut, olnu.moved=1).
### Android (Play) app
- TWA `se.olnu.app` (Bubblewrap, notification delegation on, minSdk 24). `docs/.well-known/assetlinks.json` lists se.olnu.app
  (upload key) + se.tunela.olnu (old test key). Android reads it at the DOMAIN ROOT → needs the TuNeLA/tunela.github.io repo
  until the own domain. Add Google's Play app signing SHA-256 with `04-assetlinks.py <root> <sha256>`.
- Public privacy policy for Play: `docs/integritet.html`.

## Design pass 4: polish2 (group sections, 🏆 tabs)
- Files: `docs/polish2.css` (loaded LAST, after polish.css) and `docs/js/polish2.js` (`window.POLISH2`, no app.js hook, no RPC).
  It watches `#sheet-body` with a MutationObserver. The DOM order is NOT changed; it only sets attributes, inline `order` and adds heads.
- **Group page** (`.gitem:not(.gcard) > div` gets class `gp`): every child gets `data-gp` = section and an inline CSS `order`.
  Sections: 0 = Chatt (primary, full width) · 1 Ikväll (Kalla in, call-outs, Skåltimmen, Engångskamera, Nätter tillsammans)
  · 2 Spel & kul (Lek, Förfest) · 3 Dagen efter (Gänget, Ceremoni) · 4 Gruppen (Truppen, Visa kod, Gruppchef, Helgstreak, and any UNKNOWN tile)
  · 5 Mer… fold (Spotify Jam, Utmana grupp; open state in `olnu.gpMore`).
  Heads are `.gp-h[data-s]`, the fold button is `.gp-more`. **A new tile:** give it a class ending in `-gi` (one `.btn` inside, with
  `.<x>-gl` label + optional `.<x>-gs` status) and add one line to `sectOf()` in polish2.js; otherwise it lands in "Gruppen".
- **🏆 sheet**: a `.tt-bar` (Topplistor · Meriter · Streak · Event · Pass) is put first in `#sheet-body`; each top-level child gets
  `data-tt` (top/mer/streak/ev/pass/all) and `#sheet-body[data-tt]` shows one tab (choice kept in `olnu.ttab`). Tabs without content hide.
  A new `topSheet` section: add its class to `ttOf()`; unknown sections show under Topplistor.
- ⚙️: a "👥 Kompisar & pass" heading before Ölpasset + Vänner; the duplicate "Önska en feature" heading is hidden.
- Tokens: use polish.css tokens (`--s1..s3`, `--hair`, `--r-*`, `--sp-*`, `--fs-*`). Mono (`--hud`) only for clocks and codes;
  stencil (`--display`) only for brand, ÖL! and big numbers. Accent cards = 1px hairline + `box-shadow: inset 3px 0 0 <accent>`, radius `--r-m`.

## PARTYSPEL (🎲 live party rooms: every player on their own phone, the host phone = the big screen; additive)
Migrations `0070_party_rooms.sql` (tables + helpers), `0071_party_logic.sql` (the state machine), `0072_party_rpcs.sql` (client RPCs + meriter trigger), applied on the server 2026-10-20 under the same names. Needs 0001 (`olnu_uid`, `group_members`), 0017 (`olnu_night_of`), 0036 (`olnu_mer_add`). No migration contains a row-removing statement. Client: `docs/js/party.js` (`window.PARTY`, defer, ~10 KB, in `mods()` after FORFEST), `docs/js/party-ui.js` (`window.PARTY_UI`) + `docs/js/party-content.js` (`window.PARTY_CONTENT`) as `type="text/x-lazy"`, `docs/party.css` as `rel="x-lazy-css"` (party.js loads all three on the first open). A missing RPC (old database, PGRST202) = the tile hides.

### Sync (decision)
RPC polling: `party_state(room, v)` every 1.2 s, only while the overlay is open and the page visible; an unchanged room answers `{same:true, v, host_away}` (a few bytes). Realtime `postgres_changes` cannot work (RLS, no policies). Realtime BROADCAST would only be a "poke" (the payload can never hold secrets, so every phone must still call `party_state`), adds a websocket per phone and a second failure path in bad bar wifi; polling alone gives ≤ 1.2 s lag and is simpler, so no Realtime is used.

### Tables (RLS on, no policies, no client access; service_role has all; rows are never removed, reads filter on time)
`party_rooms(id, code A–Z×4 (no I/O), host, group_id, game, phase, round, step, game_no, opts, pub (public state), sec (secret state, never returned whole), v, started_at, created_at, updated_at, expires_at = created + 3 h, closed)` · `party_players(room_id, user_id, k = md5 key, name, is_host, status in|out|wait|tv|left, in_game, ord, score, wins, out_round, joined_at, seen_at)` · `party_inputs(room_id, game_no, rk, user_id, val)` (one input per step, upsert until the step closes) · `party_results(room_id, game_no, user_id, game, won, night, players)` (meriter event) · `party_limits(user_id, kind, win_start, n)`. The 0016c erase sweep moves `user_id` like every uuid column.

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `party_create` | `p_group_id uuid default null, p_name text default null (group display name), p_game text default 'imposter'` | view | `invalid_game`, `not_member`, `invalid_name`, `slow_down` (15/h), `busy`. Closes the caller's other open hosted room. |
| `party_join` | `p_code text, p_name text default null` | view (in the lobby/after a game `status in`, mid-game `wait`; same name → "Namn 2") | `room_not_found`, `invalid_name`, `room_full` (16), `slow_down` (30 / 10 min) |
| `party_state` | `p_room uuid, p_v int default 0` | view, or `{same, v, host_away}`, or `{closed, expired}`; marks seen (max 1 write / 10 s) | `room_not_found`, `not_in_room` |
| `party_act` | `p_room uuid, p_act text, p_val text default null, p_data jsonb default null` | view (`{left}` / `{closed}` for leave/close) | `not_host`, `not_now`, `not_your_turn`, `invalid_vote`, `invalid_answer`, `own_answer`, `invalid_member`, `invalid_game`, `invalid_content`, `too_few`, `room_closed`, `slow_down` (150/min) |
| `party_group` | `p_group_id uuid` | `{room:{id, code, game, phase, n, host_name, is_in, is_host, expires_at}|null}` (newest open room of the group) | `not_member` |
| `party_mine` | – | `{room:{id, code, game, phase, is_host, group_id}|null}` (after a reload) | – |

View = `{v, now, id, code, game, phase, round, step, game_no, opts, expires_at, group_id, closed, host_k, host_name, host_away, me:{k, name, is_host, status, in_game, score, wins, can_host}, players:[{k, name, is_host, status, in_game, score, wins, is_me, done, need, on}], pub, priv}`. `priv` holds ONLY the caller's secret: `mine` (own input this step), Imposter `{imp, word | hint, imp_n}`, Vågen psychic `target`, Hatten `my_slip`. Hatten slips come out one at a time (`pub.slips` cut to `step` in `reveal`). Votes are never returned with the voter (`tally.votes` = shuffled target names, for the slow reveal).

Host moves (`can_host` = host, or anyone when the host was not seen for 45 s / left): `start` (`p_data {game, opts, list[]}`: the content strings, the SERVER picks word/imposters/target), `next` (force the step), `tovote`, `accept` (approve a near-miss imposter guess), `all` (show all slips), `lobby`, `game` (p_val), `kick` (p_val k), `close` (host only). Anyone: `leave` (the host role moves to the most recently seen player). Inputs: `ready`, `done` (turn player / psychic), `vote` (k), `answer` (k or text 60 / 30), `best` (slip index, not own), `slide` (0–100), `guess` (text). A step closes by itself when every needed player has sent its input.

### Games (phases)
- **imposter** (min 3; 2 imposters need 5): `roles` (ready) → `clue` (turn order, 1–3 rounds; later cycles 1 round) → `vote` → `result` (`tally, out_k, out_imp, after`) → `guess` (caught imposter: one guess; Levenshtein ≤ 1, ≤ 2 for 9+ letters; host may `accept`) → `guessed` → `end` (`win imp|crew, word, imps, winners`). Tie: no one out (elimination on → new cycle, else imposter wins). Elimination mode: a voted-out crew member is `out` (waiting screen) and the game goes on while imposters < crew. Score: crew +1, imposter +2.
- **survivor** "Östra lägret" (min 3): `challenge` (prompt) → `vote` → `result` (most votes out, tie = lot) → … two left → `final` (jury = voted-out players vote between the finalists) → `end`. Winner +3, runner-up +1.
- **hatten** "Namn i hatten" (min 3; 3–15 rounds; prompts `w|` name a player or `t|` write): `write` → `reveal` (one slip per `next`) → `score` (w: everyone who named the top name +1) or `vote` (t: best answer, not own) → `score` (+1 per vote to the author, authors shown) → … → `end`.
- **flocken** (Herd Mentality): `write` (one answer, 30) → `score` (groups by normalised answer; the single biggest group of 2+ gets +1; exactly one lone answer = 🐄 kossan, who cannot win) → … → `end`.
- **vagen** (Wavelength): `clue` (the psychic sees `target` 5–95 and says a clue, `done`) → `guess` (everyone else `slide`) → `score` (≤4 → 4 p, ≤9 → 3, ≤16 → 2, ≤25 → 1; the psychic gets the round average) → next psychic → `end`.

### Meriter (CONTRACT v26 ledger; trigger `olnu_zz_mer_party` on `party_results`)
| kind | action | pts | cap per night |
|---|---|---|---|
| `party` | a finished party game with 3+ players that ran ≥ 60 s | 2 | 3 games (6) |
| `party_win` | won that game | 3 | 3 wins (9) |
meriter.js `ACTS` + `LINES` have both kinds (party-patches 04).

### Frontend
- Ways in: group page tile "🎲 Partyspel" (`groupItem`, row `.pt-gi`, `data-gsec="spel"` for the review2 folds; when the group has an open room it turns into "🎲 Partyspel pågår · KOD" with class `live`, so the folds keep it on top), "🎲 Partyspel" in both Lek sheets (`PARTY.lekButton`), the join link / QR `?party=CODE` (read at script start, opened after the intro), a "Du ä med i partyrum X · Tillbaka" toast after a reload (`party_mine`).
- Overlay `#pt` (z-index 2150, like `#ff`); opens only after the beer-type strip (`OLNU_STRIP.after`), closes the open sheet, Android back closes it (the room lives on). Screen Wake Lock while a room is open.
- Host phone = big screen (code + QR + players + game picker + options in the lobby; whose turn, progress, slow vote reveal ≥ 1.1 s per vote, results, scoreboard). "🤫 Min lapp" flips the host to their private view (card, vote) and back. Option "📺 Min lur ä bara storskärmen" (host does not play). Players: big buttons, one-hand; voted-out players get "UTSLAGEN"/"JURYN" screens with rotating dalmål lines; mid-game joiners "I RESERVEN".
- Content (`party-content.js`): 15 Imposter categories × 42 words with vague hints (Länder, Städer i Sverige, Mat, Kändisar, Filmer, Varumärken, Djur, Dalarna, Öl & drinkar, Sport, Yrken, Saker hemma, Platser, Musik, Lumpen & militärt), 42 Östra lägret challenges, 90 Namn i hatten prompts (50 w, 40 t, `{namn}` = a random player), 63 Flocken questions, 50 Vågen scales, ~130 status lines. No repeats in one browser session (`sessionStorage olnu.partyUsed`); only ADD at the end of a list. Prefs in `localStorage olnu.party`.

## v28 INBJUDNINGAR (📨 invites, 👥 one friend list, ➕ user places, 🏠 Hemzon, map legend; additive)
Migrations `0080_invites.sql`, `0081_invite_push.sql`, `0082_place_suggestions.sql`, `0083_invite_meriter.sql` (applied on the server 2026-10-21 under the same names). Needs 0001, 0016 (uuid sweep moves the new uuid columns), 0027/0030/0033/0045 (friends, presence, `olnu_chief_k`, `olnu_home_town`), 0036 (`olnu_mer_add`), 0065 (`bar_events`). No migration contains a row-removing statement. Client: `docs/js/invite.js` (`window.INVITE`), `docs/js/mapmenu.js` (`window.MAPMENU`), `docs/js/homezone.js` (`window.HOMEZONE`), `docs/invite.css`; small patches in app.js, near.js, events.js, bars.js, meriter.js, v14.js, sw.js, stats.html, stats-extra.js. Scheduler: `.github/workflows/reminders.yml` + `scripts/remind-invites.mjs`. A missing RPC (old database, PGRST202) = that part hides.

### Tables (RLS on, no policies, no client access; service_role has all)
`invites(id, creator, title 1–80, kind, bar_id, place ≤ 60, lat, lng (5 decimals), starts_at, ends_at = start + 6 h, note ≤ 200, event_id, group_id, spot bar|spot|here, status open|cancelled, reminded_at, yes_push_at, created_at, updated_at)` · `invite_people(invite_id, user_id, invited_by, answer none|yes|maybe|no, answered_at, notified, yes_pushed, created_at)` pk (invite_id, user_id); the creator is a row with `yes` · `place_suggestions(id, user_id, name 2–60, type bar|pub|restaurant|cafe|nightclub|other, note ≤ 200, lat, lng, bar_id 'u-<slug>-<id>' unique, status pending|ok|rejected, created_at, status_at)`.

### RPCs (authenticated only; `not_authenticated` without a session)
| name | params | returns | errors |
|---|---|---|---|
| `friend_list` | `p_name default null` | jsonb `{v, people:[{key, name, home_town, out, town, friend_id, friend, via, groups:[{id, name}], find_key, add:{g, k}\|null}], groups:[{id, name, n}]}` — accepted friends (0045) ∪ everyone in a shared group (max 400), out first | – |
| `invite_create` | `p_title, p_starts_at, p_keys text[], p_group_ids uuid[], p_bar_id, p_place, p_lat, p_lng, p_note, p_kind, p_event_id, p_spot, p_group_id, p_name` (all but title/time default null/empty) | invite json + `added` | `invalid_invite` (title, no links, start −30 min…+30 d, position), `no_invitees`, `too_many` (60), `slow_down` (1 / 10 s, 30 per 24 h), `not_member` |
| `invite_add` | `p_id, p_keys, p_group_ids, p_name` — any participant, from THEIR friends | invite json + `added` | `invite_not_found`, `invite_over`, `no_invitees`, `too_many` |
| `invite_answer` | `p_id, p_answer yes\|maybe\|no` | invite json + `push_yes` | `invalid_answer`, `invite_not_found`, `invite_over` |
| `invite_get` | `p_id` | full invite json | `invite_not_found` (also for non-participants) |
| `invite_cancel` | `p_id` (creator) | invite json | `invite_not_found` |
| `my_invites` | – | jsonb `{v, now, invites:[lite json]}` — mine, not over (cancelled ones 12 h), by start, max 30 | – |
| `suggest_place` | `p_name, p_type, p_lat, p_lng, p_note default null` | jsonb `{id, bar_id, status:'pending', name, type}` | `invalid_place`, `outside_sweden` (= bad position), `slow_down` (1 / 20 s, 5 per 24 h) |
| `user_places` | `p_lat, p_lng default null` | jsonb `[{id, name, type, lat, lng, pending, mine}]` — approved within ~40 km + my own pending | – |
| `owner_places` / `owner_set_place` | `p_key, p_status` / `p_key, p_id, p_status ok\|rejected\|pending` | like `owner_events`; ok = upsert into `bars_lite` (active, id = bar_id), rejected = hidden (+ `bars_lite.active=false`) | 403 `forbidden`, `invalid_status`, `place_not_found` |
| `invite_push_claim(p_id, p_uid)`, `invite_yes_claim(p_id)`, `invite_yes_due()`, `invite_due_claim(p_id default null, p_uid default null)` | **service_role only** (notify-group) | atomic UPDATE … RETURNING claims | – |
Invite json: `{id, title, kind, bar_id, place, lat, lng, starts_at, ends_at, note, event_id, spot, status, group_name, creator_name, mine, my_answer, yes, maybe, no, none, n, reminded, live, can_add, people:[{name, answer, is_me, is_creator, by, at}] (full only)}`. Never user ids; `key` = md5(viewer:user:olnu-inv)[0:16], resolved only inside the caller's own friends + group-mates, so nobody can invite a stranger.
Privacy: an invite (and a long-press "Skapa event här" event) is readable ONLY by its participants; it never enters `bar_events`, the public 📅 list, other people's ticker or map.

### Edge function `notify-group` — new body events (v22, merged on top of deployed v21)
| body | who gets it | limit | payload |
|---|---|---|---|
| `{event:"invite", invite_id}` | invitees the caller added that were not pushed yet | `invite_push_claim` (notified false→true) | title 1 of 6, e.g. "📨 TuNe har bjudit in dig: 🧠 Pubquiz på Pitchers, tors 22/10 19:00" ("ikväll 19:00" the same evening); body "Svara: ✅ Kommer · 🤔 Kanske · ❌ Kan inte"; actions yes/no; url `/?inv=<id>`; tag `olnu-inv-<id>`; TTL until start (15 min – 24 h) |
| `{event:"invite_yes", invite_id}` | the creator | max 1 per 10 min per invite (`yes_push_at`); yeses in between ride along in the next push (cron flush) | "✅ Lisa och Oskar kommer på …" / "✅ Lisa, Oskar +2 kommer på …"; body "N kommer totalt · <tid>"; tag `olnu-inv-yes-<id>` |
| `{event:"invite_due", invite_id}` | yes + maybe | once per invite (`reminded_at`), start in 50–70 min | "⏰ Om 1 timme: <titel> – 3 kommer"; body "<tid> · 2 kanske. Tryck för vägen dit."; tag `olnu-inv-due-<id>`; TTL 1 h |
| cron: `{event:"invite_due"}` + header `x-olnu-cron: <service key>` | every due invite + yes flush | the key is checked by calling the service-role-only RPC `invite_due_claim` with it (apikey header only; Bearer only for a legacy JWT key); wrong key → 403, nothing sent | as above |
Scheduler: no pg_cron → `.github/workflows/reminders.yml` (`*/10 * * * *`, + manual run) runs `scripts/remind-invites.mjs`: POST `/functions/v1/notify-group` with the public anon JWT (from docs/config.js) as Authorization/apikey (passes verify_jwt) and `x-olnu-cron: $SUPABASE_SERVICE_ROLE_KEY`. Secrets `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` already exist (events.yml). Fallback: a participant's app (yes/maybe) sends `{event:"invite_due"}` once when the start is 51–69 min away (same claim).

### Deep links
`?inv=<id>[&ans=yes|no]` (push tap / buttons; sw.js adds `ans` for the action buttons; app.js `routeOpen` → `mods("openInviteLink")`; cold start: invite.js reads and removes it). NOTE: `?invite=1` stays the old "invite a friend to the app" link (app.js strips it), so invites use `inv`.

### Frontend
- **👥 Grupper | Vänner** (bottom "Grupper"): segmented control (`.inv-tabs`, last tab `olnu.gtab`); INVITE is last in `mods()` so its `groupsSheet` hook moves the whole groups sheet into pane 1. Vänner = near.js block (`NEAR.buildFriends(box)`: requests, add by code, my code + QR, find-me switches) with the list replaced by `INVITE.friendsMore`: one row per person (name, demonym, "🍺 ute nu i <stad>" / "🌙 int' ute", "👥 TPM, Jobbet", 🧭, 📨, ✕ for real friendships). ⚙️ "👥 Vänner & 🧭 Hitta" and `?friends=1` open this tab (near.js `openFriends()` → `INVITE.openFriendsTab()`), so there is one place.
- **Start an invite**: bar sheet box (`.ev-line inv-line`, lifted under the title): "📨 Bjud in hit" + my invite here ("📨 ikväll 20:00 · 3 kommer") + "📅 Kommande här" (future `events_near` rows at that bar, max 3, each 📨); 🏆 event rows and the tonight `.ev-line` get 📨 next to "🪖 Vi går!"; a friend row 📨; map long-press. Composer: title (auto "🍺 Pitchers" / "🧠 Pubquiz på Pitchers" / "🏠 Hemma hos TuNe"), datetime (default tonight 20:00, after 19:30 the next half hour + 30), Var? (current spot, "📍 Här där jag ä (GPS)", bars within 1.5 km; a non-bar point gets an editable label: nearest named spot ≤ 60 m, else "Hemma hos <namn>"), note, picker (search, checkboxes, "👥 Hela <grupp> (n)" chips; a chip also sends `p_group_ids`).
- **Invite sheet**: time + countdown, place + "🧭 Vägen dit" (Google Maps directions) + "🗺️ Karta", from / group / 🔒 privat plats, note, answer segment ✅ Kommer / 🤔 Kanske / ❌ Kan int', lists per answer with "(via X)", "📨 Bjud in fler", creator "Ställ in" (confirm). Refreshes every 20 s while open.
- **Poll** `my_invites` on sign-in, with the app poll (60 s; 30 s when one starts within 2 h), when visible. Toast once per new invite (`olnu.invSeen`) with "Svara". 📨 map pin (pane `invites`, z 645, label hidden below zoom 13) for each live invite not answered no.
- **⏳ HUD chip** `data-hx="inv"` (`.inv-chip`): next invite I said yes to (or made) within 48 h: "⏳ 1 dag till Pubquiz" / "⏳ 2 tim till …" / "⏳ 15 min till …" / "🍻 Nu: …" until 1 h after start; `hx-urgent` from 1 h before (app.js picks it after 🚑 / chief / 🧭 chips; ONE urgent chip on the closed pill).
- **Ticker**: `NEWS.build` wrapper: on a quiet night (< 5 drinks within 5 km) 1 or 2 of 6 lines (alternating, ≈ 1 in 4) are event/invite lines (kinds `ev*` from events.js + `evMix` / `invMix`, 24 dalmål lines: tonight / tomorrow / later / quiet / group invites "📨 3 i TPM ska till Pitchers på torsdag"); never two in a row (also across refills); filler goes first, the last dead-town joke stays. Invite lines exist only on participants' phones.
- **Long-press** (mapmenu.js): 600 ms still (≤ 10 px), touch or mouse, never on markers/popups/controls, not during a pinch or while a sheet is open; the click after it is swallowed. Menu: "📨 Skapa event här" (composer with kind chips, private), "📍 Bjud in hit", "➕ Lägg till ställe här" (name, type chips, note; "Finns redan: X?" for a similar name ≤ 80 m with "👍 Ja, dä ä den" / "➕ Nej, lägg till ändå"; the pending place joins `BARS` at once via `BARS.addUser` with "⏳ Väntar på godkännande · syns bara för dig" in its sheet). stats.html "➕ Nya ställen": Godkänn / Avvisa / Väntar, OSM link, nearby bars warning.
- **🏠 Hemzon** (homezone.js, `settingsName` hook, right under the name / 📍 Hemstad): "🏠 Hemzon: på · 300 m ›" → sheet: map preview (tap = home point), "📍 Använd nuvarande plats", radius slider 100–1000 m, Spara / Ta bort. Same `olnu.home {lat, lng, r}` (v14 `PRIVACY.inHome` uses `r`); the old bottom block hides when homezone.js is loaded.
- **Map legend** (ⓘ popover): pins = live now; 🔥 glow = heat tonight (live + tonight's trail, gone at 05); 👻 grey dashed rings = last week's spots (`ghost_points`, not live; auto-on when < 3 drinks within 5 km, or the 👻 chip) — "half circles" are those rings cut by a pin or the screen edge; 📨 = your invite.

### Meriter (0036 ledger; triggers `olnu_zz_mer_inv_ci` on checkins, `olnu_zz_mer_inv_beer` on beers)
| kind | action | pts | cap per night |
|---|---|---|---|
| `invite_show` | said ✅ Kommer and then a check-in at the invite's bar, or a check-in / precise drink within 150 m of the invite spot, within ±2 h of the start (once per invite) | 3 | 2 (6) |
meriter.js `ACTS` + 10 `LINES`.

## 🗺️ KARTSTIL BETA (vector basemap under Leaflet; client only, no migrations)
- Files: `docs/js/basemap.js` (`window.BASEMAP`, in `mods()`: `init`, `settingsSheet`, `applyText`), `docs/karta3d.html` + `docs/js/karta3d.js` (phase 2 demo, NOT linked from the app). Patches map1 01–05: index.html (CSP `worker-src 'self' blob:` for the GL workers; `js/basemap.js` before app.js), app.js (`BASEMAP.early(map, rasterTileLayers)` right after the ⓘ attribution block; `window.BASEMAP` in `mods()`), sw.js (OpenFreeMap in `olnu-tiles`), config.js (`MAPBOX_TOKEN`).
- Setting ⚙️ "🗺️ Kartstil": Klassisk (default) / Natt / Grafit / Neon (beta) / Mapbox natt (beta, only with `MAPBOX_TOKEN`). localStorage `olnu.mapStyle` = `classic|natt|grafit|neon|mapbox`. Switching is live. To make Natt the default for everyone: `DEFAULT = "natt"` in basemap.js.
- Natt/Grafit/Neon: MapLibre GL JS `maplibre-gl@5.24.0` (UMD) + `@maplibre/maplibre-gl-leaflet@0.1.4` from jsDelivr, loaded lazily only when chosen (Klassisk users load nothing new). Style = `https://tiles.openfreemap.org/styles/liberty` fetched at run time and recoloured in `recolor()` (palettes `BASEMAP.PALETTES`): POIs, shields, one-way arrows, the 3D extrusion and the Natural Earth raster are dropped; flat building footprints from z13; Swedish names first (`name:sv`, then `name`; English UI: `name_en`); a blurred glow line under motorway/trunk/primary.
- Mapbox natt: `mapbox-gl@3.32.0` + `mapbox-gl-leaflet@0.0.16` (jsDelivr, lazy), `mapbox://styles/mapbox/standard` with `config.basemap` (lightPreset night, POI/transit labels off, 3D objects off, amber motorways/trunks). One Mapbox map object per page life (= one billed map load); switching away detaches it, switching back re-attaches it. Our own Mapbox logo (`.bm-mblogo`, mapbox-gl.css) sits just above the ⓘ button while it is active (Mapbox terms). Not dropped while hidden (re-creating it would bill a new map load).
- Z-order: the GL canvas lives in Leaflet's `tilePane` (z 200), under the heat canvas (overlayPane z 400) and all marker panes. Markers, clusters, heat, popups unchanged. The raster layers stay on until the GL map fires `load`, then they come off. Failure (no WebGL, script/style load error, context lost, Mapbox 401/403 on the style) → Klassisk for this page life (+ toast when the user picked it).
- Memory: `visibilitychange` hidden → the MapLibre layer is removed (WebGL context released); visible → re-added from the kept style object (same idea as app.js memShed). `pixelRatio` capped at 2, `maxTileCacheSize` 60.
- Attribution in the ⓘ popover (`#attrib-pop`): Klassisk = the raster layers' text; MapLibre styles = "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors"; Mapbox = "© Mapbox © OpenStreetMap Improve this map". The popover opens by itself for 5 s when a GL style starts (not while the beer-type strip is up) and closes on map move (OSMF guideline: collapsed "i" is OK after that).
- sw.js: `tiles.openfreemap.org` in `TILE_HOST`; `/styles/*` and `/planet` (TileJSON) network first (4 s) with the cached copy offline; sprites, glyphs, vector tiles cache first like raster tiles (`TILE_MAX` 300 entries + new `TILE_BYTES` 40 MB cap, size in `x-olnu-size`). Mapbox requests are not cached.
- Mapbox token: the URL restriction must be the ORIGIN `https://tunela.github.io` (a path such as `/Beer-map` fails: GL JS fetches tiles from a worker that sends only the origin as Referer → 403 on tiles, while the style request passes).

## Design system: ds.css + js/ds.js (design5)
- Files: `docs/ds.css` (the LAST stylesheet; `js/ds.js` puts any later sheet CSS and injected `<style>` in front of it) and
  `docs/js/ds.js` (`window.DS`, deferred after polish2.js, no app.js hook, no RPC). New UI uses the `--ds-*` tokens and `.ds-*` classes.
- **Tokens.** Spacing `--ds-1..6` = 4/8/12/16/24/32. Type `--ds-fs-12/14/16/18/22/28` with `--ds-lh-*` 16/20/24/24/28/32, weights 400/600/700,
  `--ds-sans` (Chakra Petch) for all text; `--ds-stencil` (Black Ops One) only for the logo, ÖL!, big numbers and short sheet titles.
  Colour `--ds-bg #0a0f1c`, `--ds-sheet #121a2a`, `--ds-card #19233a`, `--ds-raised #222e48`, `--ds-border`, `--ds-text`, `--ds-text-2`, `--ds-muted`,
  `--ds-amber` (action/you), `--ds-green` (live/ok), `--ds-red` (alarm), `--ds-blue` (info); text variants `--ds-*-t` and inks `--ds-on-*`
  are ≥ 4.5:1 on every surface. Radius `--ds-r-1/2/3` = 12/16/20 + `--ds-r-pill`. Depth `--ds-sh-1/2/sticky`. Motion `--ds-ease`, `--ds-t-1/2/3`
  (0 ms with prefers-reduced-motion). The old names (`--s0..s3`, `--hair`, `--r-*`, `--sp-*`, `--fs-*`, `--night*`) now point at these.
- **Components.** `.ds-section` (`.ds-section-h` + `.ds-list`), `.ds-list`/`.ds-row` (56–64 px rows with dividers; `.ds-row-i` icon,
  `.ds-row-t` title + `small`, `.ds-row-v` value, `.ds-chev`), `.ds-btn` + `-primary/-secondary/-ghost/-danger` (48 px; = `.btn`, `.btn-amber`,
  `.btn-ghost`, `.btn-danger`), `.ds-seg` (= `.tabs`, `.seg`, `.bp-seg` in sheets), `.ds-toggle-row` (= `.toggle-row` + `.switch`; the whole row
  taps the switch), `.ds-card`, `.ds-chip`, `.ds-badge`, `.ds-empty`. Sheet rhythm: title · sections 24 px apart · 8 px between items · 16 px sides.
- **Sticky tabs.** `.inv-tabs` (Grupper | Vänner) and `.tt-bar` (🏆) are sticky at the top of `#sheet-body` on a solid sheet background
  (z-index 20); `#sheet-body.ds-scrolled` adds the shadow. A new sticky bar: put it first in `#sheet-body`, `top:calc(-1 * var(--ds-4))`.
- **⚙️ sections.** After the settings sheet is built, ds.js MOVES (never rebuilds) its blocks into `section.ds-section[data-ds]`:
  profil · vanner · stat · notis · integ · karta · skoj · om · mer. Each block becomes `.ds-item` in a `.ds-list`; a block with a field, a
  segmented control or the Wrapped chips is `.ds-blk` and shows its old h3 as the label. **A new settingsSheet block:** append an `h3` + your
  `.row`/`.toggle-row` as before; it is placed by `secOf()` (class/text rules) or by the h3 text (`headSec()`), else in "Mer". Add one line to
  `secOf()` for a precise place. Descendant selectors keep working; `#sheet-body > X` selectors for settings blocks do not.

## 📳 ÖLGLASET (shake → fill the screen with beer, tilt → drink it; client only, no migrations)
- **Files.** `docs/js/olglas.js` (window.OLGLAS) + `docs/olglas.css`. index.html names them `<script type="text/x-lazy" data-demand>` and
  `<link rel="x-lazy-css">`: never fetched at start, and boot.js skips `data-demand` scripts at idle. delight.js loads both on demand.
- **One shake detector.** It stays in delight.js (devicemotion, Σ|Δa| > 32, one peak per 110 ms). 3 peaks within 1 s → `OLGLAS.open()`
  (3 s gap after a close); while open each peak → `OLGLAS.peak()` (+14 % beer up to the brim 0.97, more foam, haptic tick; 6–8 shakes = full). If olglas.js cannot load, the
  old foam joke runs. Setting `olnu.dl.shake` ("📳 Skaka = fyll glaset: På/Av", default on; iPhone: on after the permission).
- **Permissions.** iPhone: `DeviceMotionEvent.requestPermission()` + `DeviceOrientationEvent.requestPermission()` in the same tap, once,
  from the ⚙️ toggle (friendly sheet) or "🍺 Testa ölglaset". Result in `olnu.og.perm` ("1"/"0").
- **Glass.** One full-screen canvas (`.og`, z-index 2900: over sheets/toasts, under takeovers). DPR ≤ 2; on close the canvas is set to 0×0
  and removed. Gravity from deviceorientation (β/γ, screen.orientation aware), else accelerationIncludingGravity.
- **REAL GLASS (pour):** the screen's top edge (current orientation) is the open rim, the other 3 edges are walls. The beer is a constant
  volume A; the surface is always ⟂ gravity, its offset solved every frame (closed-form box ∩ half-space volume + bisection). If the level
  would stand above the lowest rim point, it runs out there (weir: dA/dt ∝ head^1.5, faster with more tilt, max 1.3/s) until A = what the
  tipped glass holds: half glass ≈ 66° (portrait), full ≈ 15°, upside down empties in < 1 s. Pour = tongue + foam on the wet rim, drops,
  streaks to the rim, gentle buzz. 24-point spring wave sloshes; a crest at the rim splashes over. Foam head on the tilted surface;
  above the rim it runs over (band + drips there). rAF only while something moves. Reduced motion: no wave/particle motion, level + pour work.
- **Drink.** Not a special mode: with the screen facing down the glass gets depth (1.5·H), so tipping the top towards the face (β > ~95°
  full, ~125° half) makes the beer run over the whole top edge, "glugg" particles, gulp sound only with 🔊 in the overlay (`olnu.og.snd`, default off, never when muted).
  Empty → dalmål toast (34 sv / 8 en lines) with **"🍺 Logga som öl?" = `#btn-beer.click()`**: the normal ÖL! path with all its rules and the
  10-min limit (in cooldown: a wait toast). Nothing is logged by itself. No medals / meriter.
- **Never over the strip.** `open()` waits with `OLNU_STRIP.after()`; if the strip comes up while open, the glass closes.
- **Closes on** ✕, hold 1 s anywhere, Esc, page hidden, 90 s idle, strip, empty.
- **No sensors.** Long-press ÖL! 0.7 s (outside the cooldown, only before any motion event was seen; the click after it is swallowed) or
  ⚙️ "Testa ölglaset". Drag / arrow keys turn the simulated gravity: sideways / ←→ = roll, up / ↑↓ = tip towards the face, S/space = shake.
- **Public.** `OLGLAS = { open({level, api}), close(why), isOpen(), peak(k), state(), closedAt(), lines, _state() }` (`_state` = test hook:
  A, ang, tAng, nz, spill rate/s, cap, head, margin, visible area, rim, over); `DELIGHT.glass(opts)`; event
  `olglas:close` on document (`detail.why`: x | hold | esc | hidden | idle | strip | empty).

## v29 EVENTCHATT (💬 a temporary group chat for every invite; additive)
Migrations `0084_event_chat.sql`, `0085_event_chat_rpcs.sql` (applied on the server 2026-10-21 under the same names). Needs 0080/0081 (invites), 0045 (`olnu_friend_name`), the group chat tables (`group_msgs`, `group_msg_likes`, `group_msg_reacts`, `chat_photos`, `voice_msgs`). No row is ever removed. Client: `docs/js/evchat.js` (`window.EVCHAT`), `docs/evchat.css`; patches evchat 01–05 (index.html, app.js `mods()` order, social.js, invite.js, this section). Edge function `notify-group` **v23** (merged on top of v22). A missing RPC (old database) = the chat parts hide.

### Model
- Every invite gets a **temp group** on insert (trigger `olnu_tg_inv_ins`, also a backfill for running invites): a normal `groups` row (name = invite title + " · tors 22/10", max 40 chars, a random valid 6-letter code, **`created_by` NULL** so `create_group`'s 6-per-24-h limit never counts it) plus `temp_groups(group_id pk → groups, invite_id unique → invites, creator, open_until = start + 12 h, hide_at = open_until + 7 d, closed_at, created_at)`.
- **Nobody is ever a `group_members` row of a temp group** (BEFORE INSERT guard `olnu_tg_guard` raises `group_not_found`, so `join_group` with its code fails too). That keeps it out of everything built on membership: `my_groups` / Grupper list, `friend_list` + `olnu_inv_cands` (no friends-from-temp-groups), pins / names on the map, duels, leagues, boards, meriter ("natt med truppen"), crew, gang, chief, skål, film, ceremonies.
- **Access** (`olnu_tg_access(group, uid)` → `none|read|write`, from `invite_people`): creator + ✅ yes + 🤔 maybe = write; invited without an answer or ❌ no = read (they see the chat and can join by answering, also people added later with "📨 Bjud in fler"); after `open_until` or a cancel (`closed_at`, invite `cancelled`) = read ("🗄️ Arkiverad" / "🚫 Inställt"); after `hide_at` = none (gone from lists, chat RPCs say `not_member`).
- **One membership test for the chat**: `olnu_chat_can(group, uid, write)` = a `group_members` row OR the temp access. 0085 re-creates the chat RPCs from the deployed versions with only that line changed (same signatures and shapes): `group_msgs`, `post_group_msg`, `react_msg`, `msg_reacts`, `like_msg`, `msg_likes`, `post_photo`, `group_photos`, `group_photo`, `post_voice`, `group_voices`, `voice_audio`. Reads need read, posts / reactions need write. Names of temp participants come from `olnu_friend_name` (no display_name row). `group_keep_history` / `set_group_keep_history` are NOT changed: a temp group answers `not_member`, so the 💾 switch hides and keep_history stays off. Messages, photos and voice follow the normal 05:00 rule.
- **System lines** are `group_msgs` rows whose body starts with U+2063 (`olnu_tg_say`, user_id = the person): "📨 TuNe skapade eventet …" (insert), "✅ Ida kommer …" / "🤔 Robert kanske …" (trigger on `invite_people.answer`, once per person and kind via `temp_group_said`, so flipping answers cannot spam), "⏰ Om 1 timme! …" (when `invites.reminded_at` is set by `invite_due_claim`), "🚫 Eventet ä inställt …" (cancel). 10–11 dalmål variants each (`olnu_tg_lines`). They expire at the 05:00 after the event start (not earlier). `post_group_msg` strips U+2063 from user text, so nobody can fake one.

### RPCs
| name | params | returns | errors |
|---|---|---|---|
| `my_event_chats` | `p_seen jsonb default null` (`{"<group_id>": last seen msg id}`) | jsonb `{v, now, chats:[{group_id, invite_id, title, name, kind, place, starts_at, open_until, hide_at, state open\|archived\|cancelled, can_write, my_answer, mine, members (✅+🤔), invited, last_id, unread (others' msgs after p_seen, max 99)}]}` — not hidden yet, newest start first, max 20 | – |
| `evchat_push_mates(p_gid, p_uid)` | **service_role only** (notify-group) | table `(user_id, name)`: ✅/🤔 participants except the sender, name = the sender's name; empty unless the sender may write | – |

### notify-group v23
`mateNames(admin, uid, onlyGroup)`: when the caller has no `group_members` row in `onlyGroup`, it asks `evchat_push_mates`. So `{event:"msg", group_id}` and `{event:"voice", voice_id}` work unchanged for event chats (same texts, same limits, url `/?chat=<group_id>`, tag `olnu-msg-<group_id>`). Invited-only readers get no chat pushes (they got the invite push).

### Frontend (no new map buttons)
- **Invite sheet** (invite.js `drawInvite` → `EVCHAT.inviteBox`): a big "💬 Chatt" button under the answer segment with the unread count (red badge) and "Snacka mä truppen" / "Läs mä – svara för att skriva" / the archived/cancelled state.
- **Grupper tab**: a small "📨 Kvällens event" section above "Mina grupper" (`groupsSheet` hook; EVCHAT is right before INVITE in `mods()`, so it lands in the Grupper pane): open chats by start (title, "ikväll 20:00 · ⏳ om 2 tim · ✅ 3", unread badge), then max 3 archived/cancelled rows (dim). Hidden when empty.
- **The chat** is social.js `openChat({id, name, ev})`: everything of a group chat (text, 📷, 🎙️, reactions, older pages). With `g.ev`: a header (time, countdown/state, "📨 Inbjudan", ✅/📨 counts), no ranks/medals/quote menu, and when the viewer cannot write the input row is replaced by a lock: invited = "👀 Du ä inbjuden …" + ✅ Kommer / 🤔 Kanske (calls `invite_answer`, pushes `invite_yes`, reopens writable); archived = "🗄️ Arkiverad …" + "Försvinner ur listan om N dagar."; cancelled = "🚫 Eventet ä inställt …". System lines are centred rows (`.evc-sys`). Seen ids: localStorage `olnu.evSeen` (per viewer convenience; unread is computed on the server from it).
- **Push tap** `?chat=<group_id>`: `openChatLink` looks in `my_groups` first, then `EVCHAT.openById`.
- Polling: `my_event_chats` on sign-in, with the app poll (≥ 25 s apart), every 30 s while the section or an invite sheet is visible, and after every answer.
