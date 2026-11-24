// PintsNow — notify-group Edge Function.
// The client calls it (fire-and-forget) after an accepted beer. Old clients call it only after a
// milestone beer (1, 5 or 10); new clients call it after EVERY accepted beer. One call does two jobs:
//  A) FRIENDS: when the caller's beer hit a milestone, push to everyone who shares a group with
//     the caller, once per level per night (atomic notified_level claim).
//  B) KAOS I STAN: when the area around the caller's beer is wild (>= 10 live beers or >= 3 on
//     HOT STREAK within 5 km), push to subscribers whose saved area is within 10 km, at most once
//     per subscriber per night (push_sent). Anonymous counts only: no names, no exact places.
//  C) LEVEL-UP (v7; v26 by meriter): when the caller's meriter reach a new title, push to group-mates once
//     per title ever.
// v17: "beers" above = all drinks (beer_count + other_count); week_beers counts other drinks too.
//     Clients also call it (no body) after an accepted other drink. SOS accepts world positions.
// Body events (v7 SOCIAL): {event:"comehere"|"sos"|"msg", ...}, plus "home"/"pause" from v6.
// Body events (v9 INKALLELSE): {event:"rally"|"rally_yes", rally_id}.
// Body events (v10 CHECKA IN): {event:"checkin", bar?} -> "📍 {namn} har anlänt till {bar}".
// Body events (v12 KROGARNA): {event:"tip", tip_id} -> krogtips, {event:"takeover", bar_id} -> "🏰 Ni har tagit över {bar}!".
// Body events (v16 EFTERÅT): {event:"medevac_check", check_id} -> "🚑 Lisa kollar på Oskar", {event:"voice", voice_id} -> röstskål.
// Body events (v18 ETA): {event:"eta", eta_id} -> "🪖 Anton ä på marsch mot Pitchers. ETA 7 min." to mates already there.
// Body events (v22 GRUPPCHEF): {event:"status_req", req_id} -> "📸 Lägesrapport! {namn} vill se läget – 10 min" to the group.
// Body events (v27 SKÅLTIMMEN): {event:"skal_hour", hour_id} -> "🍻 SKÅLTIMMEN! 3 min – visa din dricka!" to the group;
//   {event:"film", group_id, night} -> "Filmen är framkallad! 📸" to the group (engångskameran, 10:00).
// 0195 📸 FILMSTART: {event:"film_start", group_id} -> "📸 Lisa har börjat fota med engångskameran – hoppa in!" to the
//   group, once per group per night (film_starts claim). Push kind "film" (also the 10:00 roll), noisy.
// Body events (NÄRA, 0045/0047): {event:"friend", friend_id} -> "🤝 {namn} vill bli din vän", {event:"find", req_id} ->
//   "🧭 {namn} letar efter dig i vimlet!" (one recipient each; atomic notified claims).
// Body events (v28 INBJUDNINGAR, 0080/0081): {event:"invite"|"invite_yes"|"invite_due", invite_id}; cron {event:"invite_due"}
//   with header x-olnu-cron: <service key> (see cronDue).
// v29 EVENTCHATT (0084/0085): "msg" and "voice" also work in an invite's temp group (no group_members rows): mateNames
//   falls back to the service-role RPC evchat_push_mates (✅/🤔 participants; empty unless the sender may write).
// v24 📅 GÅR (0127/0128): {event:"ev_due"} -> "⏰ Om 1 timme: Pubquiz" to the caller when an event they marked Går starts
//   in 50–70 min (ev_going_due_claim, atomic reminded_at claim); the cron (x-olnu-cron) sends every due one after the invites.
// v25 💬 MEDDELANDEN (0136–0138): "msg" / "dm" / "voice" in a 1:1 DM group (no group_members rows) -> ONE push to the other
//   person, "💬 Anton: text…" / "🎙️ Anton skickade ett röstmeddelande" (dm_push_target: empty when blocked, not friends any
//   more or muted by the receiver); 1 push per sender per thread per 20 s (push_sent kind dm:<gid>); url /?chat=<gid>.
// v26 🏠 FÖLJ MIG HEM (0141): {event:"walk", walk_id} -> "🏠 Anton går hem – följ med på kartan" to the chosen viewers
//   (walks.notified atomic claim, < 5 min old, live); {event:"walk_home", walk_id} -> "✅ Anton ä hemma! 🏠" to the same
//   viewers (home_notified claim, ended 'home' < 10 min ago). Same tag olnu-walk-<id>, so "hemma" replaces "går hem". url /?walk=<id>.
//   find: + "👀 {namn} letar efter dig" (🔍 hitta.js "Var ä du?").
// v27 🔔 NOTISKOLL (0190): sendAll first drops pushes the recipient turned off (push_prefs.off by kind, see pushCat),
//   pushes in the recipient's nattro (quiet hours, Europe/Stockholm) and noisy pushes (ute/kaos/bar/kul) over the cap per
//   night (push_rx_take, default 15). SOS, medevac-koll, Följ mig hem and "letar efter dig" always pass. Response may get
//   `held: n`. New: {event:"coming", beer_id} -> "🏃 Anton kommer!" to the pin owner (button "🍺 Kommer!" on friend-is-out).
//   Chat/DM/voice payloads get `renotify`, `stack` (the service worker folds them) and a "💬 Svara" button; check-in opens
//   the bar (bars_lite) and folds per bar; msg rate 120 -> 30 s.
// DEPLOY v28 🔕 LUGNA NOTISER (0260; owner 2026-11-07 burst). gate28 in sendAll: every payload gets a short title (who/what
//   first, max 30, emoji last) and no generic body; hype (KAOS, takeover, tips, befordran, helg, filmstart, 1st/5th drink)
//   only 17–05; the social kinds (ute/kaos/bar/kul/film) max 1 per 10 min and 4 per night (gw; was 8) PER RECIPIENT (push_pace_take);
//   held ones go out as ONE digest "3 nya från vänner 🍻" (push_pace_due, flushed in later calls and the cron).
//   Friend pushes: one tag per pin (öl 5 replaces öl 1). New texts: friendPayload28, checkinPayload28 (count at the bar), …
// gw (agent gw 2026-11-08, migrations 0310-0313; KONKURRENTER.md): v28 budget 8 -> 4 per night (PACE_NIGHT_MAX).
//   Kind "ikvall" (tag olnu-ikvall-<night>): "Ute ikväll?" Fri/Sat ~20:00 to opted-in users (cron: ikvall_prompt_claim);
//   own evening rule: only Fri/Sat 19-23 Stockholm (else dropped), nattro respected, counted in the pace / budget.
//   {event:"knuff", knuff_id} -> "Anton knuffar dig 👋" to that friend (knuff_push_claim; kind "ute": paced, can be off).
//   {event:"walk_check", walk_id} (walker or viewer) + cron walk_timer_due_claim: "Är du hemma? 🏠" to the walker,
//   then "Lisa har inte svarat ⚠️" with the last position time to the chosen viewers (tags olnu-walk-*: safety, always on).
// ntf v2 🔔 NOTISER v2 (agent ntf 2026-11-08, migration 0390): behind push_v2_flags (OFF until the release step).
//   Priorities (last slot of the night for prio >= 60), variants per recipient (no recent repeats), k/v/prio/ts on every
//   payload (service worker logs push.shown/open/action), fold (one updating notice per night for friends out),
//   face (sender's avatar as the icon), image (film), in-app feed (ntf_feed) for what was not sent, auto-mute,
//   store-safe copy (no 5th-drink push, care push without the number). Cron: Ikväll? with social proof (Fri/Sat),
//   gang streak (Sun), win-back (once). See the ntf v2 pure + runtime blocks.
// Keep this in ONE file (the deploy tool uploads files directly; no import map).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

// ---- pure:start (no Deno / network below this line until pure:end; tested by supabase/tests) ----

export type Pt = { lat: number; lng: number };
export type LiveBeer = Pt & { beer_count: number; other_count?: number | null };

/** v17: all drinks count (beers + other drinks) for levels, chaos and level-ups. */
export function drinksOf(b: { beer_count?: number | null; other_count?: number | null } | null | undefined): number {
  if (!b) return 0;
  const n = (Number(b.beer_count) || 0) + (Number(b.other_count) || 0);
  return n > 0 ? n : 0;
}

export const CHAOS_RADIUS_KM = 5;
export const PUSH_RADIUS_KM = 10;
export const CHAOS_MIN_OUT = 10;
export const CHAOS_MIN_HOT = 3;
export const TOWN_MAX_KM = 30;

export function haversineKm(a: Pt, b: Pt): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Lat/lng box that contains a circle of radiusKm around p (for cheap DB pre-filtering). */
export function boxAround(p: Pt, radiusKm: number) {
  const dLat = radiusKm / 111.0; // slightly under the real 111.19 km/deg so the box always covers the circle
  const dLng = radiusKm / (111.0 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
  return { minLat: p.lat - dLat, maxLat: p.lat + dLat, minLng: p.lng - dLng, maxLng: p.lng + dLng };
}

/** Chaos rule. `beers` must already be live (not expired, not stopped). */
export function chaosCheck(center: Pt, beers: LiveBeer[]) {
  let out = 0;
  let hot = 0;
  for (const b of beers) {
    const n = drinksOf(b);
    if (!(n >= 1)) continue;
    if (haversineKm(center, b) > CHAOS_RADIUS_KM) continue;
    out++;
    if (n >= 5) hot++;
  }
  return { out, hot, chaos: out >= CHAOS_MIN_OUT || hot >= CHAOS_MIN_HOT };
}

export function milestoneLevel(count: number): 0 | 1 | 5 | 10 {
  if (!(count >= 1)) return 0;
  return count >= 10 ? 10 : count >= 5 ? 5 : 1;
}

// [name, lat, lng]
export const TOWNS: [string, number, number][] = [
  ["Ludvika", 60.1496, 15.1878], ["Grängesberg", 60.0786, 14.9945], ["Smedjebacken", 60.1408, 15.4129],
  ["Borlänge", 60.4858, 15.4371], ["Falun", 60.6065, 15.6355], ["Säter", 60.3464, 15.7514],
  ["Hedemora", 60.2795, 15.9886], ["Avesta", 60.1455, 16.1679], ["Leksand", 60.7300, 14.9997],
  ["Rättvik", 60.8865, 15.1189], ["Mora", 61.0070, 14.5430], ["Fagersta", 60.0042, 15.7932],
  ["Stockholm", 59.3293, 18.0686], ["Göteborg", 57.7089, 11.9746], ["Malmö", 55.6050, 13.0038],
  ["Uppsala", 59.8586, 17.6389], ["Västerås", 59.6099, 16.5448], ["Örebro", 59.2753, 15.2134],
  ["Linköping", 58.4108, 15.6214], ["Helsingborg", 56.0465, 12.6945], ["Jönköping", 57.7826, 14.1618],
  ["Norrköping", 58.5877, 16.1924], ["Lund", 55.7047, 13.1910], ["Umeå", 63.8258, 20.2630],
  ["Gävle", 60.6749, 17.1413], ["Sandviken", 60.6216, 16.7756], ["Borås", 57.7210, 12.9401],
  ["Södertälje", 59.1955, 17.6253], ["Eskilstuna", 59.3666, 16.5077], ["Halmstad", 56.6745, 12.8578],
  ["Växjö", 56.8777, 14.8091], ["Karlstad", 59.3793, 13.5036], ["Sundsvall", 62.3908, 17.3069],
  ["Luleå", 65.5848, 22.1547], ["Trollhättan", 58.2837, 12.2886], ["Östersund", 63.1792, 14.6357],
  ["Kalmar", 56.6634, 16.3568], ["Kristianstad", 56.0294, 14.1567], ["Skövde", 58.3903, 13.8461],
  ["Karlskrona", 56.1612, 15.5869], ["Skellefteå", 64.7507, 20.9528], ["Uddevalla", 58.3498, 11.9356],
  ["Nyköping", 58.7530, 17.0079], ["Visby", 57.6348, 18.2948], ["Kiruna", 67.8558, 20.2253],
  ["Örnsköldsvik", 63.2909, 18.7153], ["Härnösand", 62.6323, 17.9379], ["Piteå", 65.3172, 21.4794],
  ["Varberg", 57.1056, 12.2508], ["Kungsbacka", 57.4872, 12.0761], ["Motala", 58.5371, 15.0365],
  ["Köping", 59.5140, 15.9926], ["Hudiksvall", 61.7290, 17.1036],
];

/** Nearest town name, or "stan" when no listed town is within TOWN_MAX_KM. */
export function nearestTown(p: Pt): string {
  let best = "stan";
  let bestKm = TOWN_MAX_KM;
  for (const [name, lat, lng] of TOWNS) {
    const km = haversineKm(p, { lat, lng });
    if (km <= bestKm) {
      bestKm = km;
      best = name;
    }
  }
  return best;
}

export const FRIEND_LINES: Record<1 | 5 | 10, string[]> = {   // B2 rows 1-3: one fixed line each
  1: ["{namn} är ute"],
  5: ["{namn} är igång"],
  10: ["Hör av dig till {namn}"],
};

export const FRIEND_BODY: Record<1 | 5 | 10, string> = {
  1: "Hänger du på?",
  5: "Fem öl ikväll.",
  10: "Tio öl ikväll. Fråga hur det är.",
};

export const KAOS_LINES: string[] = [
  "{n} ute i {stad}",
];

/** tx04: town lines for the KAOS push, mixed into the pool for that town only ({stad} {n}). */
/** B2: no town variants any more (one fixed KAOS text). Kept as an empty map for kaosPool. */
export const KAOS_TOWN: Record<string, string[]> = {};
export function kaosPool(stad: string): string[] {
  const t = KAOS_TOWN[stad];
  return t ? KAOS_LINES.concat(t) : KAOS_LINES;
}

export const HOME_LINES: string[] = [
  "{namn} är hemma",
];

export const PAUSE_LINES: string[] = [
  "{namn} tar en paus",
];

export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ---- v7 SOCIAL ----

/** Rank ladder by MERITER (v26, 42 steps). Same list in migration 0036 (olnu_titles),
 *  docs/js/social.js TITLES and CONTRACT.md. */
export const TITLES: [number, string][] = [
  [0, "Rekryt Lättöl"], [4, "Värnpliktig Veteöl"], [8, "Menig Mellanöl"], [13, "Vicekorpral Kapsyl"],
  [19, "Korpral Kranöl"], [26, "Skumsergeant"], [34, "Översergeant Sejdel"], [43, "Stabssergeant Sixpack"],
  [53, "Fanjunkare Flaskhals"], [65, "Förvaltare Folköl"], [79, "Fänrik Fatöl"], [95, "Löjtnant Lager"],
  [115, "Premiärlöjtnant Pilsner"], [135, "Kapten Kagge"], [155, "Stabskapten Stout"], [180, "Major Mikrobryggeri"],
  [210, "Överstelöjtnant Ölback"], [245, "Överste Stor Stark"], [280, "Brigadgeneral Burköl"], [320, "Generalmajor Mörköl"],
  [365, "Generallöjtnant IPA"], [410, "General Guldbärs"], [465, "Överbefälhavare Öl"], [520, "Fältmarskalk Humle"],
  [585, "Riksmarskalk Malt"], [655, "Generalissimus Ale"], [725, "Ärkegeneral Ölhall"], [805, "Supergeneral Pint"],
  [895, "Krigsherre Porter"], [985, "Kommendant Julöl"], [1085, "Imperator Påsköl"], [1190, "Stormarskalk Ölstop"],
  [1300, "Kejsargeneral Ölmage"], [1420, "Fältherre Öltält"], [1545, "General Oktoberfest"], [1680, "Supermarskalk Pubrunda"],
  [1820, "Överkommendant Ölglas"], [1970, "Ärkemarskalk Ölbricka"], [2130, "Krigsgud Hembrygd"], [2295, "Ölgudens Överste"],
  [2470, "Ölgudens Livgarde"], [2650, "Ölguden"],
];

/** v26: a rank counts as "reached just now" when the meriter of the last LEVELUP_WINDOW_H hours crossed
 *  its start (total - recent < at <= total). Older ranks (and the backfill, dated >= 4 h back) never push. */
export const LEVELUP_WINDOW_H = 3;
export function reachedNow(total: number, recent: number, at: number): boolean {
  return at > 0 && total >= at && total - Math.max(0, recent) < at;
}

export function titleFor(total: number) {
  const t = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  let i = 0;
  while (i + 1 < TITLES.length && TITLES[i + 1][0] <= t) i++;
  const next = TITLES[i + 1];
  return {
    title: TITLES[i][1],
    at: TITLES[i][0],
    next_title: next ? next[1] : null,
    next_at: next ? next[0] : null,
  };
}

/** Friend line with name and title. Without a title, "{titel} " is removed. */
export function fillFriend(tpl: string, namn: string, titel: string): string {
  return fill(titel ? tpl : tpl.replace(/\{titel\}\s*/g, ""), { namn, titel });
}

export const LEVELUP_LINES: string[] = [
  "{namn} blev {titel}",
];

export function levelUpPayload(idx: number, namn: string, titel: string, beerId: number) {
  return {
    title: fill(LEVELUP_LINES[((idx % LEVELUP_LINES.length) + LEVELUP_LINES.length) % LEVELUP_LINES.length], { namn, titel }),
    body: "Ny rang. Grattis!",
    url: `/?focus=${beerId}`,
    tag: `olnu-title-${beerId}`,
  };
}

export const COMEHERE_LINES: string[] = [
  "{namn} vill ses",
];

export const COMEHERE_NOBAR_LINES: string[] = [
  "{namn} vill ses",
];

/** Bar names come from the client: one line, no control chars, max 60 chars. */
export function cleanBarName(x: unknown): string {
  if (typeof x !== "string") return "";
  // deno-lint-ignore no-control-regex
  return x.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
}

export function comeherePayload(idx: number, namn: string, bar: string, beerId: number) {
  const lines = bar ? COMEHERE_LINES : COMEHERE_NOBAR_LINES;
  return {
    title: fill(lines[((idx % lines.length) + lines.length) % lines.length], { namn, bar }),
    body: bar ? `Kom till ${bar}.` : "Kom hit.",
    url: `/?focus=${beerId}`,
    tag: `olnu-come-${beerId}`,
  };
}

/** Finite numbers anywhere in the world (v17: |lat| <= 85, lng -180..180; same as post_beer_v2). */
export function validPt(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -85.0 && lat <= 85.0 && lng >= -180.0 && lng <= 180.0;
}

/** SOS: the only push with an exact location, only to group-mates. */
export function sosPayload(namn: string, lat: number, lng: number, stamp: number) {
  return {
    title: `🆘 ${namn} behöver hjälp!`,
    body: "Tryck för att se var.",
    url: `/?sos=${lat.toFixed(5)},${lng.toFixed(5)}`,
    tag: `olnu-sos-${stamp}`,
    sos: true,
    requireInteraction: true,
  };
}

export function msgPayload(namn: string, body: string, groupName: string, groupId: string) {
  // v27: one line (max 90), a "💬 Svara" button, and `stack` so the service worker folds many messages into one notice.
  const line = `${namn}: ${shortText(body, 90)}`;
  const g = cleanBarName(groupName);
  return {
    title: `💬 ${line}`,
    body: g ? `i ${g}` : "Nytt i gruppchatten",
    url: `/?chat=${groupId}`,
    tag: `olnu-msg-${groupId}`,
    renotify: true,
    stack: { title: `💬 {n} nya i ${g || "gruppchatten"}`, line },
    actions: [{ action: "reply", title: "💬 Svara", url: `/?chat=${groupId}&reply=1` }],
  };
}

export function isUuid(x: unknown): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

/** Start of the fixed time bucket (ms) that contains nowMs. */
export function bucketStart(nowMs: number, windowSec: number): number {
  const w = windowSec * 1000;
  return Math.floor(nowMs / w) * w;
}

/** Event rate limits in seconds (push_sent kind -> window). */
// v27: msg 120 -> 30 s (the service worker folds a chat into one notice, so a short limit no longer spams).
export const RATE_SEC = { comehere: 600, sos: 180, msg: 30, checkin: 600, eta: 600 } as const;

// ---- v10 CHECKA IN ----
export const CHECKIN_LINES: string[] = [
  "{namn} är på {bar}",
];

export const CHECKIN_BODY: string[] = [
  "Incheckad nyss.",
];

export function checkinPayload(idx: number, namn: string, bar: string, stamp: number, barId = "") {
  const b = bar || "baren";
  // v27: a known bar (bars_lite) -> open that bar; tag per bar so friends at the same bar fold into one notice.
  const bid = String(barId || "").slice(0, 80);
  return {
    title: fill(CHECKIN_LINES[((Math.floor(idx) % CHECKIN_LINES.length) + CHECKIN_LINES.length) % CHECKIN_LINES.length], { namn, bar: b }),
    body: CHECKIN_BODY[((Math.floor(idx) % CHECKIN_BODY.length) + CHECKIN_BODY.length) % CHECKIN_BODY.length],
    url: bid ? `/?bar=${encodeURIComponent(bid)}` : "/",
    tag: bid ? `olnu-checkin-${bid}`.slice(0, 120) : `olnu-checkin-${stamp}`,
  };
}

/** Random index in [0, n), never equal to `avoid` when n > 1. */
export function pickIndex(n: number, avoid: number | undefined, rand: () => number = Math.random): number {
  if (n <= 1) return 0;
  if (avoid === undefined || avoid < 0 || avoid >= n) return Math.floor(rand() * n) % n;
  const i = Math.floor(rand() * (n - 1)) % (n - 1);
  return i >= avoid ? i + 1 : i;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Chaos line for a user on a night: a per-user offset plus the night number, so the same
 *  user never gets the same line two nights in a row, and different users get different lines. */
export function kaosLineIndex(n: number, nightIso: string, userId: string): number {
  const day = Math.floor(Date.parse(nightIso) / 86_400_000);
  return (((day + hashStr(userId)) % n) + n) % n;
}

/** Evening date of a night ("2026-10-17" for the night that ends 2026-10-18 05:00 Stockholm). */
export function nightLabel(nightIso: string): string {
  const d = new Date(Date.parse(nightIso) - 12 * 3600 * 1000);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function kaosPayload(idx: number, stad: string, out: number, hot: number, nightIso: string) {
  const title = fill(KAOS_LINES[idx % KAOS_LINES.length], { stad, n: out, hot });
  const body = "Det är liv i stan ikväll.";
  return { title, body, url: "/", tag: `olnu-kaos-${nightLabel(nightIso)}` };
}

// ---- v9 INKALLELSE (rally) ----

/** Call-out lines to group-mates. {namn} = creator, {body} = rally text. */
export const RALLY_LINES: string[] = [
  "{namn}: {body}",
];

/** "Someone is coming" lines to the creator. {yes} = number on the way. */
export const RALLY_YES_LINES: string[] = [
  "{yes} kommer",
];

/** Rally id from the request body: a positive safe integer (number or digit string), else null. */
export function parseRallyId(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && /^\d{1,15}$/.test(x) ? Number(x) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function wrapIdx(idx: number, n: number): number {
  return ((Math.floor(idx) % n) + n) % n;
}

/** Push to group-mates. The service worker opens /?rally=<id>&answer=yes|no for the actions. */
export function rallyPayload(idx: number, namn: string, body: string, place: string | null | undefined, rallyId: number) {
  return {
    title: fill(RALLY_LINES[wrapIdx(idx, RALLY_LINES.length)], { namn, body }),
    body: place ? `${place}. Svara i appen.` : "Svara i appen.",
    url: `/?rally=${rallyId}`,
    tag: `olnu-rally-${rallyId}`,
    rally_id: rallyId,
    actions: [
      { action: "yes", title: "✅ Jag kommer" },
      { action: "no", title: "❌ Kan inte" },
    ],
  };
}

/** Push to the rally creator when a member answers yes (same tag, so they stack into one). */
export function rallyYesPayload(idx: number, namn: string, yes: number, rallyId: number) {
  return {
    title: fill(RALLY_YES_LINES[wrapIdx(idx, RALLY_YES_LINES.length)], { namn, yes }),
    body: "Se vilka som kommer.",
    url: `/?rally=${rallyId}`,
    tag: `olnu-rally-${rallyId}-yes`,
    rally_id: rallyId,
  };
}


// ---- v12 KROGARNA: bar tips + takeovers ----
export const TIP_LINES: string[] = [
  "{namn} tipsar om {bar}",
];
export function tipPayload(idx: number, namn: string, bar: string, body: string | null | undefined, barId: string, tipId: number) {
  const b = cleanBarName(bar) || "baren";
  // deno-lint-ignore no-control-regex
  const extra = typeof body === "string" ? body.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40) : "";
  return {
    title: fill(TIP_LINES[wrapIdx(idx, TIP_LINES.length)], { namn, bar: b }),
    body: extra ? `”${extra}”` : "Tryck för att se baren.",
    url: `/?bar=${encodeURIComponent(barId)}`,
    tag: `olnu-tip-${tipId}`,
  };
}
export const TAKEOVER_LINES: string[] = [
  "{grupp} har {bar}",
];
export function takeoverPayload(idx: number, grupp: string, bar: string, barId: string, groupId: string) {
  const b = cleanBarName(bar) || "krogen";
  const g = cleanBarName(grupp) || "Ni";
  return {
    title: fill(TAKEOVER_LINES[wrapIdx(idx, TAKEOVER_LINES.length)], { grupp: g, bar: b }),
    body: "Ni är flest här just nu.",
    url: `/?bar=${encodeURIComponent(barId)}`,
    tag: `olnu-takeover-${groupId}-${barId}`.slice(0, 120),
  };
}


// ---- v16 EFTERÅT ----
// Kom hem säkert: extra home lines (content B23). {namn}, {tid} = HH:MM.
export const SAFE_HOME_LINES: string[] = [
  "{namn} är hemma",
];

// Röstskål in the group chat. {namn}
export const VOICE_LINES: string[] = [
  "{namn} skålar",
];

/** HH:MM in Europe/Stockholm. */
export function hhmm(ms: number): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(new Date(ms));
  } catch (_e) {
    const d = new Date(ms);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
}

/** Home push title: old HOME_LINES + SAFE_HOME_LINES. idx over the joined list. */
export function homeTitle(idx: number, namn: string, ms: number): string {
  const all = HOME_LINES.concat(SAFE_HOME_LINES);
  return fill(all[wrapIdx(idx, all.length)], { namn, tid: hhmm(ms) });
}
export function homeLineCount(): number { return HOME_LINES.length + SAFE_HOME_LINES.length; }

// "🚑 Jag kollar": a friend takes care of a mate on MEDEVAC (10 beers). Caring, never shaming.
export const MEDCHECK_LINES: string[] = [
  "{namn} frågar hur {mal} mår",
];
export const MEDCHECK_ME_LINES: string[] = [
  "{namn} frågar hur det är",
];
export function medcheckPayload(idx: number, namn: string, mal: string | null, beerId: number | null, checkId: number) {
  const me = mal === null;
  const lines = me ? MEDCHECK_ME_LINES : MEDCHECK_LINES;
  return {
    title: fill(lines[wrapIdx(idx, lines.length)], { namn: cleanBarName(namn) || "En vän", mal: cleanBarName(mal ?? "") || "kompisen" }),
    body: me ? "Drick vatten. Ta taxi hem." : "Tack för att ni tar hand om varandra.",
    url: beerId ? `/?focus=${beerId}` : "/",
    tag: `olnu-medcheck-${checkId}`,
  };
}

export function voicePayload(idx: number, namn: string, groupName: string, groupId: string) {
  return {
    title: fill(VOICE_LINES[wrapIdx(idx, VOICE_LINES.length)], { namn: cleanBarName(namn) || "En vän" }),
    body: "Tryck för att lyssna.",
    url: `/?chat=${groupId}`,
    tag: `olnu-voice-${groupId}`,
    renotify: true,
    stack: { title: `🎙️ {n} röstskål i ${cleanBarName(groupName) || "gruppen"}`, line: `🎙️ ${cleanBarName(namn) || "En vän"}` },
  };
}

// ---- v18 ETA ("🏃 Jag ä på väg") ----
// Titles by distance in time: short (≤ 5 min), mid (10–15), long (20–30). {namn}, {min}, {bar}.
export const ETA_LINES: Record<"short" | "mid" | "long", string[]> = {   // B2 row 19: one fixed line
  short: ["{namn} är nära {bar}"],
  mid: ["{namn} är på väg till {bar}"],
  long: ["{namn} är på väg till {bar}"],
};

export const ETA_BODIES: string[] = [
  "Ca {min} min.",
];

export type EtaKind = "short" | "mid" | "long";
export function etaKind(min: number): EtaKind {
  return min <= 5 ? "short" : min <= 15 ? "mid" : "long";
}
/** Minutes left (at least 1) from eta_at to now. */
export function etaMinsLeft(etaAtIso: string, nowMs: number): number {
  const ms = Date.parse(etaAtIso) - nowMs;
  return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / 60000)) : 1;
}
export function etaLineCount(kind: EtaKind): number { return ETA_LINES[kind].length; }

export function etaPayload(
  idx: number, bodyIdx: number, namn: string, min: number, bar: string | null | undefined,
  barId: string | null | undefined, rallyId: number | null | undefined, etaId: number,
) {
  const k = etaKind(min);
  const lines = ETA_LINES[k];
  const b = cleanBarName(bar ?? "") || "samlingsplatsen";
  const n = cleanBarName(namn) || "En vän";
  const vars = { namn: n, min: Math.max(1, Math.round(min)), bar: b };
  return {
    title: fill(lines[wrapIdx(idx, lines.length)], vars),
    body: fill(ETA_BODIES[wrapIdx(bodyIdx, ETA_BODIES.length)], vars),
    url: rallyId ? `/?rally=${rallyId}` : barId ? `/?bar=${encodeURIComponent(barId)}` : "/",
    tag: `olnu-eta-${etaId}`,
    ...(rallyId ? { rally_id: rallyId } : {}),
  };
}

export type EtaTarget = { bar_id?: string | null; lat?: number | null; lng?: number | null };
export type EtaCheckin = { user_id: string; bar_id?: string | null; lat?: number | null; lng?: number | null; created_at: string };
export type EtaPin = { user_id: string; lat: number; lng: number; precise?: boolean | null; stopped?: boolean | null; ghost?: boolean | null; snap_bar?: string | null };
export const ETA_NEAR_M = 100;
export const ETA_CHECKIN_MS = 3 * 3600 * 1000;

/** Who gets the ETA push: group-mates who are AT the target right now (check-in at that bar in the
 *  last 3 h — or within 100 m when the target has no bar — or a precise visible pin within 100 m /
 *  snapped to that bar), plus the rally creator. Never the caller, never non-mates. Sorted, unique. */
export function etaRecipients(o: {
  caller: string; mates: Iterable<string>; target: EtaTarget; checkins: EtaCheckin[]; pins: EtaPin[];
  rallyCreator?: string | null; nowMs: number;
}): string[] {
  const mates = new Set(o.mates);
  mates.delete(o.caller);
  const t = o.target;
  const hasPt = typeof t.lat === "number" && typeof t.lng === "number" && Number.isFinite(t.lat) && Number.isFinite(t.lng);
  const near = (lat: unknown, lng: unknown) =>
    hasPt && typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
    haversineKm({ lat: t.lat as number, lng: t.lng as number }, { lat, lng }) * 1000 <= ETA_NEAR_M;
  const out = new Set<string>();
  for (const c of o.checkins) {
    if (!mates.has(c.user_id)) continue;
    const at = Date.parse(c.created_at);
    if (!Number.isFinite(at) || at < o.nowMs - ETA_CHECKIN_MS) continue;
    if (t.bar_id ? c.bar_id === t.bar_id : near(c.lat, c.lng)) out.add(c.user_id);
  }
  for (const p of o.pins) {
    if (!mates.has(p.user_id) || !p.precise || p.stopped || p.ghost) continue;
    if ((t.bar_id && p.snap_bar === t.bar_id) || near(p.lat, p.lng)) out.add(p.user_id);
  }
  if (o.rallyCreator && mates.has(o.rallyCreator)) out.add(o.rallyCreator);
  return [...out].sort();
}

// ---- v22 GRUPPCHEF: lägesrapport ----
export const STATUS_LINES: string[] = [
  "{namn} vill se läget",
];
export function statusReqPayload(idx: number, namn: string, groupName: string, reqId: number) {
  return {
    title: fill(STATUS_LINES[wrapIdx(idx, STATUS_LINES.length)], { namn: cleanBarName(namn) || "Gruppchefen" }),
    body: "Ta ett foto. 10 min.",
    url: `/?status=${reqId}`,
    tag: `olnu-status-${reqId}`,
  };
}

// ---- v27 HELGSTREAK: Friday 17:00 reminder (gentle; a check-in is enough) ----
export const HELG_LINES = [
  "Din helgrad: {n} v",
];
export function helgRemindPayload(idx: number, streak: number, week: string) {
  const n = Math.max(1, Math.floor(streak) || 1);
  return {
    title: fill(HELG_LINES[wrapIdx(idx, HELG_LINES.length)], { n: String(n), veckor: n === 1 ? "vecka" : "veckor" }),
    body: "Vila är också bra. Ingen press.",
    url: "/?helg=1",
    tag: `olnu-helg-${week}`,
  };
}

// ---- v27 SKÅLTIMMEN + ENGÅNGSKAMERAN ----
export const SKAL_HOUR_TITLE = "Skål! 3 min";
export const SKAL_HOUR_BODIES: string[] = [
  "Visa din dricka.",
];
export function skalHourPayload(idx: number, namn: string, groupName: string, hourId: number) {
  return {
    title: SKAL_HOUR_TITLE,
    body: fill(SKAL_HOUR_BODIES[wrapIdx(idx, SKAL_HOUR_BODIES.length)],
      { namn: cleanBarName(namn) || "Slumpen", grupp: cleanBarName(groupName) || "gruppen" }),
    url: `/?skal=${hourId}`,
    tag: `olnu-skal-${hourId}`,
  };
}
export const FILM_TITLE = "Filmen är klar";
export const FILM_BODIES: string[] = [
  "{n} bilder från kvällen.",
];
export function filmPayload(idx: number, groupName: string, n: number, groupId: string) {
  return {
    title: FILM_TITLE,
    body: fill(FILM_BODIES[wrapIdx(idx, FILM_BODIES.length)], { n: Math.max(1, n | 0), grupp: cleanBarName(groupName) || "gruppen" }),
    url: `/?film=${groupId}`,
    tag: `olnu-film-${groupId}`,
  };
}
// 0195 📸 FILMSTART: the first film shot of the night in a group → the rest of the group. {namn} = the starter.
export const FILM_START_LINES: string[] = [
  "{namn} startade film",
];
export const FILM_START_BODIES: string[] = [
  "Ta bilder med gänget.",
];
export function filmStartPayload(idx: number, namn: string, groupName: string, groupId: string) {
  return {
    title: fill(FILM_START_LINES[wrapIdx(idx, FILM_START_LINES.length)], { namn: cleanBarName(namn) || "Någon" }),
    body: fill(FILM_START_BODIES[wrapIdx(idx, FILM_START_BODIES.length)], { grupp: cleanBarName(groupName) || "gruppen" }),
    url: `/?film=${groupId}&cam=1`,
    tag: `olnu-filmstart-${groupId}`,
  };
}

// ---- v27 🔔 NOTISKOLL (0190): kinds, nattro, cap per night, "Kommer!" ----
/** Push kinds the user can turn off (same list as olnu_push_cats()). "safe" = always on. "" = unknown (always sent). */
export const PUSH_CATS = ["ute", "chat", "dm", "plan", "kaos", "bar", "kul", "vanner", "film", "ikvall", "gang"] as const;   // ntf v2: + ikvall, gang
/** Kinds that count against the cap per night (social noise; chat, plans and safety never count). */
export const PUSH_NOISY = ["ute", "kaos", "bar", "kul", "film", "ikvall", "gang"];   // gw: + ikvall; ntf v2: + gang
export const PUSH_CAP_DEFAULT = 15;
/** The kind of a push, from its tag (every payload has one; tags never hold user ids). */
export function pushCat(tag: string): string {
  const t = String(tag || "");
  if (/^olnu-(sos|medcheck|walk|find|pickup)-/.test(t)) return "safe";   // feat 0250: 🆘 Hämta mig
  if (/^olnu-(msg|voice)-/.test(t)) return "chat";
  if (/^olnu-dm-/.test(t)) return "dm";
  if (/^olnu-(rally|inv|evgo|status|skal|ride|close)-/.test(t)) return "plan";   // feat 0250: 🚗 Skjuts?, ⏰ stänger
  if (/^olnu-kaos-/.test(t)) return "kaos";
  if (/^olnu-(tip|takeover)-/.test(t)) return "bar";
  if (/^olnu-(title|helg)-/.test(t)) return "kul";
  if (/^olnu-film(start)?-/.test(t)) return "film";   // 0195
  if (/^olnu-friend-/.test(t)) return "vanner";
  if (/^olnu-(gang|winback)-/.test(t)) return "gang";   // ntf v2 (0390): gang streak + win-back
  if (/^olnu-(after|mom|game)-/.test(t)) return "kul";   // lane-after-0450: morning report, moments, game start
  if (/^olnu-skal2-/.test(t)) return "ute";   // bold: Skåltimmen v2 (paced, in the 4/night budget)
  if (/^olnu-replay-/.test(t)) return "film";   // bold: Kvällsreprisen (Bilder)
  if (/^olnu-crown-/.test(t)) return "bar";   // bold: krog_crown (flag OFF, not sent in v1)
  if (/^olnu-ikvall-/.test(t)) return "ikvall";   // gw 0310: "Ute ikväll?" (opt-in; Fri/Sat 19-23 only, see rule28)
  if (/^olnu-(come|coming|checkin|eta|knuff)-/.test(t) || /^olnu-\d+-/.test(t)) return "ute";   // gw: + knuff
  return "";
}
/** Hour 0–23 in Europe/Stockholm. */
export function stockholmHour(ms: number): number {
  try {
    const h = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(new Date(ms));
    const n = parseInt(h, 10);
    if (n >= 0 && n <= 23) return n;
  } catch (_e) { /* fall through */ }
  return new Date(ms).getUTCHours();
}
/** Nattro from..to (whole hours, to excluded; may wrap midnight). Null/equal = off. */
export function inQuiet(hour: number, from: number | null | undefined, to: number | null | undefined): boolean {
  if (from == null || to == null || from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}
export type PushPref = { off?: string[] | null; quiet_from?: number | null; quiet_to?: number | null; cap?: number | null };
/** "send" | "off" (kind turned off) | "quiet" (nattro) | "cap" (noisy kind: ask the counter). */
export function pushGate(cat: string, pref: PushPref | null | undefined, hour: number): "send" | "off" | "quiet" | "cap" {
  if (!cat || cat === "safe") return "send";
  if (pref && Array.isArray(pref.off) && pref.off.includes(cat)) return "off";
  if (pref && inQuiet(hour, pref.quiet_from, pref.quiet_to)) return "quiet";
  if (PUSH_NOISY.includes(cat) && capOf(pref) < 99) return "cap";
  return "send";
}
export function capOf(pref: PushPref | null | undefined): number {
  const c = Number(pref?.cap) || 0;
  return c === 5 || c === 10 || c === 20 || c === 99 ? c : PUSH_CAP_DEFAULT;
}
/** Chat text for a title: one line, max 90 chars. */
export function shortText(s: string, max = 90): string {
  const b = String(s || "").replace(/\s+/g, " ").trim();
  return b.length > max ? b.slice(0, max - 1) + "…" : b;
}
export const COMING_LINES: string[] = [
  "{namn} kommer",
];
/** "Kommer!" from a friend-is-out push: to the pin owner only. */
export function comingPayload(idx: number, namn: string, n: number, beerId: number) {
  return {
    title: fill(COMING_LINES[wrapIdx(idx, COMING_LINES.length)], { namn: cleanBarName(namn) || "En vän" }),
    body: n > 1 ? `${n} på väg till dig nu.` : "Hen är på väg till dig.",
    url: `/?focus=${beerId}`,
    tag: `olnu-coming-${beerId}`,
    renotify: true,
  };
}

// ---- v28 🔕 LUGNA NOTISER (0260) — pure block start ----
// Owner 2026-11-07: ~8 pushes in 11 min on a Saturday at 11:27 (3 friends in a 15-member group checked in at lunch:
// 3 check-ins + a first-beer push + a takeover, each with its own per-SENDER limit, nothing per RECIPIENT).
// v28 adds, for every push that is not safety / chat / DM / a direct plan or friend request:
//  1. Evening rule: "hype" pushes (KAOS, takeover, krogtips, befordran, helgstreak, filmstart, friend 1st/5th drink)
//     only 17:00–05:00 Europe/Stockholm. In the daytime they are dropped (not saved for later).
//  2. Pace per RECIPIENT across all those kinds: max 1 per 10 min (PACE_GAP_SEC) and max PACE_NIGHT_MAX per night
//     (a user's own cap 5/10/20 from 0190 wins; 99 = gap 2 min, max 99). A push inside the gap is held; the next
//     allowed push (or the flush in any later call / the cron) sends ONE digest "3 nya från vänner" with the lines.
//  3. Short titles: key info first (who/what), max 30 chars, emoji at the end (tidyTitle), specific bodies with
//     names / bar / count / time (no "Öppna kartan och se var." repeats: GENERIC_BODIES are removed).
//  4. Tags: the newest replaces the older notice of the same thing (friend: one tag per pin, check-in: one per bar).
// Other agents adding a push kind: give the payload a `tag` "olnu-<kind>-…", add the kind to pushCat (v27) and,
// when it is hype / evening-only, to HYPE_RE below. Optional payload fields read here: `dg` (short digest line).
export const PACE_GAP_SEC = 600;
export const PACE_NIGHT_MAX = 4;   // gw (KONKURRENTER.md risk 4): was 8. A user's own cap 5/10/20/99 (0190) still wins.
export const EVENING_FROM = 17;   // hype pushes 17:00 … 05:00 (Stockholm)
export const EVENING_TO = 5;
export const TITLE_MAX = 30;
/** Kinds (pushCat) that are paced. chat/dm/plan/vanner/safe/"" are never paced (direct, already folded or safety). */
export const PACE_CATS = ["ute", "kaos", "bar", "kul", "film", "ikvall", "gang"];   // gw: + ikvall; ntf v2: + gang
/** Evening-only tags: KAOS, takeover, krogtips, befordran, helgstreak, filmstart, friend 1st/5th drink ("-1"/"-5"/"-f1"/"-f5"). */
export const HYPE_RE = /^olnu-(kaos|takeover|tip|title|helg|filmstart)-|^olnu-\d+-f?(1|5)$/;
export function isEvening(hour: number): boolean {
  return hour >= EVENING_FROM || hour < EVENING_TO;
}
export function isHype(tag: string): boolean {
  return HYPE_RE.test(String(tag || ""));
}
/** "day" (hype in the daytime: drop) | "pace" (ask the counter) | "send". cat = pushCat(tag). */
export function rule28(cat: string, tag: string, hour: number, ms = Date.now()): "day" | "pace" | "send" {
  if (!cat || !PACE_CATS.includes(cat)) return "send";
  if (cat === "ikvall" && !ikvallWindow(ms) && !ikvallWindowV2(ms)) return "day";   // gw 0310: only Fri/Sat 19-23 Stockholm; ntf v2: 17:30-
  if (isHype(tag) && !isEvening(hour)) return "day";
  return "pace";
}
// ---- gw (0310-0313): pure texts + the "Ute ikväll?" window ----
/** Fri or Sat, 19:00-22:59 Europe/Stockholm. */
export function ikvallWindow(ms: number): boolean {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Stockholm", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const wd = p.find((x) => x.type === "weekday")?.value ?? "";
    const h = parseInt(p.find((x) => x.type === "hour")?.value ?? "-1", 10);
    return (wd === "Fri" || wd === "Sat") && h >= 19 && h < 23;
  } catch (_e) { return false; }
}
/** ntf v2: the social-proof Ikväll? (Fri/Sat 17:30-20:59 Stockholm; the SQL claim has the same window). */
export function ikvallWindowV2(ms: number): boolean {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Stockholm", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const wd = p.find((x) => x.type === "weekday")?.value ?? "";
    const m = parseInt(p.find((x) => x.type === "hour")?.value ?? "-1", 10) * 60 + parseInt(p.find((x) => x.type === "minute")?.value ?? "0", 10);
    return (wd === "Fri" || wd === "Sat") && m >= 17 * 60 + 30 && m < 21 * 60;
  } catch (_e) { return false; }
}
export const IKVALL_LINES: string[] = [
  "Ute ikväll?",
];
/** "Ute ikväll?" (no counts: you see the gang's answers after you answer). */
export function ikvallPayload(idx: number, ms: number) {
  const d = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  return { title: IKVALL_LINES[((Math.floor(idx) % IKVALL_LINES.length) + IKVALL_LINES.length) % IKVALL_LINES.length],
    body: "Svara Ute, Kanske eller Hemma.", url: "/?ikvall=1", tag: `olnu-ikvall-${d}`, dg: "Ute ikväll?" };
}
/** 👋 Knuff from a friend. */
export function knuffPayload(namn: string, id: number) {
  const n = cleanBarName(namn) || "En kompis";
  return { title: `${n} knuffade dig`, body: "Se var gänget är.", url: "/", tag: `olnu-knuff-${id}`, dg: `${n} knuffade dig` };
}
/** Följ mig hem timer: to the walker when the time is up. */
export function walkRemindPayload(walkId: number) {
  return { title: "Är du hemma?", body: "Svara inom 30 s, annars larmas vännerna.", url: `/?walk=${walkId}&chk=1`,
    tag: `olnu-walk-chk-${walkId}`, renotify: true };
}
/** Följ mig hem timer: to the viewers 30 s after an unanswered reminder. dueMs / lastMs: ms or NaN. */
export function walkAlertPayload(namn: string, walkId: number, dueMs: number, lastMs: number) {
  const n = cleanBarName(namn) || "Din kompis";
  const due = Number.isFinite(dueMs) ? ` kl ${hhmm(dueMs)}` : "";
  const last = Number.isFinite(lastMs) ? `Senaste plats kl ${hhmm(lastMs)}. ` : "";
  // B2 row 29 + safety: the call to action first, the due time and the last position time stay (useful when it is real)
  return { title: `${n} har inte svarat`, body: `Ring ${n}. Vid fara: 112. Skulle höra av sig${due}. ${last}`.trim(),
    url: `/?walk=${walkId}&alert=1`, tag: `olnu-walk-alert-${walkId}`, renotify: true };
}
export function paceOf(pref: PushPref | null | undefined): { gap: number; max: number } {
  const c = Number(pref?.cap) || 0;
  if (c === 99) return { gap: 120, max: 99 };
  if (c === 5 || c === 10 || c === 20) return { gap: PACE_GAP_SEC, max: c };
  return { gap: PACE_GAP_SEC, max: PACE_NIGHT_MAX };
}
// Emoji = pictographs, regional flags, keycaps, joiners and variation selectors.
const EMO_RE = /^(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️⃣#*0-9](?:[‍️⃣\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic})*)+/u;
const EMO_ANY = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;
/** Leading emoji cluster ("" when none) and the rest. Digits alone are not emoji. */
export function splitEmoji(s: string): { emoji: string; text: string } {
  const t = String(s || "").trim();
  const m = t.match(EMO_RE);
  if (!m || !EMO_ANY.test(m[0])) return { emoji: "", text: t };
  return { emoji: m[0].trim(), text: t.slice(m[0].length).trim() };
}
function cps(s: string): number { return [...s].length; }
function cutCp(s: string, n: number): string { return [...s].slice(0, n).join(""); }
/** Title: one line, key info first, max TITLE_MAX code points, ONE emoji at the END (a leading one is moved). */
export function tidyTitle(s: string, max = TITLE_MAX): string {
  let { emoji, text } = splitEmoji(String(s || "").replace(/\s+/g, " "));
  const tail = text.match(/\s([\p{Extended_Pictographic}][\p{Extended_Pictographic}‍️]*)$/u);
  if (tail) { if (!emoji) emoji = tail[1]; text = text.slice(0, tail.index).trim(); }
  emoji = [...emoji].filter((c) => /\p{Extended_Pictographic}/u.test(c) || /[‍️]/u.test(c)).join("");
  const first = emoji.match(/\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️)*/u);
  emoji = first ? first[0] : "";
  text = text.replace(/[!.]+$/, (m) => (m.includes("!") ? "!" : "")).trim();
  const room = Math.max(8, max - (emoji ? 2 : 0));
  if (cps(text) > room) {
    let c = cutCp(text, room - 1);
    const sp = c.lastIndexOf(" ");
    if (sp >= room * 0.55) c = c.slice(0, sp);
    text = c.replace(/[\s,:;–-]+$/, "") + "…";
  }
  return emoji ? `${text} ${emoji}` : text;
}
/** Bodies that say nothing (owner: "Ska du bara sitta hemma? Kolla kartan." ×3). Removed from any body. */
export const GENERIC_BODIES: string[] = [
  "Öppna kartan och se var.", "Tryck för att se var. Hänger du på?", "Öppna kartan. Det finns plats för en till.",
  "Tryck för att se baren på kartan.", "Ska du bara sitta hemma? Kolla kartan.", "Tryck för att se kartan. Håll krogen!",   // pushban-ok: a filter list (removed from bodies)
  "Tryck för att se kartan.", "Tryck för att se var.", "Tryck för att se baren.",
];
export function tidyBody(b: string): string {
  let s = String(b || "").replace(/Öl Nu/g, "PintsNow");
  for (const g of GENERIC_BODIES) s = s.split(g).join("");
  return s.replace(/\s*·\s*$/, "").replace(/^\s*·\s*/, "").replace(/\s+/g, " ").trim();
}
/** Final pass on every payload (all kinds, also kinds added later): short title, no generic body, cat + dg. */
export function tidyPayload(p: Record<string, unknown>): Record<string, unknown> {
  const tag = String(p.tag ?? "");
  const cat = pushCat(tag);
  const out: Record<string, unknown> = { ...p, cat: cat || "other" };
  const rawTitle = String(p.title ?? "").replace(/Öl Nu/g, "PintsNow");
  // Chat / DM titles are "Anton: text" lines (the text IS the info): only the emoji moves, length stays 60.
  out.title = cat === "chat" || cat === "dm" ? tidyTitle(rawTitle, 60) : cat === "safe" ? tidyTitle(rawTitle, 40) : tidyTitle(rawTitle);
  out.body = tidyBody(String(p.body ?? ""));
  if (!out.dg) out.dg = splitEmoji(String(out.title)).text.replace(/\s[\p{Extended_Pictographic}].*$/u, "");
  return out;
}
/** Digest of held lines ("HH:MM|text", oldest first) plus the current one. */
export function digestPayload(lines: string[], grp: string | null | undefined): Record<string, unknown> {
  const items = lines.map((l) => { const i = l.indexOf("|"); return i > 0 ? { t: l.slice(0, i), x: l.slice(i + 1) } : { t: "", x: l }; })
    .filter((o) => o.x);
  const g = cleanBarName(grp || "");
  if (items.length <= 1) {
    const o = items[0] || { t: "", x: "Nytt från vänner" };
    return { title: tidyTitle(o.x), body: [o.t ? `kl ${o.t}` : "", g || "från vänner"].filter(Boolean).join(" · "), url: "/", tag: "olnu-digest", renotify: true, cat: "digest" };
  }
  const news = items.slice().reverse();
  const shown = news.slice(0, 2).map((o) => o.x);   // B2 row 42: the first 2 lines
  const more = news.length - shown.length;
  return {
    title: tidyTitle(g ? `${items.length} nya i ${g}` : `${items.length} nya från vänner`),
    body: shown.join(" · ") + (more > 0 ? ` · +${more} till` : ""),
    url: "/",
    tag: "olnu-digest",
    renotify: true,
    cat: "digest",
  };
}
/** Line for the digest, with the Stockholm time. */
export function digestLine(p: Record<string, unknown>, ms: number): string {
  return `${hhmm(ms)}|${String(p.dg || splitEmoji(String(p.title ?? "")).text).slice(0, 70)}`;
}
// ---- v28 texts: short title (who/what first) + a specific body ----
function pick28(arr: string[], idx: number): string { return arr[((Math.floor(idx) % arr.length) + arr.length) % arr.length]; }
/** Friend milestone (1st, 5th, 10th drink). bar = the pin's bar when the pin is precise (snap_bar), tid = HH:MM. */
export function friendPayload28(level: 1 | 5 | 10, idx: number, namn: string, titel: string, beerId: number, bar: string, tid: string) {
  const n = cleanBarName(namn) || "En vän";
  const b = cleanBarName(bar);
  const vid = b ? ` på ${b}` : "";
  let title: string, bodies: string[];
  // B2 (PUSH-TEXTS rows 1-3, owner default 24 Nov): ONE fixed text per level, no hype, the count is information only.
  void titel; void vid;
  if (level === 1) {
    title = b ? `${n} på ${b}` : `${n} är ute`;
    bodies = [tid ? `Sedan ${tid}. Hänger du på?` : "Hänger du på?"];
  } else if (level === 5) {
    title = `${n} är igång`;
    bodies = [tid ? `Fem öl, senast kl ${tid}.` : "Fem öl ikväll."];
  } else {
    title = `Hör av dig till ${n}`;
    bodies = ["Tio öl ikväll. Fråga hur det är."];
  }
  return {
    title: tidyTitle(title),
    body: pick28(bodies, idx),
    url: `/?focus=${beerId}`,
    // v28: one tag per pin, so öl 5 replaces öl 1 of the same friend (pushCat: /^olnu-\d+-/ = ute; HYPE_RE: -f1 / -f5).
    tag: `olnu-${beerId}-f${level}`,
    dg: level === 10 ? `${n} på 10 öl` : b ? `${n} på ${b}` : `${n} är ute`,
    actions: level === 10 ? [] : [
      ...(level === 1 ? [{ action: "coming", title: "🍺 Kommer!", url: `/?focus=${beerId}&act=coming` }] : []),
      { action: "skal", title: "🍻 Skåla", url: `/?focus=${beerId}&act=skal` },
    ],
  };
}
/** Check-in. here = friends of the recipient's groups checked in at that bar now (incl. the sender). */
export function checkinPayload28(idx: number, namn: string, bar: string, stamp: number, barId: string, here: number, tid: string) {
  const n = cleanBarName(namn) || "En vän";
  const b = cleanBarName(bar) || "en krog";
  const bid = String(barId || "").slice(0, 80);
  // B2 row 4: one fixed text. The number of mates there stays as information.
  const bodies = [(tid ? `Incheckad ${tid}.` : "Incheckad nyss.") + (here >= 2 ? ` ${here} från gänget är där.` : "")];
  return {
    title: tidyTitle(`${n} är på ${b}`),
    body: pick28(bodies, idx),
    url: bid ? `/?bar=${encodeURIComponent(bid)}` : "/",
    tag: bid ? `olnu-checkin-${bid}`.slice(0, 120) : `olnu-checkin-${stamp}`,
    renotify: true,
    stack: { title: `{n} vänner på ${b} 📍`, line: `${n} kl ${tid}` },
    dg: `${n} på ${b}`,
  };
}
export function takeoverPayload28(idx: number, grupp: string, bar: string, barId: string, groupId: string, n: number) {
  const b = cleanBarName(bar) || "krogen";
  const g = cleanBarName(grupp) || "Ni";
  void n;   // B2 row 5: one fixed text
  const bodies = ["Ni är flest här just nu."];
  return {
    title: tidyTitle(`${g} har ${b}`),
    body: pick28(bodies, idx),
    url: `/?bar=${encodeURIComponent(barId)}`,
    tag: `olnu-takeover-${groupId}-${barId}`.slice(0, 120),
    grp: g === "Ni" ? "" : g,
    dg: `${g} har ${b}`,
  };
}
export function levelUpPayload28(idx: number, namn: string, titel: string, beerId: number, nextTitel: string | null) {
  const n = cleanBarName(namn) || "En vän";
  void nextTitel;   // B2 row 6: one fixed text
  const bodies = ["Ny rang. Grattis!"];
  return {
    title: tidyTitle(`${n} blev ${titel}`),
    body: pick28(bodies, idx),
    url: `/?focus=${beerId}`,
    tag: `olnu-title-${beerId}`,
    dg: `${n} blev ${titel}`,
  };
}
export function kaosPayload28(idx: number, stad: string, out: number, hot: number, nightIso: string) {
  void idx; void hot;   // B2 row 7: one fixed text, no "hot streak" count
  return {
    title: tidyTitle(`${out} ute i ${stad}`),
    body: "Det är liv i stan ikväll.",
    url: "/",
    tag: `olnu-kaos-${nightLabel(nightIso)}`,
    dg: `${out} ute i ${stad}`,
  };
}
export function comeherePayload28(namn: string, bar: string, beerId: number) {
  const n = cleanBarName(namn) || "En vän";
  const b = cleanBarName(bar);
  return {
    title: tidyTitle(`${n} vill ses`),   // B2 row 8
    body: b ? `Kom till ${b}.` : "Kom hit.",
    url: `/?focus=${beerId}`,
    tag: `olnu-come-${beerId}`,
    dg: b ? `${n} vill att du kommer till ${b}` : `${n} vill att du kommer`,
  };
}
export function msgPayload28(namn: string, body: string, groupName: string, groupId: string) {
  const n = cleanBarName(namn) || "Nån";
  const g = cleanBarName(groupName);
  const text = shortText(body, 60);   // B2 row 10: the message, cut at 60
  return {
    title: tidyTitle(g ? `${n} i ${g} 💬` : `${n} 💬`, 40),
    body: text,
    url: `/?chat=${groupId}`,
    tag: `olnu-msg-${groupId}`,
    renotify: true,
    stack: { title: `{n} nya i ${g || "gruppchatten"} 💬`, line: `${n}: ${shortText(body, 90)}` },
    actions: [{ action: "reply", title: "💬 Svara", url: `/?chat=${groupId}&reply=1` }],
  };
}
// ---- v28 🔕 LUGNA NOTISER — pure block end ----

// ---- ntf v2 🔔 NOTISER v2 (agent ntf 2026-11-08, migration 0390) — pure block start ----
// All of this is OFF until push_v2_flags.ntf_v2 = true (release step). With the flag off, v28 runs exactly as before.
//  1. Priorities: every kind has a priority (NTF_PRIO). The LAST slot of the night budget (4) is kept for prio >= 60
//     (friends out, Ikväll?, events, film, plans); "Färre notiser" = max 2 per night, only prio >= 60 (push_pace_take2).
//  2. Variants: builders give `alts` (several title/body variants with ids "ck.2"); applyVariant() picks one per
//     recipient that is NOT in the recipient's last 8 for that kind (push_stats.recent; Duolingo KDD20: recency matters).
//  3. Every payload gets k (kind), v (variant id), prio, ts (event time ms). The service worker logs push.shown /
//     push.open / push.action with k + v (PNLOG) and push_seen() counts opens per kind + hour (auto-mute, send time).
//  4. fold: friends-out and check-ins of ONE night share one updating notice ("3 vänner ute ikväll 🍻" + lines).
//  5. face: the sender's avatar key (olnu_chief_k = md5(group:uid:olnu-chief)[0:12]); the service worker shows the
//     avatar PNG the app cached for that key as the icon (else the app icon). No user id in any payload.
//  6. Store-safe copy: no drink counts, no "drink more", no 5th-drink hype (dropped), the 10th is a care push without
//     the number, skåltimmen asks for a photo of the gang (not of the drink), the personal helgstreak "at risk" push is off.
export const NTF_PRIO: Record<string, number> = {
  safe: 100, dm: 90, chat: 90, plan: 80, vanner: 75, ute: 70, ikvall: 70, digest: 65, film: 60, gang: 45, bar: 30, kul: 25, kaos: 15,
};
export const PRIO_RESERVE = 60;
/** Kind for logging + settings: pushCat + the new v2 tags. */
export function ntfKind(tag: string): string {
  const t = String(tag || "");
  if (/^olnu-digest/.test(t)) return "digest";
  return pushCat(t) || "other";
}
export function prioOf(tag: string): number {
  const t = String(tag || "");
  if (/^olnu-\d+-f10$/.test(t)) return 85;   // care: "Kolla läget med Oskar"
  if (/^olnu-(come|coming|knuff)-/.test(t)) return 75;   // direct to me
  return NTF_PRIO[ntfKind(t)] ?? 50;
}
export type Alt = { v: string; title: string; body: string };
/** One variant per recipient: not one of the recent ids (newest last); else the least recently used. rand in [0,1). */
export function pickVariant(alts: Alt[], recent: string[] | null | undefined, rand: () => number = Math.random): Alt {
  const list = (alts || []).filter((a) => a && a.v && a.title);
  if (list.length === 0) return { v: "", title: "", body: "" };
  const rec = Array.isArray(recent) ? recent : [];
  const fresh = list.filter((a) => !rec.includes(a.v));
  if (fresh.length) return fresh[Math.min(fresh.length - 1, Math.floor(rand() * fresh.length))];
  let best = list[0], bestAt = Infinity;
  for (const a of list) { const at = rec.lastIndexOf(a.v); if (at < bestAt) { best = a; bestAt = at; } }
  return best;
}
/** Final v2 pass for one recipient: variant, k, v, prio, ts. Keeps everything else. */
export function applyVariant(p: Record<string, unknown>, recent: string[] | null | undefined, rand: () => number = Math.random,
  now = Date.now()): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p };
  const tag = String(p.tag ?? "");
  const alts = Array.isArray(p.alts) ? (p.alts as Alt[]) : null;
  if (alts && alts.length) {
    const a = pickVariant(alts, recent, rand);
    if (a.title) { out.title = tidyTitle(a.title); out.body = tidyBody(a.body); out.v = a.v; }
  }
  delete out.alts;
  out.k = ntfKind(tag);
  if (!out.v) out.v = String(out.k) + ".0";
  out.prio = prioOf(tag);
  if (!out.ts) out.ts = now;
  return out;
}
/** Night label "2026-11-08" (the evening the night belongs to, 05:00 switch, Stockholm). */
export function nightKey(ms: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms - 5 * 3600e3));
}
function nm(x: string, d: string): string { return cleanBarName(x) || d; }
function both(a: string[]): string {
  const n = a.filter(Boolean);
  return n.length <= 1 ? (n[0] || "") : `${n[0]} och ${n[1]}`;
}
// ---- v2 builders (Swedish, names first, max one emoji in the title, several variants each) ----
/** Friend's first drink of the night (level 1). No count, no drink words in the title. */
export function friendOutV2(namn: string, bar: string, tid: string, beerId: number, ms: number, face = "") {
  const n = nm(namn, "En vän"), b = cleanBarName(bar);
  return {
    title: b ? `${n} på ${b} 🍺` : `${n} är ute 🍺`, body: `Sedan ${tid}. Hänger du på?`,
    alts: [
      { v: "fo.1", title: b ? `${n} på ${b} 🍺` : `${n} är ute 🍺`, body: `Sedan ${tid}. Hänger du på?` },
      { v: "fo.2", title: `${n} har dragit ut`, body: b ? `${b} sedan ${tid}. Tryck Kommer! så vet ${n}.` : `Sedan ${tid}. Tryck Kommer! så vet ${n}.` },
      { v: "fo.3", title: `${n} är ute ikväll`, body: `${b ? b + ". " : ""}Kom förbi, det finns plats.` },
      { v: "fo.4", title: b ? `${n} har hittat till ${b}` : `${n} har startat kvällen`, body: `Kl ${tid}. Säg till om du kommer.` },
    ],
    url: `/?focus=${beerId}`,
    tag: `olnu-${beerId}-f1`,
    dg: b ? `${n} på ${b}` : `${n} är ute`,
    face,
    fold: { key: `ute-${nightKey(ms)}`, title: "{n} vänner är ute", line: `${n}${b ? " · " + b : ""} · ${tid}` },
    actions: [
      { action: "coming", title: "🏃 Jag kommer", url: `/?focus=${beerId}&act=coming` },
      { action: "skal", title: "🍻 Skål", url: `/?focus=${beerId}&act=skal` },
    ],
  };
}
/** Care push at the friend's 10th (no number shown). */
export function friendCareV2(namn: string, beerId: number, face = "") {
  const n = nm(namn, "Din vän");
  return {
    title: `Kolla läget med ${n}`, body: "Ring eller gå dit. Vatten och en taxi hem hjälper.",
    alts: [
      { v: "fc.1", title: `Kolla läget med ${n}`, body: "Ring eller gå dit. Vatten och en taxi hem hjälper." },
      { v: "fc.2", title: `Hur mår ${n}?`, body: `Ett samtal nu räcker. Hjälp ${n} hem om det behövs.` },
    ],
    url: `/?focus=${beerId}`, tag: `olnu-${beerId}-f10`, dg: `Kolla läget med ${n}`, face,
  };
}
export function checkinV2(namn: string, bar: string, barId: string, stamp: number, here: number, tid: string, ms: number, face = "") {
  const n = nm(namn, "En vän"), b = nm(bar, "en krog");
  const bid = String(barId || "").slice(0, 80);
  const many = here >= 2;
  return {
    title: `${n} på ${b} 📍`, body: many ? `${here} från gänget är där nu.` : `Incheckad ${tid}. Stolen bredvid är ledig.`,
    alts: many ? [
      { v: "ck.m1", title: `${n} på ${b} 📍`, body: `${here} från gänget är där nu. Hänger du på?` },
      { v: "ck.m2", title: `${here} från gänget på ${b}`, body: `${n} kom ${tid}. Ni är flest där just nu.` },
      { v: "ck.m3", title: `${n} anslöt på ${b}`, body: `Nu är ni ${here}. Saknas bara du.` },
    ] : [
      { v: "ck.1", title: `${n} på ${b} 📍`, body: `Incheckad ${tid}. Stolen bredvid är ledig.` },
      { v: "ck.2", title: `${n} har checkat in`, body: `${b} kl ${tid}. Bli nummer två?` },
      { v: "ck.3", title: `${n} är på ${b}`, body: `Sedan ${tid}. Tryck för att se var.` },
    ],
    url: bid ? `/?bar=${encodeURIComponent(bid)}` : "/",
    tag: bid ? `olnu-checkin-${bid}`.slice(0, 120) : `olnu-checkin-${stamp}`,
    dg: `${n} på ${b}`, face,
    fold: { key: `ute-${nightKey(ms)}`, title: "{n} vänner är ute", line: `${n} · ${b} · ${tid}` },
    actions: [{ action: "skal", title: "🍻 Skål", url: bid ? `/?bar=${encodeURIComponent(bid)}&act=skal` : "/" }],
  };
}
/** 🍺 Ikväll? with social proof (only when >= 2 from the gang said Ute). Buttons answer at once. */
export function ikvallProofV2(names: string[], n: number, ms: number) {
  const ns = (names || []).map((x) => cleanBarName(x)).filter(Boolean).slice(0, 2);
  const a = ns[0] || "Gänget";
  let who = n > 2 && ns.length === 2 ? `${ns[0]}, ${ns[1]} +${n - 2}` : both(ns) || a;
  if ([...`${who} ska ut ikväll`].length > TITLE_MAX) who = n > 1 ? `${a} +${n - 1}` : a;   // never a cut title
  const day = nightKey(ms);
  return {
    title: `${who} ska ut ikväll`, body: "Hänger du med? Svara så ser gänget.",
    alts: [
      { v: "ik.1", title: `${who} ska ut ikväll`, body: "Hänger du med? Svara så ser gänget." },
      { v: "ik.2", title: `${n} i gänget ska ut ikväll – du?`, body: `${both(ns) || a} har svarat Ute.` },
      { v: "ik.3", title: `Ikväll? ${a} är på 🍺`, body: `${n} från gänget har sagt Ute. Du då?` },
      { v: "ik.4", title: `${a} drar ut ikväll`, body: `${n} har svarat Ute. Ett tryck så vet de.` },
    ],
    url: "/?ikvall=1", tag: `olnu-ikvall-${day}`, dg: `${n} ska ut ikväll`,
    actions: [
      { action: "ute", title: "🍺 Jag kommer", url: "/?ikvall=1&st=ute" },
      { action: "kanske", title: "🤔 Kanske", url: "/?ikvall=1&st=kanske" },
    ],
  };
}
/** 📸 The film is developed (the next morning). image = a generic branded picture (never a private photo). */
export function filmV2(groupName: string, n: number, groupId: string) {
  const g = nm(groupName, "gänget"), k = Math.max(1, n | 0);
  return {
    title: "Gårdagens film är framkallad 📸", body: `${k} bilder från ${g}. Vem blundade?`,
    alts: [
      { v: "fi.1", title: "Gårdagens film är framkallad 📸", body: `${k} bilder från ${g}. Vem blundade?` },
      { v: "fi.2", title: `${k} nya bilder från igår 📸`, body: `Engångskameran i ${g} är framkallad.` },
      { v: "fi.3", title: `Filmen från ${g} är klar 📸`, body: `${k} bilder. Se vem som kom med på bild.` },
      { v: "fi.4", title: "Mörkrummet är klart 📸", body: `${k} bilder från ${g} väntar på dig.` },
    ],
    url: `/?film=${groupId}`, tag: `olnu-film-${groupId}`, image: "./icons/ntf-film.png?v=1",
  };
}
/** 🔥 Celebration of a group that met up N weekends in a row (never a "streak at risk" push). */
export function gangStreakV2(groupName: string, streak: number, groupId: string) {
  const g = nm(groupName, "Gänget"), s = Math.max(3, streak | 0);
  return {
    title: `${g}: ${s} helger i rad 🔥`, body: "Minst tre av er har setts varje helg. Snyggt.",
    alts: [
      { v: "gs.1", title: `${g}: ${s} helger i rad 🔥`, body: "Minst tre av er har setts varje helg. Snyggt." },
      { v: "gs.2", title: `Ni har setts ${s} helger i rad`, body: `${g} håller ihop. Se historiken.` },
      { v: "gs.3", title: `${s} helger i rad för ${g} 🔥`, body: "Ni ses mer än de flesta gäng. Bra jobbat." },
    ],
    url: "/?helg=1", tag: `olnu-gang-${groupId}`.slice(0, 120), dg: `${g}: ${s} helger i rad`,
  };
}
/** 👋 Win-back: once, only with real news from the gang. Honest: "we ask only once". */
export function winbackV2(groupName: string, names: string[], n: number) {
  const g = nm(groupName, "Gänget");
  const ns = (names || []).map((x) => cleanBarName(x)).filter(Boolean).slice(0, 2);
  const who = both(ns) || g;
  return {
    title: `${g} saknar dig 👋`, body: `${who} har hittat på grejer. Vi frågar bara en gång.`,
    alts: [
      { v: "wb.1", title: `${g} saknar dig 👋`, body: `${who} har hittat på grejer. Vi frågar bara en gång.` },
      { v: "wb.2", title: `${who} har varit igång`, body: `${n} i ${g} har setts sen sist. Kika in? Vi frågar bara en gång.` },
    ],
    url: "/", tag: "olnu-winback-1", dg: `${g} saknar dig`,
  };
}
/** ⏰ Event in 1 hour (📅 Går). n = people going (incl. you). */
export function eventDueV2(titel: string, hm: string, place: string, n: number, eventId: number) {
  const t = nm(titel, "Eventet"), p = cleanBarName(place);
  const going = n > 1 ? `${n} går` : "";
  return {
    title: `${t} ${hm} ⏰`, body: [going, p, "Tryck för vägen dit."].filter(Boolean).join(" · "),
    alts: [
      { v: "ev.1", title: `${t} ${hm} ⏰`, body: [going, p, "Tryck för vägen dit."].filter(Boolean).join(" · ") },
      { v: "ev.2", title: `Om en timme: ${t}`, body: [hm, p, going].filter(Boolean).join(" · ") },
      { v: "ev.3", title: n > 1 ? `${t} – ${n} går` : `${t} snart`, body: [`Börjar ${hm}`, p].filter(Boolean).join(" · ") },
    ],
    url: `/?evs=${eventId}`, tag: `olnu-evgo-${eventId}`,
  };
}
/** Skåltimmen without "show your drink". */
export function skalHourV2(namn: string, groupName: string, hourId: number) {
  const n = nm(namn, "Slumpen"), g = nm(groupName, "gruppen");
  return {
    title: "Skåltimmen 📸 3 min", body: `${n} startade. Ta en bild på gänget · ${g}`,
    alts: [
      { v: "sk.1", title: "Skåltimmen 📸 3 min", body: `${n} startade. Ta en bild på gänget · ${g}` },
      { v: "sk.2", title: `${n} drog igång skåltimmen`, body: `3 minuter. Visa var ni är · ${g}` },
    ],
    url: `/?skal=${hourId}`, tag: `olnu-skal-${hourId}`,
  };
}
// ---- md5 (for olnu_chief_k without a database call). Small, pure, tested against the SQL value. ----
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_v, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5hex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const n = (((bytes.length + 8) >> 6) + 1) * 16;
  const w = new Array<number>(n).fill(0);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  w[n - 2] = (bytes.length * 8) >>> 0;
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < n; o += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const s = MD5_S[(i >> 4) * 4 + (i % 4)];
      const x = (a + f + MD5_K[i] + w[o + g]) | 0;
      a = d; d = c; c = b;
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map((v) => Array.from({ length: 4 }, (_x, i) => ((v >>> (i * 8)) & 255).toString(16).padStart(2, "0")).join("")).join("");
}
/** Same as SQL olnu_chief_k(group, uid): the avatar key the app knows for a group mate. */
export function faceKey(groupId: string, uid: string): string {
  return isUuid(groupId) && isUuid(uid) ? md5hex(`${groupId}:${uid}:olnu-chief`).slice(0, 12) : "";
}
/** Feed row (in-app fallback) for a push the user did not get. */
export function feedRow(uid: string, p: Record<string, unknown>, why: string) {
  return { u: uid, k: String(p.k ?? ntfKind(String(p.tag ?? ""))), v: String(p.v ?? ""), t: String(p.title ?? "").slice(0, 80),
    b: String(p.body ?? "").slice(0, 160), url: String(p.url ?? "/").slice(0, 200), why };
}
// ---- bold × ntf (bold PLAN.md §1.7, §3.7; flags bold_flags.bold_skal_v2 / bold_replay, OFF until release) ----
/** 📸 Skåltimmen v2 (Fri/Sat 21:00–00:30, only to members who are out; the 90-min cap is in bold_skal_targets). */
export function skalBoldV2(groupName: string, hourId: number) {
  const g = nm(groupName, "Gänget");
  return {
    title: "Skåltimmen! Visa var ni är 📸", body: `${g}: bakkamera + selfie. Först in vinner äran.`,
    alts: [
      { v: "sb.1", title: "Skåltimmen! Visa var ni är 📸", body: `${g}: bakkamera + selfie. Först in vinner äran.` },
      { v: "sb.2", title: "Skåltimmen! Var ä ni? 📸", body: `${g}: en bild, inga omtag-ångest. Klockan tickar.` },
      { v: "sb.3", title: "Skåltimmen! Kameran fram 📸", body: `${g}: visa stället, visa fejset. 3 min.` },
    ],
    url: `/?skal=${hourId}`, tag: `olnu-skal2-${hourId}`, dg: `Skåltimmen i ${g}`,
    actions: [{ action: "cam", title: "📸 Visa", url: `/?skal=${hourId}` }],
  };
}
/** ▶ Kvällsreprisen (10:30 the next morning; merged into the 10:00 film push when there is one). bars = bars visited. */
export function replayReadyV2(groupName: string, bars: number, groupId: string) {
  const g = nm(groupName, "Gänget"), n = Math.max(0, bars | 0);
  return {
    title: "Gårdagens kväll som film ▶", body: `${g}: 15 sekunder, alla spår, inga hemadresser.`,
    alts: [
      { v: "rp.1", title: "Gårdagens kväll som film ▶", body: `${g}: 15 sekunder, alla spår, inga hemadresser.` },
      { v: "rp.2", title: "Kvällsreprisen ä klar 📼", body: `${g}: spela, skratta, spara som video.` },
      ...(n >= 2 ? [{ v: "rp.3", title: `Ni va på ${n} krogar igår 🎬`, body: `${g}: se filmen. 15 sekunder, alla spår.` }] : []),
    ],
    url: `/?replay=${groupId}`, tag: `olnu-replay-${groupId}`, dg: `Kvällsreprisen från ${g}`,
    actions: [{ action: "play", title: "▶ Spela", url: `/?replay=${groupId}` }],
  };
}
export const REPLAY_FILM_LINE = " …och kvällsreprisen ä klar ▶";
/** The 10:00 film push + the replay line and a ▶ Spela button (one push, not two). */
export function withReplay(p: Record<string, unknown>, groupId: string): Record<string, unknown> {
  const acts = Array.isArray(p.actions) ? (p.actions as Record<string, unknown>[]) : [];
  return { ...p, body: String(p.body ?? "") + REPLAY_FILM_LINE,
    alts: Array.isArray(p.alts) ? (p.alts as Alt[]).map((a) => ({ ...a, body: a.body + REPLAY_FILM_LINE })) : p.alts,
    actions: [...acts, { action: "play", title: "▶ Spela", url: `/?replay=${groupId}` }].slice(0, 2) };
}
// krog_crown (PLAN §4.7) stays OFF in v1: tag olnu-crown-* maps to kind "bar" (paced, prio 30) if it is ever sent.
// ---- ntf v2 — pure block end ----

// ---- pure:end ----

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-olnu-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

const MAX_KAOS_RECIPIENTS = 500;

let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  } catch (e) {
    console.error("Invalid VAPID config", e);
  }
}

// Best effort "not the same line twice in a row" for friend pushes (per warm isolate).
const lastFriendLine = new Map<string, number>();
function rememberLine(key: string, idx: number) {
  if (lastFriendLine.size > 5000) lastFriendLine.clear();
  lastFriendLine.set(key, idx);
}

type Sub = { id: number; user_id: string; endpoint: string; p256dh: string; auth: string };
type Job = { sub: Sub; payload: string };

// deno-lint-ignore no-explicit-any
type Admin = any;

async function friendJobs(admin: Admin, uid: string, beerId: number, level: 1 | 5 | 10, titel = "", bar = "", tid = ""): Promise<Job[]> {
  const { data: mine, error: mineErr } = await admin
    .from("group_members")
    .select("group_id, display_name")
    .eq("user_id", uid);
  if (mineErr) throw mineErr;
  if (!mine || mine.length === 0) return [];

  const nameByGroup = new Map<string, string>();
  for (const m of mine) nameByGroup.set(m.group_id as string, m.display_name as string);

  const { data: others, error: othersErr } = await admin
    .from("group_members")
    .select("group_id, user_id")
    .in("group_id", [...nameByGroup.keys()])
    .neq("user_id", uid);
  if (othersErr) throw othersErr;

  const senderNameFor = new Map<string, string>();
  for (const o of others ?? []) {
    const rid = o.user_id as string;
    const name = nameByGroup.get(o.group_id as string);
    if (!name) continue;
    // Deterministic pick if they share several groups: smallest name.
    const prev = senderNameFor.get(rid);
    if (prev === undefined || name < prev) senderNameFor.set(rid, name);
  }
  if (senderNameFor.size === 0) return [];

  const { data: subs, error: subsErr } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", [...senderNameFor.keys()]);
  if (subsErr) throw subsErr;

  // One line per recipient (all their devices get the same text).
  const lines = FRIEND_LINES[level];
  const lineFor = new Map<string, number>();
  for (const rid of senderNameFor.keys()) {
    const key = `${rid}:${level}`;
    const idx = pickIndex(lines.length, lastFriendLine.get(key));
    rememberLine(key, idx);
    lineFor.set(rid, idx);
  }
  // v28 (deploy): friendPayload28 (short title, specific body, one tag per pin "olnu-<beer>-f<level>", same buttons:
  // "🍺 Kommer!" on 1, "🍻 Skåla" on 1 and 5, none on 10). The beer id is in the url and tag, never the user id.
  if (V2.on && level === 5) return [];   // ntf v2 (store-safe): no "5th drink" push
  const faces = V2.on ? await v2Faces(admin, uid, [...senderNameFor.keys()]) : new Map<string, string>();
  return ((subs ?? []) as Sub[]).map((s) => ({
    sub: s,
    payload: JSON.stringify(V2.on   // ntf v2: variants, face, fold; the 10th = a care push without the number
      ? (level === 10 ? friendCareV2(senderNameFor.get(s.user_id) ?? "", beerId, faces.get(s.user_id) ?? "")
        : friendOutV2(senderNameFor.get(s.user_id) ?? "", bar, tid, beerId, Date.now(), faces.get(s.user_id) ?? ""))
      : friendPayload28(level, lineFor.get(s.user_id) ?? 0, senderNameFor.get(s.user_id) ?? "En vän", titel, beerId, bar, tid)),
  }));
}

async function kaosJobs(
  admin: Admin,
  uid: string,
  beer: { lat: number; lng: number; expires_at: string },
): Promise<{ jobs: Job[]; out: number; hot: number; chaos: boolean }> {
  const center = { lat: beer.lat, lng: beer.lng };
  const nowIso = new Date().toISOString();

  // 1. Live beers in a box around the beer, exact distance in JS.
  const b5 = boxAround(center, CHAOS_RADIUS_KM);
  const { data: near, error: nearErr } = await admin
    .from("beers")
    .select("lat, lng, beer_count, other_count")
    .gt("expires_at", nowIso)
    .eq("stopped", false)
    .gte("lat", b5.minLat).lte("lat", b5.maxLat)
    .gte("lng", b5.minLng).lte("lng", b5.maxLng)
    .limit(5000);
  if (nearErr) throw nearErr;
  const { out, hot, chaos } = chaosCheck(center, (near ?? []) as LiveBeer[]);
  if (!chaos) return { jobs: [], out, hot, chaos };

  // 2. Subscribers whose saved area is within 10 km (never the beer's owner).
  const b10 = boxAround(center, PUSH_RADIUS_KM);
  const { data: subsRaw, error: subsErr } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .gte("lat", b10.minLat).lte("lat", b10.maxLat)
    .gte("lng", b10.minLng).lte("lng", b10.maxLng)
    .neq("user_id", uid)
    .limit(5000);
  if (subsErr) throw subsErr;
  const subs = ((subsRaw ?? []) as (Sub & Pt)[]).filter((s) => haversineKm(center, s) <= PUSH_RADIUS_KM);
  if (subs.length === 0) return { jobs: [], out, hot, chaos };

  // 3. Once per user per night: claim rows in push_sent. Only newly inserted rows come back
  //    (insert ... on conflict do nothing returning), so parallel calls cannot double-send.
  const userIds = [...new Set(subs.map((s) => s.user_id))].slice(0, MAX_KAOS_RECIPIENTS);
  const { data: claimed, error: claimErr } = await admin
    .from("push_sent")
    .upsert(
      userIds.map((u) => ({ user_id: u, kind: "kaos", night: beer.expires_at })),
      { onConflict: "user_id,kind,night", ignoreDuplicates: true },
    )
    .select("user_id");
  if (claimErr) throw claimErr;
  const fresh = new Set(((claimed ?? []) as { user_id: string }[]).map((r) => r.user_id));
  if (fresh.size === 0) return { jobs: [], out, hot, chaos };

  const stad = nearestTown(center);
  const jobs = subs
    .filter((s) => fresh.has(s.user_id))
    .map((s) => {
      const idx = kaosLineIndex(kaosPool(stad).length, beer.expires_at, s.user_id);   // tx04: town lines too
      return { sub: s, payload: JSON.stringify(kaosPayload28(idx, stad, out, hot, beer.expires_at)) };
    });

  // Light cleanup of old nights (kept out of the SQL migration on purpose).
  if (Math.random() < 0.05) {
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    // Keep the forever rows (level-up 'title:*', night 2100-01-01): they are in the future anyway, but be explicit.
    const { error } = await admin.from("push_sent").delete().lt("night", old).neq("night", "2100-01-01T00:00:00Z");
    if (error) console.error("push_sent cleanup failed", error);
  }
  return { jobs, out, hot, chaos };
}

/** v27 🔔 NOTISKOLL: drop jobs the recipient turned off, jobs in the recipient's nattro, and noisy jobs over the
 *  recipient's cap per night (push_rx_take, one count per user per send). SOS/medevac/walk/find always pass.
 *  Any error (old database without 0190) = send everything, as before. */
async function gate(admin: Admin, jobs: Job[]): Promise<{ jobs: Job[]; held: number }> {
  if (jobs.length === 0) return { jobs, held: 0 };
  const cats = jobs.map((j) => {
    try { return pushCat(String((JSON.parse(j.payload) as { tag?: string }).tag ?? "")); } catch (_e) { return ""; }
  });
  const uids = [...new Set(jobs.filter((_j, i) => cats[i] && cats[i] !== "safe").map((j) => j.sub.user_id))];
  if (uids.length === 0) return { jobs, held: 0 };
  try {
    const prefs = new Map<string, PushPref>();
    for (let k = 0; k < uids.length; k += 150) {   // chunks keep the GET url short (KAOS may have 500 recipients)
      const { data, error } = await admin.from("push_prefs").select("user_id, off, quiet_from, quiet_to, cap").in("user_id", uids.slice(k, k + 150));
      if (error) throw error;
      for (const r of (data ?? []) as (PushPref & { user_id: string })[]) prefs.set(r.user_id, r);
    }
    const hour = stockholmHour(Date.now());
    const verdict = jobs.map((j, i) => pushGate(cats[i], prefs.get(j.sub.user_id), hour));
    const capUsers = [...new Set(jobs.filter((_j, i) => verdict[i] === "cap").map((j) => j.sub.user_id))];
    let allowed = new Set<string>(capUsers);
    if (capUsers.length) {
      const { data: ok, error: capErr } = await admin.rpc("push_rx_take", {
        p_uids: capUsers, p_caps: capUsers.map((u) => capOf(prefs.get(u))),
      });
      if (capErr) console.warn("push_rx_take", capErr.message);
      else allowed = new Set(((ok ?? []) as unknown[]).map((x) => String(typeof x === "object" && x ? Object.values(x)[0] : x)));
    }
    const keep = jobs.filter((j, i) => verdict[i] === "send" || (verdict[i] === "cap" && allowed.has(j.sub.user_id)));
    return { jobs: keep, held: jobs.length - keep.length };
  } catch (e) {
    console.warn("push gate skipped", e instanceof Error ? e.message : String(e));
    return { jobs, held: 0 };
  }
}

// ---- v28 🔕 LUGNA NOTISER (0260) — runtime block start ----
// gate28 runs for EVERY push (sendAll): tidyPayload → evening rule → v27 off / nattro → pace per recipient
// (push_pace_take, migration 0260). Errors (database without 0260) fall back to the v27 gate (cap per night).
// paceFlush: held lines whose gap is over go out as ONE digest; runs at most every 30 s per isolate in any call
// and in the cron. Other agents: nothing to call — a new kind only needs a tag (see pushCat / HYPE_RE).
type PaceRow = { uid: string; verdict: string; held_n: number; held_lines: string[] | null; held_grp: string | null };
async function gate28(admin: Admin, jobs: Job[]): Promise<{ jobs: Job[]; held: number }> {
  if (jobs.length === 0) return { jobs, held: 0 };
  const now = Date.now();
  const hour = stockholmHour(now);
  const all = jobs.map((j) => {
    try {
      const p = tidyPayload(JSON.parse(j.payload) as Record<string, unknown>);
      return { sub: j.sub, p, cat: p.cat === "other" ? "" : String(p.cat) };
    } catch (_e) {
      return { sub: j.sub, p: null as Record<string, unknown> | null, cat: "", raw: j.payload };
    }
  });
  const asJob = (t: { sub: Sub; p: Record<string, unknown> | null; raw?: string }): Job =>
    ({ sub: t.sub, payload: t.p ? JSON.stringify(t.p) : (t.raw ?? "{}") });
  const day = all.filter((t) => !!t.p && rule28(t.cat, String(t.p.tag ?? ""), hour) === "day").length;
  const kept = all.filter((t) => !t.p || rule28(t.cat, String(t.p.tag ?? ""), hour) !== "day");
  if (kept.length === 0) return { jobs: [], held: day };
  try {
    const uids = [...new Set(kept.filter((t) => t.cat && t.cat !== "safe").map((t) => t.sub.user_id))];
    const prefs = new Map<string, PushPref>();
    for (let k = 0; k < uids.length; k += 150) {
      const { data, error } = await admin.from("push_prefs").select("user_id, off, quiet_from, quiet_to, cap").in("user_id", uids.slice(k, k + 150));
      if (error) throw error;
      for (const r of (data ?? []) as (PushPref & { user_id: string })[]) prefs.set(r.user_id, r);
    }
    const verdict = kept.map((t) => pushGate(t.cat, prefs.get(t.sub.user_id), hour));
    const out: Job[] = [];
    // Pace candidates per user (pushGate "cap" = the paced kinds), in job order.
    const cand = new Map<string, { subs: Map<number, Sub>; ps: Record<string, unknown>[] }>();
    kept.forEach((t, i) => {
      if (verdict[i] === "send") { out.push(asJob(t)); return; }
      if (verdict[i] !== "cap" || !t.p) return;   // off / quiet: dropped
      let c = cand.get(t.sub.user_id);
      if (!c) { c = { subs: new Map(), ps: [] }; cand.set(t.sub.user_id, c); }
      c.subs.set(t.sub.id, t.sub);
      if (!c.ps.some((p) => p.tag === t.p!.tag)) c.ps.push(t.p);
    });
    if (cand.size) {
      const users = [...cand.keys()];
      const { data, error } = await admin.rpc("push_pace_take", {
        p_uids: users,
        p_lines: users.map((u) => digestLine(cand.get(u)!.ps[0], now)),
        p_grps: users.map((u) => String(cand.get(u)!.ps[0].grp ?? "") || null),
        p_gaps: users.map((u) => paceOf(prefs.get(u)).gap),
        p_maxes: users.map((u) => paceOf(prefs.get(u)).max),
      });
      if (error) throw error;
      const rows = new Map<string, PaceRow>(((data ?? []) as PaceRow[]).map((r) => [String(r.uid), r]));
      for (const u of users) {
        const c = cand.get(u)!, r = rows.get(u);
        if (!r || (r.verdict !== "send" && r.verdict !== "digest")) continue;   // hold / cap: dropped (held = saved)
        const mine = c.ps.map((p) => digestLine(p, now));
        const held = r.verdict === "digest" ? (r.held_lines ?? []) : [];
        const p = held.length + mine.length > 1
          ? digestPayload([...held, ...mine], r.held_grp || String(c.ps[0].grp ?? ""))
          : c.ps[0];
        for (const s of c.subs.values()) out.push({ sub: s, payload: JSON.stringify(p) });
      }
    }
    return { jobs: out, held: jobs.length - out.length };
  } catch (e) {
    console.warn("gate28 fallback to v27", e instanceof Error ? e.message : String(e));
    const g = await gate(admin, kept.map(asJob));
    return { jobs: g.jobs, held: g.held + day };
  }
}
let lastFlush28 = 0;
/** Send ONE digest to users with held lines whose gap is over (push_pace_due claims them atomically). */
async function paceFlush(admin: Admin): Promise<number> {
  if (Date.now() - lastFlush28 < 30_000) return 0;
  lastFlush28 = Date.now();
  try {
    const { data, error } = V2.on   // ntf v2: a digest never goes past the night budget
      ? await admin.rpc("push_pace_due2", { p_gap: PACE_GAP_SEC, p_limit: 25, p_max: PACE_NIGHT_MAX })
      : await admin.rpc("push_pace_due", { p_gap: PACE_GAP_SEC, p_limit: 25 });
    if (error || !Array.isArray(data) || data.length === 0) return 0;
    const rows = data as PaceRow[];
    const hour = stockholmHour(Date.now());
    const { data: pr } = await admin.from("push_prefs").select("user_id, off, quiet_from, quiet_to, cap").in("user_id", rows.map((r) => r.uid));
    const quiet = new Set(((pr ?? []) as (PushPref & { user_id: string })[])
      .filter((p) => inQuiet(hour, p.quiet_from, p.quiet_to)).map((p) => p.user_id));
    const by = new Map(rows.filter((r) => !quiet.has(String(r.uid)) && (r.held_lines ?? []).length).map((r) => [String(r.uid), r]));
    if (by.size === 0) return 0;
    const jobs = (await subsOf(admin, [...by.keys()])).map((s) => {
      const r = by.get(s.user_id)!;
      const dp = digestPayload(r.held_lines ?? [], r.held_grp);
      return { sub: s, payload: JSON.stringify(V2.on ? applyVariant(dp, null) : dp) };   // ntf v2: k/v for the log
    });
    return jobs.length ? (await sendAll(admin, jobs, 1800, true)).sent : 0;
  } catch (e) {
    console.warn("paceFlush", e instanceof Error ? e.message : String(e));
    return 0;
  }
}
// ---- v28 🔕 LUGNA NOTISER — runtime block end ----

// ---- ntf v2 (0390) — runtime block start ----
// V2.on mirrors push_v2_flags (read at most every 60 s per isolate). Everything below is a no-op while ntf_v2 is off.
const V2 = { on: false, flags: {} as Record<string, boolean>, at: 0, bold: { skal: false, replay: false } };
async function v2Load(admin: Admin): Promise<boolean> {
  if (Date.now() - V2.at < 60_000) return V2.on;
  V2.at = Date.now();
  try {
    const { data, error } = await admin.rpc("push_v2_flags_get");
    if (error) throw error;
    V2.flags = (data && typeof data === "object" ? data : {}) as Record<string, boolean>;
    V2.on = V2.flags.ntf_v2 === true;
  } catch (_e) { V2.flags = {}; V2.on = false; }   // database without 0390: v28 as before
  // bold × ntf (0391): bold_flags via ntf_bold_on (false while the bold table is missing)
  for (const [k, f] of [["skal", "bold_skal_v2"], ["replay", "bold_replay"]] as const) {
    try { const { data, error } = await admin.rpc("ntf_bold_on", { p_key: f }); V2.bold[k] = !error && data === true; } catch (_e) { V2.bold[k] = false; }
  }
  return V2.on;
}
type V2Stat = { kind: string; recent: string[] | null; muted: boolean };
async function v2Stats(admin: Admin, uids: string[]): Promise<Map<string, V2Stat>> {
  const m = new Map<string, V2Stat>();
  for (let k = 0; k < uids.length; k += 500) {
    const { data, error } = await admin.rpc("push_stats_get", { p_uids: uids.slice(k, k + 500) });
    if (error) throw error;
    for (const r of (data ?? []) as (V2Stat & { uid: string })[]) m.set(`${r.uid}|${r.kind}`, r);
  }
  return m;
}
/** Shared group per recipient (the sender's first group they are in) → avatar key for the icon. */
// I-19e (owner 12 Nov: "a different icon in each group"): ONE icon on every push (the app icon + the monochrome badge,
// docs/sw.js). The sender's face as the icon is off. Set true again only on an owner decision.
export const FACE_ICON = false;
async function v2Faces(admin: Admin, uid: string, rids: string[]): Promise<Map<string, string>> {
  if (!FACE_ICON) return new Map<string, string>();
  const out = new Map<string, string>();
  if (!V2.on || !rids.length) return out;
  try {
    const { data: mine } = await admin.from("group_members").select("group_id").eq("user_id", uid).order("joined_at").limit(50);
    const gids = ((mine ?? []) as { group_id: string }[]).map((r) => r.group_id);
    if (!gids.length) return out;
    const { data: rows } = await admin.from("group_members").select("group_id, user_id").in("group_id", gids).in("user_id", rids.slice(0, 500));
    const rs = ((rows ?? []) as { group_id: string; user_id: string }[]).sort((a, b) => gids.indexOf(a.group_id) - gids.indexOf(b.group_id));
    for (const r of rs) if (!out.has(r.user_id)) out.set(r.user_id, faceKey(r.group_id, uid));
  } catch (_e) { /* no faces: app icon */ }
  return out;
}
async function v2Feed(admin: Admin, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  try { await admin.rpc("ntf_feed_add", { p_rows: rows.slice(0, 2000) }); } catch (e) { console.warn("ntf_feed_add", String(e)); }
}
/** gate28 + v2: variant per recipient, auto-mute, priorities (push_pace_take2), feed rows for what was not sent. */
async function gateV2(admin: Admin, jobs: Job[]): Promise<{ jobs: Job[]; held: number }> {
  const now = Date.now();
  const hour = stockholmHour(now);
  const all = jobs.map((j) => {
    try {
      const p = tidyPayload(JSON.parse(j.payload) as Record<string, unknown>);
      return { sub: j.sub, p, cat: p.cat === "other" ? "" : String(p.cat) };
    } catch (_e) {
      return { sub: j.sub, p: null as Record<string, unknown> | null, cat: "", raw: j.payload };
    }
  });
  const asJob = (t: { sub: Sub; p: Record<string, unknown> | null; raw?: string }): Job =>
    ({ sub: t.sub, payload: t.p ? JSON.stringify(t.p) : (t.raw ?? "{}") });
  const feed: Record<string, unknown>[] = [];
  const day = all.filter((t) => !!t.p && rule28(t.cat, String(t.p.tag ?? ""), hour, now) === "day").length;
  let kept = all.filter((t) => !t.p || rule28(t.cat, String(t.p.tag ?? ""), hour, now) !== "day");
  if (kept.length === 0) return { jobs: [], held: day };
  const uids = [...new Set(kept.map((t) => t.sub.user_id))];
  let st = new Map<string, V2Stat>();
  try { st = await v2Stats(admin, uids); } catch (e) { console.warn("push_stats_get", String(e)); }
  // one variant per recipient (all devices get the same text), chosen against that recipient's recent ids
  const perUser = new Map<string, Record<string, unknown>>();
  kept = kept.map((t) => {
    if (!t.p) return t;
    const key = `${t.sub.user_id}|${String(t.p.tag ?? "")}`;
    let q = perUser.get(key);
    if (!q) { q = applyVariant(t.p, st.get(`${t.sub.user_id}|${ntfKind(String(t.p.tag ?? ""))}`)?.recent, Math.random, now); perUser.set(key, q); }
    return { ...t, p: q };
  });
  // auto-mute (kaos/bar/kul/gang never opened): to the feed, not to the phone
  const muted = (t: { sub: Sub; p: Record<string, unknown> | null }) =>
    !!t.p && st.get(`${t.sub.user_id}|${String(t.p.k)}`)?.muted === true && Number(t.p.prio) < PRIO_RESERVE;
  const seenFeed = new Set<string>();
  const toFeed = (u: string, p: Record<string, unknown>, why: string) => {
    const k = `${u}|${String(p.tag ?? "")}`;
    if (seenFeed.has(k)) return; seenFeed.add(k); feed.push(feedRow(u, p, why));
  };
  kept = kept.filter((t) => { if (muted(t)) { toFeed(t.sub.user_id, t.p!, "muted"); return false; } return true; });
  try {
    const pu = [...new Set(kept.filter((t) => t.cat && t.cat !== "safe").map((t) => t.sub.user_id))];
    const prefs = new Map<string, PushPref>();
    for (let k = 0; k < pu.length; k += 150) {
      const { data, error } = await admin.from("push_prefs").select("user_id, off, quiet_from, quiet_to, cap").in("user_id", pu.slice(k, k + 150));
      if (error) throw error;
      for (const r of (data ?? []) as (PushPref & { user_id: string })[]) prefs.set(r.user_id, r);
    }
    const verdict = kept.map((t) => pushGate(t.cat, prefs.get(t.sub.user_id), hour));
    const out: Job[] = [];
    const cand = new Map<string, { subs: Map<number, Sub>; ps: Record<string, unknown>[] }>();
    kept.forEach((t, i) => {
      if (verdict[i] === "send") { out.push(asJob(t)); return; }
      if (verdict[i] === "quiet" && t.p && Number(t.p.prio) >= PRIO_RESERVE) toFeed(t.sub.user_id, t.p, "quiet");
      if (verdict[i] !== "cap" || !t.p) return;
      let c = cand.get(t.sub.user_id);
      if (!c) { c = { subs: new Map(), ps: [] }; cand.set(t.sub.user_id, c); }
      c.subs.set(t.sub.id, t.sub);
      if (!c.ps.some((p) => p.tag === t.p!.tag)) c.ps.push(t.p);
    });
    if (cand.size) {
      const users = [...cand.keys()];
      // best first: the highest priority of a user's candidates decides (and is the one shown when alone)
      for (const u of users) cand.get(u)!.ps.sort((a, b) => Number(b.prio) - Number(a.prio));
      const { data, error } = await admin.rpc("push_pace_take2", {
        p_uids: users,
        p_lines: users.map((u) => digestLine(cand.get(u)!.ps[0], now)),
        p_grps: users.map((u) => String(cand.get(u)!.ps[0].grp ?? "") || null),
        p_gaps: users.map((u) => paceOf(prefs.get(u)).gap),
        p_maxes: users.map((u) => paceOf(prefs.get(u)).max),
        p_prios: users.map((u) => Number(cand.get(u)!.ps[0].prio) || 50),
        p_reserve: PRIO_RESERVE,
      });
      if (error) throw error;
      const rows = new Map<string, PaceRow>(((data ?? []) as PaceRow[]).map((r) => [String(r.uid), r]));
      for (const u of users) {
        const c = cand.get(u)!, r = rows.get(u);
        if (r && r.verdict === "cap") { for (const p of c.ps) if (Number(p.prio) >= 25) toFeed(u, p, "cap"); continue; }
        if (!r || (r.verdict !== "send" && r.verdict !== "digest")) continue;   // hold: saved for the digest
        const mine = c.ps.map((p) => digestLine(p, now));
        const held = r.verdict === "digest" ? (r.held_lines ?? []) : [];
        const p = held.length + mine.length > 1
          ? applyVariant(digestPayload([...held, ...mine], r.held_grp || String(c.ps[0].grp ?? "")), null, Math.random, now)
          : c.ps[0];
        for (const s of c.subs.values()) out.push({ sub: s, payload: JSON.stringify(p) });
      }
    }
    await v2Feed(admin, feed);
    return { jobs: out, held: jobs.length - out.length };
  } catch (e) {
    console.warn("gateV2 fallback to v27", e instanceof Error ? e.message : String(e));
    const g = await gate(admin, kept.map(asJob));
    return { jobs: g.jobs, held: g.held + day };
  }
}
/** One stats row per recipient + kind (not per device), for the pushes that were delivered to the push service. */
async function v2Sent(admin: Admin, jobs: Job[]) {
  const seen = new Set<string>(), rows: Record<string, unknown>[] = [];
  for (const j of jobs) {
    let p: Record<string, unknown> = {};
    try { p = JSON.parse(j.payload); } catch (_e) { continue; }
    const k = `${j.sub.user_id}|${String(p.k ?? "")}`;
    if (!p.k || seen.has(k)) continue;
    seen.add(k); rows.push({ u: j.sub.user_id, k: String(p.k), v: String(p.v ?? "") });
  }
  if (!rows.length) return;
  try { await admin.rpc("push_stats_sent", { p_rows: rows }); } catch (e) { console.warn("push_stats_sent", String(e)); }
}
type V2Ikv = { uid: string; names: string[] | null; n_ute: number; has_sub: boolean };
type V2Gang = { uid: string; group_id: string; group_name: string | null; streak: number; has_sub: boolean };
type V2Win = { uid: string; group_name: string | null; names: string[] | null; n_active: number };
/** Cron (x-olnu-cron): Ikväll? with social proof, gang streak, win-back — each behind its own flag (the SQL checks too). */
async function v2Cron(admin: Admin, key: string) {
  const res = { ikvall: 0, gang: 0, winback: 0, feed: 0, replay: 0 };
  await v2Load(admin);
  res.replay = await v2ReplayCron(admin, key);   // bold §3.7 (own flag bold_replay)
  if (!V2.on) return res;
  const now = Date.now();
  const run = async (fnName: string, build: (r: Record<string, unknown>) => Record<string, unknown>, field: "ikvall" | "gang" | "winback") => {
    try {
      const c = await keyRpc(key, fnName, { p_limit: 500 });
      const rows = (c.ok && Array.isArray(c.data) ? c.data : []) as Record<string, unknown>[];
      if (!rows.length) return;
      const withSub = rows.filter((r) => r.has_sub !== false && isUuid(r.uid));
      const noSub = rows.filter((r) => r.has_sub === false && isUuid(r.uid));
      const feed = noSub.map((r) => feedRow(String(r.uid), applyVariant(build(r), null, Math.random, now), "nosub"));
      await v2Feed(admin, feed); res.feed += feed.length;
      const byUid = new Map(withSub.map((r) => [String(r.uid), r]));
      const jobs = (await subsOf(admin, [...byUid.keys()])).map((s) => ({ sub: s, payload: JSON.stringify(build(byUid.get(s.user_id)!)) }));
      res[field] = jobs.length ? (await sendAll(admin, jobs, 3 * 3600)).sent || 0 : 0;
    } catch (e) { console.error("v2 cron", fnName, e); }
  };
  if (V2.flags.ikvall_proof) await run("ikvall_proof_claim", (r) => { const x = r as unknown as V2Ikv; return ikvallProofV2(x.names ?? [], Number(x.n_ute) || 2, now); }, "ikvall");
  if (V2.flags.gang_streak) await run("gang_streak_claim", (r) => { const x = r as unknown as V2Gang; return gangStreakV2(x.group_name ?? "", Number(x.streak) || 3, x.group_id); }, "gang");
  if (V2.flags.winback) await run("winback_claim", (r) => { const x = r as unknown as V2Win; return winbackV2(x.group_name ?? "", x.names ?? [], Number(x.n_active) || 2); }, "winback");
  return res;
}
/** bold §3.7 {event:"replay_ready", group_id}: the caller (a member) says the replay is ready; one push per group-night
 *  (replay_ready_claim: >= 2 members with >= 2 bar points, after 10:30, not merged into the film push). */
async function replayReadyPush(admin: Admin, uid: string, b: Body) {
  if (!V2.bold.replay) return { ...NONE, reason: "off" };
  const gid = typeof b.group_id === "string" && isUuid(b.group_id) ? b.group_id : "";
  if (!gid) return { ...NONE, reason: "no_group" };
  const { data, error } = await admin.rpc("replay_ready_claim", { p_group_id: gid, p_night: null, p_via: "push", p_uid: uid });
  if (error) { console.warn("replay_ready_claim", error.message); return { ...NONE, reason: "no_claim" }; }
  const d = (data ?? {}) as { ok?: boolean; why?: string; to?: string[]; bars?: number; group_name?: string };
  if (!d.ok) return { ...NONE, reason: d.why || "no_claim" };
  const to = (d.to ?? []).filter((x) => isUuid(x) && x !== uid);
  const payload = JSON.stringify(replayReadyV2(d.group_name ?? "", Number(d.bars) || 0, gid));
  const jobs = (await subsOf(admin, to)).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 6 * 3600) : { ...NONE, reason: "no_subs" };
}
type V2Replay = { group_id: string; group_name: string | null; bars: number; recips: string[] | null };
async function v2ReplayCron(admin: Admin, key: string): Promise<number> {
  if (!V2.bold.replay) return 0;
  try {
    const c = await keyRpc(key, "replay_ready_due", { p_limit: 100 });
    const rows = (c.ok && Array.isArray(c.data) ? c.data : []) as V2Replay[];
    let sent = 0;
    for (const r of rows.slice(0, 100)) {
      const payload = JSON.stringify(replayReadyV2(r.group_name ?? "", Number(r.bars) || 0, r.group_id));
      const jobs = (await subsOf(admin, (r.recips ?? []).filter(isUuid))).map((s) => ({ sub: s, payload }));
      if (jobs.length) sent += (await sendAll(admin, jobs, 6 * 3600)).sent || 0;
    }
    return sent;
  } catch (e) { console.error("replay cron", e); return 0; }
}
// ---- ntf v2 — runtime block end ----

/** I-19a (migration 0505): one push per user + device class. A phone can hold two rows for one user (a browser tab and the
 *  installed app). Rows with dev = null (old rows) are always kept. Per user and dev: if any row is the installed app
 *  (standalone), keep the installed rows and drop the browser rows; else keep only the newest browser row. */
export type DevRow = { dev: string | null; standalone: boolean | null; seen: string | null; created: string | null };
// deno-lint-ignore no-explicit-any
export function dedupeDevices(jobs: any[], info: Map<number, DevRow>): any[] {
  const stamp = (r: DevRow) => Date.parse(r.seen || r.created || "") || 0;
  // deno-lint-ignore no-explicit-any
  const groups = new Map<string, any[]>();
  for (const j of jobs) {
    const r = info.get(j.sub.id);
    if (!r || !r.dev) continue;
    const k = j.sub.user_id + "|" + r.dev;
    groups.set(k, (groups.get(k) ?? []).concat([j]));
  }
  // deno-lint-ignore no-explicit-any
  const drop = new Set<any>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const inst = g.filter((j) => info.get(j.sub.id)!.standalone);
    const web = g.filter((j) => !info.get(j.sub.id)!.standalone);
    if (inst.length) { web.forEach((j) => drop.add(j)); continue; }
    web.sort((a, b) => stamp(info.get(b.sub.id)!) - stamp(info.get(a.sub.id)!) || b.sub.id - a.sub.id);
    web.slice(1).forEach((j) => drop.add(j));
  }
  return drop.size ? jobs.filter((j) => !drop.has(j)) : jobs;
}
async function dedupeSend(admin: Admin, jobs: Job[]): Promise<Job[]> {
  try {
    const ids = [...new Set(jobs.map((j) => j.sub.id))];
    if (ids.length < 2) return jobs;
    const { data, error } = await admin.from("push_subscriptions").select("id, dev, standalone, seen_at, created_at").in("id", ids);
    if (error || !data) return jobs;   // columns missing (0505 not run yet): send as before
    const info = new Map<number, DevRow>();
    for (const r of data as { id: number; dev: string | null; standalone: boolean | null; seen_at: string | null; created_at: string | null }[]) {
      info.set(r.id, { dev: r.dev, standalone: r.standalone, seen: r.seen_at, created: r.created_at });
    }
    return dedupeDevices(jobs, info) as Job[];
  } catch (_e) { return jobs; }
}

/** I-19c / I-30: ride pushes said "Vid nära Taste Of India" (a place made from the GPS). The 0506 SQL no longer writes it; this is the safety net. */
export function tidyRideText(s: string): string {
  // I-30: never a place name made from the GPS ("nära X"): an older database text is cut to the area-free words.
  return String(s ?? "").replace(/\b(Igen: från|Från) nära [^·→]*?(?=\s*(?:→|·|$))/g, (_m, p) => (p === "Från" ? "Hämtning" : "Igen: hämtning"))
    .replace(/\bVid nära [^·→]*?(?=\s*(?:·|$))/g, "").replace(/^\s*·\s*/, "").replace(/(\s·){2,}/g, " ·").replace(/\s*·\s*$/, "");
}

/** I-19d + B2 rows 33-38 (owner default 24 Nov): short ride texts, one idea each, no dialect in system texts. The SQL
 *  (ride_push_claim, 0506) still writes the old words; this maps them at send time (no SQL change needed). */
export function rideTitle(s: string): string {
  const t = String(s ?? "").trim();
  return t.replace(/^(.+) tar dig!$/, "$1 kommer").replace(/^(.+) ä framme$/, "$1 är här").replace(/^(.+) vill ringa dig$/, "$1 vill ringa")
    .replace(/^.+ behöver int' skjuts längre$/, "Skjutsen är avbokad").replace(/^.+ kunde int' köra$/, "Ny förare söks");
}
export function rideBody(s: string): string {
  let b = tidyRideText(s);
  b = b.replace(/\s*→[^·]*?(?=\s·|$)/g, "").replace(/\s*·\s*resa ca [\d,]+ km/g, "");   // offer: from · pax · distance
  b = b.replace(/\s*·\s*Tryck för att följa bilen$/, "").replace(/^Tryck för att följa bilen$/, "På väg.");   // taken
  if (/Kolla att det ä rätt bil$/.test(b)) b = b.replace(/^Vid /, "").replace(/\s*·?\s*Kolla att det ä rätt bil$/, "").trim() + (b.startsWith("Kolla") ? "Kolla bilen." : ". Kolla bilen.");   // arrived
  return b.replace(/^Visa ditt nummer\? Tryck för att svara\.$/, "Visa ditt nummer?").replace(/^Du kan släppa den\. Tack ändå!$/, "Tack ändå!")
    .replace(/^Vi frågar de andra\. Tryck för att se läget\.$/, "Vi frågar de andra.");
}
export function rideAction(t: string): string { return String(t ?? "").replace(/^Kan int'$/, "Kan inte"); }

async function sendAll(admin: Admin, allJobs: Job[], ttl = 3600, raw = false) {
  // v28 (deploy): gate28 (falls back to the v27 gate); raw = digest flush, already paced.
  const v2 = V2.on;   // ntf v2 (0390): v2Load ran at the start of the request / cron
  const g = raw ? { jobs: allJobs, held: 0 } : v2 ? await gateV2(admin, allJobs) : await gate28(admin, allJobs);
  const jobs = await dedupeSend(admin, g.jobs);   // I-19a
  const results = await Promise.allSettled(
    jobs.map((j) =>
      webpush.sendNotification(
        { endpoint: j.sub.endpoint, keys: { p256dh: j.sub.p256dh, auth: j.sub.auth } },
        j.payload,
        { TTL: ttl, urgency: "high" },
      )
    ),
  );
  let sent = 0;
  let failed = 0;
  const deadIds = new Set<number>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
    } else {
      failed++;
      const code = (r.reason as { statusCode?: number } | undefined)?.statusCode;
      if (code === 404 || code === 410) deadIds.add(jobs[i].sub.id);
      else console.error("push failed", code, String(r.reason));
    }
  });
  if (v2) await v2Sent(admin, jobs.filter((_j, i) => results[i].status === "fulfilled"));   // ntf v2: sent per kind + variant
  if (deadIds.size > 0) {
    const { error } = await admin.from("push_subscriptions").delete().in("id", [...deadIds]);
    if (error) console.error("failed to delete dead subscriptions", error);
  }
  return g.held ? { sent, failed, held: g.held } : { sent, failed };
}

// ---- v7 SOCIAL helpers ----

/** Group-mates of uid -> sender name (uid's display_name in a shared group, smallest).
 *  With onlyGroup: only that group. */
async function mateNames(admin: Admin, uid: string, onlyGroup?: string): Promise<Map<string, string>> {
  let q = admin.from("group_members").select("group_id, display_name").eq("user_id", uid);
  if (onlyGroup) q = q.eq("group_id", onlyGroup);
  const { data: mine, error } = await q;
  if (error) throw error;
  const nameFor = new Map<string, string>();
  if ((!mine || mine.length === 0) && onlyGroup) {
    // v29: an event chat (temp group). Recipients + the sender's name come from the invite.
    const { data: ev, error: eErr } = await admin.rpc("evchat_push_mates", { p_gid: onlyGroup, p_uid: uid });
    if (eErr) { console.warn("evchat_push_mates", eErr.message); return nameFor; }
    for (const r of (ev ?? []) as { user_id: string; name: string }[]) nameFor.set(r.user_id, r.name);
    return await dropBlocked(admin, uid, nameFor);   // secaudit 0510
  }
  if (!mine || mine.length === 0) return nameFor;
  const nameByGroup = new Map<string, string>();
  for (const m of mine) nameByGroup.set(m.group_id as string, m.display_name as string);
  const { data: others, error: oErr } = await admin
    .from("group_members").select("group_id, user_id")
    .in("group_id", [...nameByGroup.keys()]).neq("user_id", uid);
  if (oErr) throw oErr;
  for (const o of others ?? []) {
    const name = nameByGroup.get(o.group_id as string);
    if (!name) continue;
    const prev = nameFor.get(o.user_id as string);
    if (prev === undefined || name < prev) nameFor.set(o.user_id as string, name);
  }
  return await dropBlocked(admin, uid, nameFor);   // secaudit 0510
}

// secaudit 0510: no group push (sos with the exact point, come-here, chat text, voice, walk, rally ...) between two people
// when one of them blocked the other (user_blocks.active, both ways). On a read error the push goes as before (logged).
async function dropBlocked(admin: Admin, uid: string, m: Map<string, string>): Promise<Map<string, string>> {
  if (m.size === 0) return m;
  const { data, error } = await admin.from("user_blocks").select("blocker, blocked")
    .eq("active", true).or(`blocker.eq.${uid},blocked.eq.${uid}`);
  if (error) { console.warn("user_blocks", error.message); return m; }
  for (const b of (data ?? []) as { blocker: string; blocked: string }[]) m.delete(b.blocker === uid ? b.blocked : b.blocker);
  return m;
}

async function subsOf(admin: Admin, userIds: string[]): Promise<Sub[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await admin
    .from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", userIds);
  if (error) throw error;
  return (data ?? []) as Sub[];
}

/** Sliding rate limit without removing rows: refuse when a push_sent row of this kind was sent in
 *  the last windowSec, else claim the row for the current time bucket (atomic per bucket). */
async function rateClaim(admin: Admin, uid: string, kind: string, windowSec: number): Promise<boolean> {
  const now = Date.now();
  const { data: recent, error } = await admin
    .from("push_sent").select("kind")
    .eq("user_id", uid).eq("kind", kind)
    .gt("sent_at", new Date(now - windowSec * 1000).toISOString())
    .limit(1);
  if (error) throw error;
  if (recent && recent.length > 0) return false;
  const { data: claimed, error: cErr } = await admin
    .from("push_sent")
    .upsert(
      [{ user_id: uid, kind, night: new Date(bucketStart(now, windowSec)).toISOString(), sent_at: new Date(now).toISOString() }],
      { onConflict: "user_id,kind,night", ignoreDuplicates: true },
    )
    .select("user_id");
  if (cErr) throw cErr;
  return !!claimed && claimed.length > 0;
}

/** v26: the rank value is MERITER (migration 0036 meriter_totals), no longer lifetime beers. */
async function lifetimeTotal(admin: Admin, uid: string): Promise<number> {
  const { data, error } = await admin.from("meriter_totals").select("total").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return Math.max(0, ((data as { total: number } | null)?.total) ?? 0);
}

/** Meriter earned in the last LEVELUP_WINDOW_H hours (live ledger rows only). */
async function recentMeriter(admin: Admin, uid: string): Promise<number> {
  const since = new Date(Date.now() - LEVELUP_WINDOW_H * 3600 * 1000).toISOString();
  const { data, error } = await admin.from("meriter_log").select("pts").eq("user_id", uid).eq("bf", false).gt("created_at", since);
  if (error) throw error;
  return ((data ?? []) as { pts: number }[]).reduce((a, r) => a + (r.pts ?? 0), 0);
}

/** Once per title per user, ever (push_sent kind 'title:<title>', night 2100-01-01). */
async function levelUpJobs(admin: Admin, uid: string, beerId: number, total: number): Promise<Job[]> {
  const t = titleFor(total);
  if (t.at <= 0) return [];
  // Only a rank reached just now (v26: by meriter of the last few hours). Users whose rank changed
  // with the new ladder (backfill), but who did not just pass a step, get no push.
  if (!reachedNow(total, await recentMeriter(admin, uid), t.at)) return [];
  const mates = await mateNames(admin, uid);
  if (mates.size === 0) return [];
  const { data: claimed, error } = await admin
    .from("push_sent")
    .upsert([{ user_id: uid, kind: `title:${t.title}`, night: "2100-01-01T00:00:00Z" }],
      { onConflict: "user_id,kind,night", ignoreDuplicates: true })
    .select("user_id");
  if (error) throw error;
  if (!claimed || claimed.length === 0) return [];
  const idx = Math.floor(Math.random() * LEVELUP_LINES.length);
  return (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(levelUpPayload28(idx, mates.get(s.user_id) ?? "En vän", t.title, beerId, t.next_title)),
  }));
}

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;
const NONE = { sent: 0, failed: 0 };

// {event:"comehere", bar_name?, lat?, lng?}: "come here" to group-mates. Needs a live pin.
// The url points at the caller's pin, so it never shows more than the pin itself shows.
// bar_name is only used when the pin is precise (an approximate pin must not reveal the bar).
async function comeHere(admin: Admin, uid: string, b: Body) {
  const { data: beer, error } = await admin
    .from("beers").select("id, precise, stopped, expires_at")
    .eq("user_id", uid).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  if (!beer || beer.stopped) return { ...NONE, reason: "no_beer" };
  const mates = await mateNames(admin, uid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  if (!(await rateClaim(admin, uid, "comehere", RATE_SEC.comehere))) return { ...NONE, reason: "slow_down" };
  const bar = beer.precise ? cleanBarName(b.bar_name) : "";
  const idx = Math.floor(Math.random() * (bar ? COMEHERE_LINES : COMEHERE_NOBAR_LINES).length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(comeherePayload28(mates.get(s.user_id) ?? "En vän", bar, beer.id as number)),
  }));
  return jobs.length ? await sendAll(admin, jobs) : NONE;
}

// {event:"sos", lat, lng}: high priority push with the exact place, to group-mates only.
async function sos(admin: Admin, uid: string, b: Body) {
  if (!validPt(b.lat, b.lng)) return { ...NONE, reason: "bad_location" };
  const mates = await mateNames(admin, uid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  if (!(await rateClaim(admin, uid, "sos", RATE_SEC.sos))) return { ...NONE, reason: "slow_down" };
  const stamp = Date.now();
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(sosPayload(mates.get(s.user_id) ?? "En vän", b.lat as number, b.lng as number, stamp)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 900) : NONE;
}

// {event:"msg", group_id}: push the caller's newest live message (< 5 min old) in that group.
async function msgPush(admin: Admin, uid: string, b: Body) {
  if (!isUuid(b.group_id)) return { ...NONE, reason: "bad_group" };
  const gid = b.group_id as string;
  const mates = await mateNames(admin, uid, gid); // empty when the caller is not a member
  if (mates.size === 0) {
    const d = await dmPush(admin, uid, gid, "msg"); // v25: a 1:1 DM group
    return d ?? { ...NONE, reason: "no_group" };
  }
  const nowIso = new Date().toISOString();
  const { data: msg, error } = await admin
    .from("group_msgs").select("id, body, created_at")
    .eq("group_id", gid).eq("user_id", uid).gt("expires_at", nowIso)
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!msg) return { ...NONE, reason: "no_msg" };
  if (!(await rateClaim(admin, uid, `msg:${gid}`, RATE_SEC.msg))) return { ...NONE, reason: "slow_down" };
  const { data: g } = await admin.from("groups").select("name").eq("id", gid).maybeSingle();
  // The sender's name is the same for every member of this one group.
  const { data: me } = await admin
    .from("group_members").select("display_name").eq("group_id", gid).eq("user_id", uid).maybeSingle();
  const namn = (me?.display_name as string) ?? mates.values().next().value ?? "Någon";
  const payload = JSON.stringify(msgPayload28(namn, msg.body as string, (g?.name as string) ?? "", gid));
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 600) : NONE;
}

// v27 {event:"coming", beer_id}: "🍺 Kommer!" from a friend-is-out push. To the pin owner only, when the caller
// shares a group with the owner and the pin is live. Once per caller per pin (push_sent kind coming:<beer id>).
async function comingPush(admin: Admin, uid: string, b: Body) {
  const bid = parseRallyId(b.beer_id);
  if (bid === null) return { ...NONE, reason: "no_beer" };
  const { data: beer, error } = await admin
    .from("beers").select("id, user_id, stopped, expires_at")
    .eq("id", bid).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  if (!beer || beer.stopped || beer.user_id === uid) return { ...NONE, reason: "no_beer" };
  const mates = await mateNames(admin, uid);
  const owner = beer.user_id as string;
  if (!mates.has(owner)) return { ...NONE, reason: "no_group" };
  const { data: claimed, error: cErr } = await admin
    .from("push_sent")
    .upsert([{ user_id: uid, kind: `coming:${bid}`, night: beer.expires_at, sent_at: new Date().toISOString() }],
      { onConflict: "user_id,kind,night", ignoreDuplicates: true })
    .select("user_id");
  if (cErr) throw cErr;
  if (!claimed || claimed.length === 0) return { ...NONE, reason: "already_sent" };
  const { count } = await admin.from("push_sent").select("user_id", { count: "exact", head: true })
    .eq("kind", `coming:${bid}`).eq("night", beer.expires_at);
  const idx = Math.floor(Math.random() * COMING_LINES.length);
  const payload = JSON.stringify(comingPayload(idx, mates.get(owner) ?? "En vän", Number(count) || 1, bid));
  const jobs = (await subsOf(admin, [owner])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : { ...NONE, reason: "no_subs" };
}

// ---- v25 💬 MEDDELANDEN (1:1 DM groups, 0136–0138) ----
export const DM_RATE_SEC = 20;
export function dmPayload(namn: string, body: string, gid: string, voice = false) {
  const n = cleanBarName(namn) || "Nån";
  const b = String(body || "").replace(/\s+/g, " ").trim();
  return {
    // owner 13 Nov 17:41 (I-88): the name as the title, the message itself as the text (no "Privat meddelande" line)
    title: voice ? `🎙️ ${n}` : `💬 ${n}`,
    body: voice ? "Röstmeddelande · tryck för att lyssna" : (b.length > 160 ? b.slice(0, 159) + "…" : b) || "Nytt meddelande",
    url: `/?chat=${gid}`,
    tag: `olnu-dm-${gid}`,
    renotify: true,
    stack: { title: `🔒 {n} nya från ${n}`, line: voice ? "🎙️ Röstmeddelande" : (b.length > 90 ? b.slice(0, 89) + "…" : b) },
    actions: voice ? [] : [{ action: "reply", title: "💬 Svara", url: `/?chat=${gid}&reply=1` }],
  };
}
/** null = not a DM group (the caller goes on as before). */
async function dmPush(admin: Admin, uid: string, gid: string, kind: "msg" | "voice") {
  const { data: t, error } = await admin.rpc("dm_push_target", { p_gid: gid, p_uid: uid });
  if (error) { console.warn("dm_push_target", error.message); return null; }
  const d = (t ?? {}) as { dm?: boolean; to?: string[]; name?: string; reason?: string };
  if (!d.dm) return null;
  const to = Array.isArray(d.to) ? d.to.filter(isUuid) : [];
  if (!to.length) return { ...NONE, reason: d.reason || "dm_off" };
  let body = "";
  if (kind === "msg") {
    const { data: msg, error: mErr } = await admin
      .from("group_msgs").select("id, body")
      .eq("group_id", gid).eq("user_id", uid).gt("expires_at", new Date().toISOString())
      .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order("id", { ascending: false }).limit(1).maybeSingle();
    if (mErr) throw mErr;
    if (!msg) return { ...NONE, reason: "no_msg" };
    body = msg.body as string;
  }
  if (!(await rateClaim(admin, uid, `dm:${gid}`, DM_RATE_SEC))) return { ...NONE, reason: "slow_down" };
  const payload = JSON.stringify(dmPayload(d.name || "Nån", body, gid, kind === "voice"));
  const jobs = (await subsOf(admin, to)).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 3600) : { ...NONE, reason: "no_subs" };
}

// ---- v9 INKALLELSE ----

type Rally = {
  id: number; group_id: string; user_id: string; body: string; place: string | null;
  created_at: string; expires_at: string; closed: boolean;
};

/** Live, open rally by id, or null. */
async function loadRally(admin: Admin, rallyId: number): Promise<Rally | null> {
  const { data, error } = await admin
    .from("rallies").select("id, group_id, user_id, body, place, created_at, expires_at, closed")
    .eq("id", rallyId).eq("closed", false).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  return (data as Rally) ?? null;
}

// {event:"rally", rally_id}: the creator calls group-mates of that ONE group. Once per rally.
async function rallyPush(admin: Admin, uid: string, b: Body) {
  const rid = parseRallyId(b.rally_id);
  if (rid === null) return { ...NONE, reason: "no_rally" };
  const r = await loadRally(admin, rid);
  if (!r || r.user_id !== uid || Date.parse(r.created_at) <= Date.now() - 5 * 60 * 1000) {
    return { ...NONE, reason: "no_rally" };
  }
  const mates = await mateNames(admin, uid, r.group_id); // empty when the caller left the group
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const { data: claimed, error } = await admin
    .from("push_sent")
    .upsert([{ user_id: uid, kind: `rally:${r.id}`, night: r.expires_at }],
      { onConflict: "user_id,kind,night", ignoreDuplicates: true })
    .select("user_id");
  if (error) throw error;
  if (!claimed || claimed.length === 0) return { ...NONE, reason: "already_sent" };
  const idx = Math.floor(Math.random() * RALLY_LINES.length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(rallyPayload(idx, mates.get(s.user_id) ?? "En vän", r.body, r.place, r.id)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// {event:"rally_yes", rally_id}: tell the creator that the caller is on the way. Once per answer
// (atomic claim of rally_answers.notified). Never to the caller.
async function rallyYesPush(admin: Admin, uid: string, b: Body) {
  const rid = parseRallyId(b.rally_id);
  if (rid === null) return { ...NONE, reason: "no_rally" };
  const r = await loadRally(admin, rid);
  if (!r) return { ...NONE, reason: "no_rally" };
  if (r.user_id === uid) return { ...NONE, reason: "no_answer" };
  const { data: members, error: mErr } = await admin
    .from("group_members").select("user_id, display_name").eq("group_id", r.group_id);
  if (mErr) throw mErr;
  const nameOf = new Map<string, string>();
  for (const m of members ?? []) nameOf.set(m.user_id as string, m.display_name as string);
  if (!nameOf.has(uid) || !nameOf.has(r.user_id)) return { ...NONE, reason: "no_group" };
  const { data: claimed, error: cErr } = await admin
    .from("rally_answers").update({ notified: true })
    .eq("rally_id", r.id).eq("user_id", uid).eq("answer", "yes").eq("notified", false)
    .select("user_id");
  if (cErr) throw cErr;
  if (!claimed || claimed.length === 0) return { ...NONE, reason: "no_answer" };
  const { data: yesRows, error: yErr } = await admin
    .from("rally_answers").select("user_id").eq("rally_id", r.id).eq("answer", "yes");
  if (yErr) throw yErr;
  const yes = ((yesRows ?? []) as { user_id: string }[]).filter((x) => nameOf.has(x.user_id)).length;
  const idx = Math.floor(Math.random() * RALLY_YES_LINES.length);
  const payload = JSON.stringify(rallyYesPayload(idx, nameOf.get(uid) ?? "En vän", yes, r.id));
  const jobs = (await subsOf(admin, [r.user_id])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// ---- v10 CHECKA IN ----
// {event:"checkin", bar?}: "📍 Anton har anlänt till La Parma" to group-mates. Needs a live check-in
// made in the last 5 min (the bar name comes from that row, not from the body). 1 per 10 min per sender.
async function checkinPush(admin: Admin, uid: string, _b: Body) {
  const { data: ci, error } = await admin
    .from("checkins").select("bar_id, bar_name, created_at, expires_at")
    .eq("user_id", uid).gt("expires_at", new Date().toISOString())
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()).maybeSingle();
  if (error) throw error;
  if (!ci) return { ...NONE, reason: "no_checkin" };
  const mates = await mateNames(admin, uid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  if (!(await rateClaim(admin, uid, "checkin", RATE_SEC.checkin))) return { ...NONE, reason: "slow_down" };
  const bar = cleanBarName(ci.bar_name);
  const idx = Math.floor(Math.random() * CHECKIN_LINES.length);
  const stamp = Date.now();
  // v27: open the bar on tap when the server knows it (bars_lite = bars.json); an unknown bar keeps url "/".
  let barId = "";
  try {
    const { data: bl } = await admin.from("bars_lite").select("id").eq("id", String(ci.bar_id ?? "")).maybeSingle();
    if (bl?.id) barId = String(bl.id);
  } catch (_e) { barId = ""; }
  // v28 (deploy): how many of the caller's group-mates (and the caller) are checked in at this bar now.
  let here = 1;
  try {
    const { count } = await admin.from("checkins").select("user_id", { count: "exact", head: true })
      .eq("bar_id", String(ci.bar_id ?? "")).gt("expires_at", new Date().toISOString()).in("user_id", [uid, ...mates.keys()].slice(0, 300));
    if (typeof count === "number" && count > 0) here = count;
  } catch (_e) { here = 1; }
  const tid = hhmm(Date.parse(String(ci.created_at)) || stamp);
  const faces = V2.on ? await v2Faces(admin, uid, [...mates.keys()]) : new Map<string, string>();   // ntf v2
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(V2.on ? checkinV2(mates.get(s.user_id) ?? "", bar, barId, stamp, here, tid, stamp, faces.get(s.user_id) ?? "")
      : checkinPayload28(idx, mates.get(s.user_id) ?? "En vän", bar, stamp, barId, here, tid)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// Status push to group-mates: "home" (Jag är hemma) or "pause" (öltorsk). Once per kind per night.
async function statusPush(admin: Admin, uid: string, kind: "home" | "pause") {
  const none = { sent: 0, failed: 0, status: 0 };
  const nowIso = new Date().toISOString();
  const { data: beer, error } = await admin
    .from("beers").select("id, expires_at, beer_count, other_count")
    .eq("user_id", uid).gt("expires_at", nowIso).maybeSingle();
  if (error) throw error;
  if (!beer || !(drinksOf(beer) >= 1)) return none;

  const { data: mine, error: mineErr } = await admin
    .from("group_members").select("group_id, display_name").eq("user_id", uid);
  if (mineErr) throw mineErr;
  if (!mine || mine.length === 0) return none;

  // Claim once per kind per night (anti-spam), only after we know there is a group.
  const { data: claimed, error: cErr } = await admin
    .from("push_sent")
    .upsert([{ user_id: uid, kind, night: beer.expires_at }], { onConflict: "user_id,kind,night", ignoreDuplicates: true })
    .select("user_id");
  if (cErr) throw cErr;
  if (!claimed || claimed.length === 0) return none;

  const nameByGroup = new Map<string, string>();
  for (const m of mine) nameByGroup.set(m.group_id as string, m.display_name as string);
  const { data: others, error: othersErr } = await admin
    .from("group_members").select("group_id, user_id")
    .in("group_id", [...nameByGroup.keys()]).neq("user_id", uid);
  if (othersErr) throw othersErr;
  const nameFor = new Map<string, string>();
  for (const o of others ?? []) {
    const name = nameByGroup.get(o.group_id as string);
    if (!name) continue;
    const prev = nameFor.get(o.user_id as string);
    if (prev === undefined || name < prev) nameFor.set(o.user_id as string, name);
  }
  if (nameFor.size === 0) return none;
  const { data: subs, error: subsErr } = await admin
    .from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", [...nameFor.keys()]);
  if (subsErr) throw subsErr;

  const lines = PAUSE_LINES;
  // v16: home uses HOME_LINES + SAFE_HOME_LINES (some with the time, "hemma kl. 01:32").
  const idx = Math.floor(Math.random() * (kind === "home" ? homeLineCount() : lines.length));
  const stampMs = Date.now();
  const body = kind === "home" ? "Kvällen är slut för den här soldaten." : "Pinnen är borta från kartan.";
  const jobs: Job[] = ((subs ?? []) as Sub[]).map((s) => ({
    sub: s,
    payload: JSON.stringify({
      title: kind === "home" ? homeTitle(idx, nameFor.get(s.user_id) ?? "En vän", stampMs)
        : fill(lines[idx], { namn: nameFor.get(s.user_id) ?? "En vän" }),
      body, url: "/", tag: `olnu-${beer.id}-${kind}`,
    }),
  }));
  if (jobs.length === 0) return none;
  const r = await sendAll(admin, jobs);
  return { ...r, status: jobs.length };
}

// ---- v12 KROGARNA ----
// {event:"tip", tip_id}: "📣 Anton tipsar: Kom till Pitchers!" to the other members of the tip's group.
// The tip row (send_tip RPC) must be the caller's, < 5 min old and not pushed yet (atomic claim).
// The RPC already limits tips to 1 per 5 min per user.
async function tipPush(admin: Admin, uid: string, b: Body) {
  const tid = parseRallyId(b.tip_id);
  if (tid === null) return { ...NONE, reason: "no_tip" };
  const { data: claimed, error } = await admin
    .from("bar_tips").update({ notified: true })
    .eq("id", tid).eq("user_id", uid).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .select("id, group_id, bar_id, bar_name, body");
  if (error) throw error;
  const tip = claimed && claimed[0];
  if (!tip) return { ...NONE, reason: "no_tip" };
  const mates = await mateNames(admin, uid, tip.group_id as string);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const idx = Math.floor(Math.random() * TIP_LINES.length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(tipPayload(idx, mates.get(s.user_id) ?? "En vän", tip.bar_name as string,
      tip.body as string | null, tip.bar_id as string, tip.id as number)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// {event:"takeover", bar_id}: "🏰 Ni har tagit över La Parma!" to the other members of the caller's group
// that owns the bar tonight. Needs a bar_takeovers row (note_takeover RPC) of tonight, < 10 min old,
// not pushed yet: so max 1 push per bar per group per night (atomic claim of `notified`).
async function takeoverPush(admin: Admin, uid: string, b: Body) {
  const barId = typeof b.bar_id === "string" ? b.bar_id.trim().slice(0, 80) : "";
  if (!barId) return { ...NONE, reason: "no_takeover" };
  const { data: mine, error: mErr } = await admin.from("group_members").select("group_id").eq("user_id", uid);
  if (mErr) throw mErr;
  const gids = (mine ?? []).map((m: { group_id: string }) => m.group_id);
  if (gids.length === 0) return { ...NONE, reason: "no_group" };
  const { data: claimed, error } = await admin
    .from("bar_takeovers").update({ notified: true })
    .eq("bar_id", barId).in("group_id", gids).eq("notified", false)
    .gt("night", new Date().toISOString())
    .gt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .select("id, group_id, bar_id, bar_name, n");
  if (error) throw error;
  if (!claimed || claimed.length === 0) return { ...NONE, reason: "already_sent" };
  let sent = 0, failed = 0;
  for (const t of claimed) {
    const mates = await mateNames(admin, uid, t.group_id as string);
    if (mates.size === 0) continue;
    const { data: g } = await admin.from("groups").select("name").eq("id", t.group_id).maybeSingle();
    const idx = Math.floor(Math.random() * TAKEOVER_LINES.length);
    const payload = JSON.stringify(takeoverPayload28(idx, (g?.name as string) ?? "", (t.bar_name as string) ?? "",
      t.bar_id as string, t.group_id as string, Number(t.n) || 0));
    const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({ sub: s, payload }));
    if (jobs.length) { const r = await sendAll(admin, jobs, 1800); sent += r.sent; failed += r.failed; }
  }
  return { sent, failed };
}

// ---- v16 EFTERÅT ----
// {event:"medevac_check", check_id}: "🚑 Lisa kollar på Oskar" to group-mates of the checker who also share a
// group with the target, plus the target ("💚 Lisa kommer och kollar läget med dig"). Once per check
// (atomic medevac_checks.notified claim, row < 5 min old, caller = checker); else reason no_check.
async function medcheckPush(admin: Admin, uid: string, b: Body) {
  const cid = parseRallyId(b.check_id);
  if (cid === null) return { ...NONE, reason: "no_check" };
  const { data: claimed, error } = await admin
    .from("medevac_checks").update({ notified: true })
    .eq("id", cid).eq("checker", uid).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .select("id, target, night");
  if (error) throw error;
  const row = claimed && claimed[0];
  if (!row) return { ...NONE, reason: "no_check" };
  const target = row.target as string;
  const mates = await mateNames(admin, uid);              // recipient -> checker's name
  const tNames = await mateNames(admin, target);          // recipient -> target's name
  const { data: beer } = await admin.from("beers").select("id").eq("user_id", target)
    .eq("expires_at", row.night).maybeSingle();
  const beerId = (beer?.id as number) ?? null;
  const ids = [...mates.keys()].filter((u) => u === target || tNames.has(u));
  if (ids.length === 0) return { ...NONE, reason: "no_group" };
  const idx = Math.floor(Math.random() * 1000);
  const jobs = (await subsOf(admin, ids)).map((s) => ({
    sub: s,
    payload: JSON.stringify(medcheckPayload(idx, mates.get(s.user_id) ?? "En vän",
      s.user_id === target ? null : (tNames.get(s.user_id) ?? null), beerId, cid)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// {event:"voice", voice_id}: "🎙️ Anton skickade ett röstskål" to the other members of that group.
// The voice row must be the caller's, < 5 min old, not pushed (atomic claim); max 1 push per sender per group
// per 2 min (push_sent kind voice:<group>). Reasons: no_voice, no_group, slow_down.
async function voicePush(admin: Admin, uid: string, b: Body) {
  const vid = parseRallyId(b.voice_id);
  if (vid === null) return { ...NONE, reason: "no_voice" };
  const { data: claimed, error } = await admin
    .from("voice_msgs").update({ notified: true })
    .eq("id", vid).eq("user_id", uid).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .select("id, group_id");
  if (error) throw error;
  const v = claimed && claimed[0];
  if (!v) return { ...NONE, reason: "no_voice" };
  const gid = v.group_id as string;
  const mates = await mateNames(admin, uid, gid);
  if (mates.size === 0) {
    const d = await dmPush(admin, uid, gid, "voice"); // v25: a 1:1 DM group
    return d ?? { ...NONE, reason: "no_group" };
  }
  if (!(await rateClaim(admin, uid, `voice:${gid}`, 120))) return { ...NONE, reason: "slow_down" };
  const { data: g } = await admin.from("groups").select("name").eq("id", gid).maybeSingle();
  const idx = Math.floor(Math.random() * VOICE_LINES.length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(voicePayload(idx, mates.get(s.user_id) ?? "En vän", (g?.name as string) ?? "", gid)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// ---- v18 ETA ----
// {event:"eta", eta_id}: "🪖 Anton ä på marsch mot Pitchers. ETA 7 min." to group-mates who are AT the target
// right now, plus the rally creator for a rally ETA. The etas row must be the caller's, live, < 5 min old and
// not pushed (atomic `notified` claim); max 1 ETA push per sender per 10 min (push_sent kind "eta").
// Reasons: no_eta, no_rally, no_group, nobody_there, slow_down.
const lastEtaLine = new Map<string, number>();
async function etaPush(admin: Admin, uid: string, b: Body) {
  const eid = parseRallyId(b.eta_id);
  if (eid === null) return { ...NONE, reason: "no_eta" };
  const nowIso = new Date().toISOString();
  const { data: claimed, error } = await admin
    .from("etas").update({ notified: true })
    .eq("id", eid).eq("user_id", uid).eq("notified", false)
    .is("cancelled_at", null).is("arrived_at", null).gt("expires_at", nowIso)
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .select("id, group_id, bar_id, bar_name, lat, lng, rally_id, eta_at");
  if (error) throw error;
  const e = claimed && claimed[0];
  if (!e) return { ...NONE, reason: "no_eta" };
  const mates = await mateNames(admin, uid, (e.group_id as string) || undefined);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const ids = [...mates.keys()];
  let rallyCreator: string | null = null;
  if (e.rally_id) {
    const r = await loadRally(admin, Number(e.rally_id));
    if (!r) return { ...NONE, reason: "no_rally" };   // a rally ETA ends with its rally
    if (r.user_id !== uid) rallyCreator = r.user_id;
  }
  const { data: cis, error: cErr } = await admin
    .from("checkins").select("user_id, bar_id, lat, lng, created_at")
    .in("user_id", ids).gt("expires_at", nowIso)
    .gt("created_at", new Date(Date.now() - 3 * 3600 * 1000).toISOString());
  if (cErr) throw cErr;
  const { data: pins, error: pErr } = await admin
    .from("beers").select("user_id, lat, lng, precise, stopped, ghost, snap_bar")
    .in("user_id", ids).gt("expires_at", nowIso).eq("stopped", false).eq("precise", true);
  if (pErr) throw pErr;
  const rcpt = etaRecipients({
    caller: uid, mates: ids, target: { bar_id: e.bar_id, lat: e.lat, lng: e.lng },
    checkins: (cis ?? []) as EtaCheckin[], pins: (pins ?? []) as EtaPin[], rallyCreator, nowMs: Date.now(),
  });
  if (rcpt.length === 0) return { ...NONE, reason: "nobody_there" };
  if (!(await rateClaim(admin, uid, "eta", RATE_SEC.eta))) return { ...NONE, reason: "slow_down" };
  const min = etaMinsLeft(e.eta_at as string, Date.now());
  const kind = etaKind(min);
  if (lastEtaLine.size > 5000) lastEtaLine.clear();
  const pickFor = new Map<string, [number, number]>();
  for (const rid of rcpt) {
    const key = `${rid}:${kind}`;
    const idx = pickIndex(etaLineCount(kind), lastEtaLine.get(key));
    lastEtaLine.set(key, idx);
    const bkey = `${rid}:body`;
    const bIdx = pickIndex(ETA_BODIES.length, lastEtaLine.get(bkey));
    lastEtaLine.set(bkey, bIdx);
    pickFor.set(rid, [idx, bIdx]);
  }
  const jobs = (await subsOf(admin, rcpt)).map((s) => {
    const [i, bi] = pickFor.get(s.user_id) ?? [0, 0];
    return {
      sub: s,
      payload: JSON.stringify(etaPayload(i, bi, mates.get(s.user_id) ?? "En vän", min, e.bar_name as string,
        e.bar_id as string, e.rally_id ? Number(e.rally_id) : null, e.id as number)),
    };
  });
  if (!jobs.length) return { ...NONE, reason: "nobody_there", recipients: rcpt.length };
  return { ...(await sendAll(admin, jobs, 1800)), recipients: rcpt.length };
}

// ---- v22 GRUPPCHEF ----
// {event:"status_req", req_id}: the chief's lägesrapport to every other member of that ONE group.
// The status_reqs row must be the caller's, < 3 min old and not pushed (atomic `notified` claim).
// Reasons: no_req, no_group.
async function statusReqPush(admin: Admin, uid: string, b: Body) {
  const rid = parseRallyId(b.req_id);
  if (rid === null) return { ...NONE, reason: "no_req" };
  const { data: claimed, error } = await admin
    .from("status_reqs").update({ notified: true })
    .eq("id", rid).eq("user_id", uid).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 3 * 60 * 1000).toISOString())
    .select("id, group_id");
  if (error) throw error;
  const r = claimed && claimed[0];
  if (!r) return { ...NONE, reason: "no_req" };
  const gid = r.group_id as string;
  const mates = await mateNames(admin, uid, gid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const { data: g } = await admin.from("groups").select("name").eq("id", gid).maybeSingle();
  const idx = Math.floor(Math.random() * STATUS_LINES.length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(statusReqPayload(idx, mates.get(s.user_id) ?? "Gruppchefen", (g?.name as string) ?? "", rid)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 600) : NONE;
}

// ---- v27 HELGSTREAK ----
// {event:"helg_remind"}: group-mates of the caller whose weekend streak would break (streak > 0, no freeze pass
// left, not out yet this week). Friday 17:00-23:59 Europe/Stockholm only; max 1 per recipient per week (claimed in
// push_sent kind 'helg' by the SQL function helg_remind_targets). Reason when nobody: no_target.
// E2 / B1 (owner default 24 Nov; product report: "switch off the helg-streak push"): streak pressure pushes drinking.
// Off for every client (old apps still call {event:"helg_remind"} on Fridays). Set true again only on an owner decision.
export const HELG_PUSH_ON = false;
async function helgRemindPush(admin: Admin, uid: string) {
  if (!HELG_PUSH_ON) return { ...NONE, reason: "off" };
  if (V2.on) return { ...NONE, reason: "v2_off" };   // ntf v2: no personal "streak at risk" push (gang streak celebrates instead)
  const { data, error } = await admin.rpc("helg_remind_targets", { p_caller: uid });
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []) as { user_id: string; streak: number }[];
  if (rows.length === 0) return { ...NONE, reason: "no_target" };
  const streakOf = new Map(rows.map((r) => [r.user_id, Number(r.streak) || 1]));
  const week = new Date().toISOString().slice(0, 10);
  const idx = Math.floor(Math.random() * HELG_LINES.length);
  const jobs = (await subsOf(admin, [...streakOf.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(helgRemindPayload(idx, streakOf.get(s.user_id) ?? 1, week)),
  }));
  return jobs.length ? { ...(await sendAll(admin, jobs, 6 * 3600)), recipients: rows.length } : { ...NONE, recipients: rows.length };
}

// ---- v27 SKÅLTIMMEN ----
// {event:"skal_hour", hour_id}: the skåltimme to every other member of that ONE group. The skal_hours row must be
// fired by the caller (the starter, or the member whose poll fired the random one), < 3 min old and not pushed
// (atomic `notified` claim). Reasons: no_hour, no_group.
async function skalHourPush(admin: Admin, uid: string, b: Body) {
  const hid = parseRallyId(b.hour_id);
  if (hid === null) return { ...NONE, reason: "no_hour" };
  const { data: claimed, error } = await admin
    .from("skal_hours").update({ notified: true })
    .eq("id", hid).eq("fired_by", uid).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 3 * 60 * 1000).toISOString())
    .select("id, group_id, started_by, auto");
  if (error) throw error;
  const h = claimed && claimed[0];
  if (!h) return { ...NONE, reason: "no_hour" };
  const gid = h.group_id as string;
  const mates = await mateNames(admin, uid, gid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const { data: g } = await admin.from("groups").select("name").eq("id", gid).maybeSingle();
  // bold §1.7 Skåltimmen v2: {v2:true} + flag bold_skal_v2 → only bold_skal_targets (out tonight, 90-min cap), new copy.
  if (b.v2 === true && V2.bold.skal) {
    const { data: tg, error: tgErr } = await admin.rpc("bold_skal_targets", { p_hour_id: hid });
    // bold spec: {v2, user_ids}. v2 false = the old push below. (A plain uuid list is accepted too.)
    const tgo = (tg && typeof tg === "object" && !Array.isArray(tg) ? tg : { v2: true, user_ids: tg }) as { v2?: boolean; user_ids?: unknown };
    if (!tgErr && tgo.v2 !== false) {
      const want = new Set(((Array.isArray(tgo.user_ids) ? tgo.user_ids : []) as unknown[]).map((x) => String(typeof x === "object" && x ? Object.values(x as Record<string, unknown>)[0] : x)));
      const to = [...mates.keys()].filter((u) => want.has(u));
      const payload = JSON.stringify(skalBoldV2((g?.name as string) ?? "", hid));
      const jobs = (await subsOf(admin, to)).map((s) => ({ sub: s, payload }));
      return jobs.length ? await sendAll(admin, jobs, 180) : { ...NONE, reason: "no_target" };
    }
    if (tgErr) console.warn("bold_skal_targets", tgErr.message);   // missing RPC: the old Skåltimme push below
  }
  const idx = Math.floor(Math.random() * SKAL_HOUR_BODIES.length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(V2.on   // ntf v2 (store-safe): a photo of the gang, not of the drink
      ? skalHourV2(h.auto ? "Slumpen" : (mates.get(s.user_id) ?? "Gruppchefen"), (g?.name as string) ?? "", hid)
      : skalHourPayload(idx, h.auto ? "Slumpen" : (mates.get(s.user_id) ?? "Gruppchefen"), (g?.name as string) ?? "", hid)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 180) : NONE;
}

// {event:"film", group_id, night}: "Filmen är framkallad!" to every other member. The film_rolls row must be
// claimed by the caller (film_poll), < 10 min ago, not pushed (atomic `notified` claim). Reasons: no_roll, no_group.
async function filmPush(admin: Admin, uid: string, b: Body) {
  const gid = typeof b.group_id === "string" && /^[0-9a-f-]{36}$/i.test(b.group_id) ? b.group_id : "";
  const night = typeof b.night === "string" && b.night.length <= 40 && !isNaN(Date.parse(b.night)) ? new Date(b.night).toISOString() : "";
  if (!gid || !night) return { ...NONE, reason: "no_roll" };
  const { data: claimed, error } = await admin
    .from("film_rolls").update({ notified: true })
    .eq("group_id", gid).eq("night", night).eq("claimed_by", uid).eq("notified", false)
    .gt("claimed_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .select("group_id");
  if (error) throw error;
  if (!claimed || !claimed[0]) return { ...NONE, reason: "no_roll" };
  const mates = await mateNames(admin, uid, gid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const { data: g } = await admin.from("groups").select("name").eq("id", gid).maybeSingle();
  const { count } = await admin.from("snap_photos").select("id", { count: "exact", head: true })
    .eq("group_id", gid).eq("kind", "film").eq("night", night);
  const idx = Math.floor(Math.random() * FILM_BODIES.length);
  // bold §3.7: the replay is ready too → ONE push: the film push gets "…och kvällsreprisen ä klar ▶" + "▶ Spela".
  let replay = false;
  if (V2.bold.replay) {
    try {
      const { data: rc } = await admin.rpc("replay_ready_claim", { p_group_id: gid, p_night: null, p_via: "film", p_uid: uid });
      replay = !!(rc && (rc as { ok?: boolean }).ok);
    } catch (_e) { replay = false; }
  }
  const filmP = (p: Record<string, unknown>) => replay ? withReplay(p, gid) : p;
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(filmP(V2.on ? filmV2((g?.name as string) ?? "", count ?? 0, gid) : filmPayload(idx, (g?.name as string) ?? "", count ?? 0, gid))),
  }));
  return jobs.length ? await sendAll(admin, jobs, 4 * 3600) : NONE;
}

// 0195 {event:"film_start", group_id}: "📸 Lisa har börjat fota…" to every other member. The film_starts row (trigger on
// the first film shot of the night) must be started by the caller, < 30 min old, not pushed (atomic claim).
// Reasons: no_start, no_group.
async function filmStartPush(admin: Admin, uid: string, b: Body) {
  const gid = typeof b.group_id === "string" && /^[0-9a-f-]{36}$/i.test(b.group_id) ? b.group_id : "";
  if (!gid) return { ...NONE, reason: "no_start" };
  const { data: claimed, error } = await admin
    .from("film_starts").update({ notified: true })
    .eq("group_id", gid).eq("started_by", uid).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .select("group_id");
  if (error) throw error;
  if (!claimed || !claimed[0]) return { ...NONE, reason: "no_start" };
  const mates = await mateNames(admin, uid, gid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const { data: g } = await admin.from("groups").select("name").eq("id", gid).maybeSingle();
  const idx = Math.floor(Math.random() * FILM_START_LINES.length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(filmStartPayload(idx, mates.get(s.user_id) ?? "", (g?.name as string) ?? "", gid)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 3 * 3600) : NONE;
}

// ---- NÄRA: friend request + "Hitta kompisen" (migrations 0045 / 0047) ----
const FRIENDREQ_LINES = [
  "🤝 {namn} vill bli din vän", "🤝 {namn} skickar en vänförfrågan", "🤝 Ny kamrat på ingång: {namn}",
  "🤝 {namn} vill värva dig till sin trupp", "🤝 {namn} föreslår en allians", "🤝 {namn} vill ha dig i vänlistan",
];
const FIND_LINES = [
  "🧭 {namn} letar efter dig i vimlet!", "🧭 {namn} söker din position, soldat", "🧭 Spaning: {namn} vill hitta dig",
  "🧭 {namn} ä vilse i folkhavet och letar efter dig", "🧭 {namn} har kompassen fram – var ä du?", "🧭 {namn} vill hitta dig. Svara nu!",
  "🧭 Radion sprakar: {namn} söker kontakt", "🧭 {namn} försöker hitta dig i trängseln",
  "👀 {namn} letar efter dig", "👀 {namn} letar efter dig – var ä du?",
];
async function nameOf(admin: Admin, uid: string, groupId?: string | null): Promise<string> {
  if (groupId) {
    const { data } = await admin.from("group_members").select("display_name").eq("group_id", groupId).eq("user_id", uid).maybeSingle();
    if (data?.display_name) return data.display_name as string;
  }
  const { data: un } = await admin.from("user_names").select("name").eq("user_id", uid).maybeSingle();
  if (un?.name) return un.name as string;
  const { data: gm } = await admin.from("group_members").select("display_name").eq("user_id", uid).order("display_name").limit(1);
  return (gm && gm[0]?.display_name as string) || "En kompis";
}
async function friendPush(admin: Admin, uid: string, b: Body) {
  const fid = parseRallyId((b as Record<string, unknown>).friend_id);
  if (fid === null) return { ...NONE, reason: "no_friend" };
  const { data: claimed, error } = await admin
    .from("friendships").update({ notified: true })
    .eq("id", fid).eq("requester", uid).eq("status", "pending").eq("notified", false)
    .gt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .select("id, a, b");
  if (error) throw error;
  const f = claimed && claimed[0];
  if (!f) return { ...NONE, reason: "no_friend" };
  if (!(await rateClaim(admin, uid, "friend", 20))) return { ...NONE, reason: "slow_down" };
  const to = (f.a === uid ? f.b : f.a) as string;
  const namn = cleanBarName(await nameOf(admin, uid)) || "En kompis";
  const line = FRIENDREQ_LINES[Math.floor(Math.random() * FRIENDREQ_LINES.length)];
  const payload = JSON.stringify({ title: fill(line, { namn }), body: "Tryck för att svara.", url: "/?friends=1", tag: `olnu-friend-${fid}` });
  const jobs = (await subsOf(admin, [to])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 3600) : NONE;
}
async function findPush(admin: Admin, uid: string, b: Body) {
  const rid = parseRallyId(b.req_id);
  if (rid === null) return { ...NONE, reason: "no_find" };
  const { data: claimed, error } = await admin
    .from("find_reqs").update({ notified: true })
    .eq("id", rid).eq("from_uid", uid).eq("notified", false).in("status", ["pending", "auto"])
    .gt("created_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
    .select("id, to_uid, group_id, status");
  if (error) throw error;
  const r = claimed && claimed[0];
  if (!r) return { ...NONE, reason: "no_find" };
  if (!(await rateClaim(admin, uid, "find", 30))) return { ...NONE, reason: "slow_down" };
  const namn = cleanBarName(await nameOf(admin, uid, r.group_id as string | null)) || "En kompis";
  const line = FIND_LINES[Math.floor(Math.random() * FIND_LINES.length)];
  const body = r.status === "auto" ? "Tryck och öppna kompassen så hittar ni varann." : "Tryck för att svara – frågan gäller i 5 min.";
  const payload = JSON.stringify({ title: fill(line, { namn }), body, url: `/?find=${rid}`, tag: `olnu-find-${rid}` });
  const jobs = (await subsOf(admin, [r.to_uid as string])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 300) : NONE;
}

// ---- v26 🏠 FÖLJ MIG HEM (0141): {event:"walk"|"walk_home", walk_id} ----
export const WALK_LINES: string[] = [
  "{namn} går hem",
];
export const WALK_HOME_LINES: string[] = [
  "{namn} är hemma",
];
async function walkPush(admin: Admin, uid: string, b: Body, home: boolean) {
  const wid = parseRallyId(b.walk_id);
  if (wid === null) return { ...NONE, reason: "no_walk" };
  const since = new Date(Date.now() - (home ? 10 : 5) * 60 * 1000).toISOString();
  let q = admin.from("walks").update(home ? { home_notified: true } : { notified: true })
    .eq("id", wid).eq("user_id", uid);
  q = home
    ? q.eq("home_notified", false).eq("end_reason", "home").gt("ended_at", since)
    : q.eq("notified", false).is("ended_at", null).gt("started_at", since);
  const { data: claimed, error } = await q.select("id, viewers, group_id");
  if (error) throw error;
  const w = claimed && claimed[0];
  if (!w) return { ...NONE, reason: "no_walk" };
  const to = ((w.viewers ?? []) as string[]).filter((x) => x && x !== uid).slice(0, 30);
  if (!to.length) return { ...NONE, reason: "no_viewers" };
  const namn = cleanBarName(await nameOf(admin, uid, w.group_id as string | null)) || "En kompis";
  const lines = home ? WALK_HOME_LINES : WALK_LINES;
  const line = lines[Math.floor(Math.random() * lines.length)];
  const body = home ? "Hen kom fram." : "Hen delar sin position tills hen är hemma (max 2 h).";
  const payload = JSON.stringify({ title: fill(line, { namn }), body, url: `/?walk=${wid}`, tag: `olnu-walk-${wid}` });
  const jobs = (await subsOf(admin, to)).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, home ? 3600 : 1800) : NONE;
}

// ---- v28 INBJUDNINGAR (0080/0081): {event:"invite"|"invite_yes"|"invite_due", invite_id} + the cron ----
// invite     : the caller's new invitees (atomic notified claim) -> "📨 TuNe har bjudit in dig: Pubquiz på Pitchers, tors 22/10 19:00"
// invite_yes : the creator, max 1 per 10 min per invite (yes_push_at claim); later yeses ride along in the next one
// invite_due : "⏰ Om 1 timme: Pubquiz på Pitchers – 3 kommer" to yes + maybe, once per invite (reminded_at claim)
// Cron: GitHub Actions (.github/workflows/reminders.yml, every 10 min) POSTs {event:"invite_due"} with the public anon
// JWT (gateway verify_jwt) and header x-olnu-cron: <service key>. The key is checked by calling the service-role-only
// RPC invite_due_claim with it (apikey header only; Bearer only for a legacy JWT key). Wrong key -> 403, nothing sent.
const INV_TZ = "Europe/Stockholm";
const INV_DAYS = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];
function invParts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("sv-SE", { timeZone: INV_TZ, year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hm: `${p.hour}:${p.minute}` };
}
/** "ikväll 19:00" (same evening), else "tors 22/10 19:00" (Europe/Stockholm). */
export function invWhen(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const a = invParts(t), eve = invParts(t - 5 * 3600e3), now = invParts(nowMs - 5 * 3600e3);
  if (eve.y === now.y && eve.m === now.m && eve.d === now.d && t > nowMs - 6 * 3600e3) return `ikväll ${a.hm}`;
  const wd = INV_DAYS[new Date(Date.UTC(a.y, a.m - 1, a.d)).getUTCDay()];
  return `${wd} ${a.d}/${a.m} ${a.hm}`;
}
export const INVITE_LINES: string[] = [
  "📨 {namn} har bjudit in dig: {titel}, {nar}",
  "📨 {namn} har bjudit in dig: {titel}, {nar}",
  "📨 Inbjudan från {namn}: {titel}, {nar}",
  "📨 {namn} vill ha med dig: {titel}, {nar}",
  "📨 Order från {namn}: {titel}, {nar}. Uppställning!",
  "📨 {namn} kallar dig till {titel}, {nar}",
];
export function invYesTitle(names: string[], titel: string): string {
  const n = names.filter(Boolean);
  const who = n.length <= 1 ? (n[0] || "Någon") : n.length === 2 ? `${n[0]} och ${n[1]}` : `${n[0]}, ${n[1]} +${n.length - 2}`;
  return `✅ ${who} kommer på ${titel}`;
}
function invTtl(startsAt: string): number {
  const s = (Date.parse(startsAt) - Date.now()) / 1000;
  return Math.max(900, Math.min(86400, Number.isFinite(s) ? Math.round(s) : 3600));
}
async function invIsIn(admin: Admin, id: number, uid: string): Promise<boolean> {
  const { data } = await admin.from("invite_people").select("user_id").eq("invite_id", id).eq("user_id", uid).limit(1);
  return !!(data && data.length);
}
async function invitePush(admin: Admin, uid: string, b: Body) {
  const id = parseRallyId(b.invite_id);
  if (id === null) return { ...NONE, reason: "no_invite" };
  const { data, error } = await admin.rpc("invite_push_claim", { p_id: id, p_uid: uid });
  if (error) throw error;
  const d = data as { title: string; place?: string; starts_at: string; from_name: string; to: string[] } | null;
  if (!d || !Array.isArray(d.to) || !d.to.length) return { ...NONE, reason: "no_invite" };
  const namn = cleanBarName(d.from_name) || "En kompis";
  const titel = cleanBarName(d.title) || "Öl";
  const line = INVITE_LINES[Math.floor(Math.random() * INVITE_LINES.length)];
  const payload = JSON.stringify({ title: fill(line, { namn, titel, nar: invWhen(d.starts_at) }),
    body: "Svara: ✅ Kommer · 🤔 Kanske · ❌ Kan inte", url: `/?inv=${id}`, tag: `olnu-inv-${id}`,
    actions: [{ action: "yes", title: "✅ Kommer" }, { action: "no", title: "❌ Kan inte" }] });
  const jobs = (await subsOf(admin, d.to)).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, invTtl(d.starts_at)) : NONE;
}
async function inviteYesSend(admin: Admin, id: number) {
  const { data, error } = await admin.rpc("invite_yes_claim", { p_id: id });
  if (error) throw error;
  const d = data as { title: string; starts_at: string; creator: string; names: string[]; yes: number } | null;
  if (!d || !d.creator || !(d.names || []).length) return { ...NONE, reason: "batched" };
  const titel = cleanBarName(d.title) || "Öl";
  const payload = JSON.stringify({ title: invYesTitle((d.names || []).map((x) => cleanBarName(x)), titel),
    body: `${d.yes} kommer totalt · ${invWhen(d.starts_at)}`, url: `/?inv=${id}`, tag: `olnu-inv-yes-${id}` });
  const jobs = (await subsOf(admin, [d.creator])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, invTtl(d.starts_at)) : NONE;
}
async function inviteYesPush(admin: Admin, uid: string, b: Body) {
  const id = parseRallyId(b.invite_id);
  if (id === null || !(await invIsIn(admin, id, uid))) return { ...NONE, reason: "no_invite" };
  return await inviteYesSend(admin, id);
}
type DueRow = { id: number; title: string; place?: string; starts_at: string; yes: number; maybe: number; to: string[] };
async function dueSend(admin: Admin, rows: DueRow[]) {
  const jobs: Job[] = [];
  for (const r of rows || []) {
    if (!r || !Array.isArray(r.to) || !r.to.length) continue;
    const titel = cleanBarName(r.title) || "Öl";
    const payload = JSON.stringify({ title: `⏰ Om 1 timme: ${titel} – ${r.yes} kommer`,
      body: `${invWhen(r.starts_at)}${r.maybe ? ` · ${r.maybe} kanske` : ""}. Tryck för vägen dit.`,
      url: `/?inv=${r.id}`, tag: `olnu-inv-due-${r.id}` });
    for (const s of await subsOf(admin, r.to)) jobs.push({ sub: s, payload });
  }
  return jobs.length ? await sendAll(admin, jobs, 3600) : NONE;
}
async function inviteDuePush(admin: Admin, uid: string, b: Body) {
  const id = parseRallyId(b.invite_id);
  if (id === null) return { ...NONE, reason: "no_invite" };
  const { data, error } = await admin.rpc("invite_due_claim", { p_id: id, p_uid: uid });
  if (error) throw error;
  const rows = (data || []) as DueRow[];
  if (!rows.length) return { ...NONE, reason: "not_due" };
  return await dueSend(admin, rows);
}
// ---- v24 📅 GÅR (0127/0128): "⏰ Om 1 timme" for people who tapped Går on a 📅 event ----
export const EVGO_TITLES: string[] = [
  "⏰ Om 1 timme: {titel}",
  "⏰ En timme kvar till {titel}",
  "⏰ T-minus 60 min: {titel}",
  "⏰ Gör dig redo – {titel} om en timme",
  "⏰ Klockan tickar: {titel} om 1 tim",
  "⏰ Uppställning om en timme: {titel}",
];
type EvDueRow = { event_id: number; title: string; place?: string | null; starts_at: string; tv?: boolean; total?: number; to: string[] };
async function evDueSend(admin: Admin, rows: EvDueRow[]) {
  const jobs: Job[] = [];
  for (const r of rows || []) {
    if (!r || !Array.isArray(r.to) || !r.to.length) continue;
    const titel = cleanBarName(r.title) || "Event";
    const place = r.tv ? "📺 på TV" : cleanBarName(r.place);
    const n = Number(r.total) || 0;
    const line = EVGO_TITLES[Math.floor(Math.random() * EVGO_TITLES.length)];
    const payload = JSON.stringify(V2.on   // ntf v2: "Hockey 19:00 ⏰" + how many go
      ? eventDueV2(titel, invParts(Date.parse(r.starts_at)).hm, place, n, r.event_id)
      : { title: fill(line, { titel }),
        body: `${invWhen(r.starts_at)}${place ? ` · ${place}` : ""}${n > 1 ? ` · ${n} går` : ""}. Tryck för detaljer.`,
        url: `/?evs=${r.event_id}`, tag: `olnu-evgo-${r.event_id}` });
    for (const s of await subsOf(admin, r.to)) jobs.push({ sub: s, payload });
  }
  return jobs.length ? await sendAll(admin, jobs, 3600) : NONE;
}
async function evDuePush(admin: Admin, uid: string, _b: Body) {
  const { data, error } = await admin.rpc("ev_going_due_claim", { p_uid: uid });
  if (error) throw error;
  const rows = (data || []) as EvDueRow[];
  if (!rows.length) return { ...NONE, reason: "not_due" };
  return await evDueSend(admin, rows);
}
// ---- feat 0250 🆘 HÄMTA MIG · 🚗 SKJUTS? · ⏰ BAREN STÄNGER ----
// {event:"pickup", req_id}: the caller's new request (atomic notified claim, < 5 min old, live) -> the people it went to.
//   hamta  -> "🆘 Anton: Kan nån hämta mig?" (tag olnu-pickup-<id> = kind "safe": always sent, like SOS / Följ mig hem)
//   skjuts -> "🚗 Anton undrar: Skjuts?" to the one driver (tag olnu-ride-<id> = kind "plan": push_prefs + nattro apply)
// {event:"pickup_yes", req_id}: the caller answered "kommer" (pickup_answers.notified claim) -> "🙋 Lisa kommer och hämtar dig!"
// Cron: close_remind_claim() -> "⏰ Pitchers stänger om 20 min. Dags att planera hemfärden 🚕" (tag olnu-close-<bar> = "plan").
export const CLOSE_LINES: string[] = [
  "{bar} stänger om {min} min",
];
export const CLOSE_BODIES: string[] = [
  "Dags att tänka på hemvägen.",
];
async function pickupPush(admin: Admin, uid: string, b: Body) {
  const id = parseRallyId(b.req_id);
  if (id === null) return { ...NONE, reason: "no_req" };
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: claimed, error } = await admin.from("pickup_reqs").update({ notified: true })
    .eq("id", id).eq("user_id", uid).eq("notified", false).is("ended_at", null).gt("created_at", since)
    .select("id, kind, to_users, group_id");
  if (error) throw error;
  const r = claimed && claimed[0];
  if (!r) return { ...NONE, reason: "no_req" };
  const to = ((r.to_users ?? []) as string[]).filter((x) => x && x !== uid).slice(0, 30);
  if (!to.length) return { ...NONE, reason: "no_viewers" };
  const namn = cleanBarName(await nameOf(admin, uid, r.group_id as string | null)) || "En kompis";
  const payload = JSON.stringify(r.kind === "skjuts"
    ? { title: `${namn} undrar: skjuts?`, body: "Tryck för att svara.", url: `/?pickup=${id}`, tag: `olnu-ride-${id}` }
    : { title: `${namn} vill ha skjuts`, body: "Tryck för att svara.", url: `/?pickup=${id}`, tag: `olnu-pickup-${id}`, renotify: true });
  const jobs = (await subsOf(admin, to)).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 3600) : NONE;
}
async function pickupYesPush(admin: Admin, uid: string, b: Body) {
  const id = parseRallyId(b.req_id);
  if (id === null) return { ...NONE, reason: "no_req" };
  const { data: claimed, error } = await admin.from("pickup_answers").update({ notified: true })
    .eq("req_id", id).eq("user_id", uid).eq("ans", "kommer").eq("notified", false).select("req_id");
  if (error) throw error;
  if (!claimed || !claimed.length) return { ...NONE, reason: "already_sent" };
  const { data: r, error: rErr } = await admin.from("pickup_reqs").select("id, user_id, kind, group_id, ended_at").eq("id", id).maybeSingle();
  if (rErr) throw rErr;
  if (!r || r.ended_at) return { ...NONE, reason: "no_req" };
  const namn = cleanBarName(await nameOf(admin, uid, r.group_id as string | null)) || "En kompis";
  const payload = JSON.stringify({ title: `${namn} kommer`,
    body: r.kind === "skjuts" ? "Hen kör dig." : "Hen hämtar dig.", url: `/?pickup=${id}`, tag: `olnu-pickup-${id}`, renotify: true });
  const jobs = (await subsOf(admin, [r.user_id as string])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}
// ---- lane ride (F1, migration 0420) 🚕 RIDE v2 — block start ----
// {event:"pickup", req_id, ride:1}: the app sends this after every ride change (request, take, Framme, cancel, Fråga igen /
// fler). ride_push_claim(uid, req) (service_role) returns each due push ONCE (ride_push_log): the offer to the drivers
// ("Lisa behöver skjuts" · "Från Pitchers · 2 pers · 1,2 km", Android buttons Jag tar den / Kan int'), "Oskar tar dig!",
// "Oskar ä framme", "Lisa behöver int' skjuts längre", "Oskar kunde int' köra". Tag olnu-pickup-<id> = kind "safe":
// outside the night budget, never paced, prio 100. iOS cannot update a sent push, so nothing here tries to.
// A database without 0420 (PGRST202 / 42883) = no push (the old pickup push already went out for the first call).
type RideJob = { to: string; title: string; body: string; url: string; tag: string; requireInteraction?: boolean;
  actions?: { action: string; title: string; url?: string }[] };
async function ridePush(admin: Admin, uid: string, b: Body) {
  const id = parseRallyId(b.req_id);
  if (id === null) return { ...NONE, reason: "no_req" };
  const { data, error } = await admin.rpc("ride_push_claim", { p_uid: uid, p_req: id });
  if (error) {
    if (/PGRST202|42883|does not exist|Could not find the function/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) return await pickupPush(admin, uid, b);
    throw error;
  }
  const rows = (Array.isArray(data) ? data : []) as RideJob[];
  const jobs: Job[] = [];
  for (const r of rows) {
    if (!r || !r.to || !isUuid(r.to)) continue;
    const payload = JSON.stringify({ title: rideTitle(r.title), body: rideBody(r.body), url: r.url, tag: r.tag, requireInteraction: !!r.requireInteraction,
      actions: Array.isArray(r.actions) ? r.actions.slice(0, 2).map((a) => ({ ...a, title: rideAction(a.title) })) : undefined, renotify: true, k: "safe", v: "ride.1", ts: Date.now() });
    for (const s of await subsOf(admin, [r.to])) jobs.push({ sub: s, payload });
  }
  return jobs.length ? await sendAll(admin, jobs, 1800) : { ...NONE, reason: rows.length ? "no_subs" : "nothing_due" };
}
// ---- lane ride — block end ----
type CloseRow = { to: string; bar_id: string; bar_name?: string | null; min: number };
async function closeSend(admin: Admin, rows: CloseRow[]) {
  const jobs: Job[] = [];
  for (const r of rows || []) {
    if (!r || !r.to) continue;
    const bar = cleanBarName(r.bar_name) || "Krogen";
    const line = CLOSE_LINES[Math.floor(Math.random() * CLOSE_LINES.length)];
    const payload = JSON.stringify({ title: fill(line, { bar, min: Math.max(1, Number(r.min) || 1) }),
      body: CLOSE_BODIES[Math.floor(Math.random() * CLOSE_BODIES.length)], url: "/?hemfard=1",
      tag: `olnu-close-${String(r.bar_id || "").replace(/[^\w-]/g, "").slice(0, 40)}` });
    for (const s of await subsOf(admin, [r.to])) jobs.push({ sub: s, payload });
  }
  return jobs.length ? await sendAll(admin, jobs, 1200) : NONE;
}
async function keyRpc(key: string, name: string, body: unknown) {
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (/^eyJ/.test(key)) headers.Authorization = "Bearer " + key;
  const r = await fetch(SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + name, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  let data: unknown = null;
  try { data = await r.json(); } catch (_e) { data = null; }
  return { ok: r.ok, status: r.status, data };
}
// ---- gw (0310-0313) runtime ----
type GwWalkRow = { walk_id: number; stage: string; user_id: string; viewers: string[] | null; name: string | null;
  due_at: string | null; last_lat: number | null; last_lng: number | null; last_at: string | null };
async function gwWalkSend(admin: Admin, rows: GwWalkRow[]) {
  const jobs: Job[] = [];
  for (const r of rows.slice(0, 100)) {
    const id = Number(r.walk_id);
    if (!Number.isFinite(id)) continue;
    if (r.stage === "remind") {
      const payload = JSON.stringify(walkRemindPayload(id));
      for (const s of await subsOf(admin, [r.user_id])) jobs.push({ sub: s, payload });
    } else if (r.stage === "alert") {
      const to = ((r.viewers ?? []) as string[]).filter((x) => isUuid(x) && x !== r.user_id).slice(0, 30);
      const payload = JSON.stringify(walkAlertPayload(r.name || "", id, Date.parse(String(r.due_at)), Date.parse(String(r.last_at))));
      for (const s of await subsOf(admin, to)) jobs.push({ sub: s, payload });
    }
  }
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}
/** {event:"walk_check", walk_id}: the caller (walker or viewer) saw a stage move in walk_timer_tick. */
async function gwWalkCheck(admin: Admin, uid: string, b: Body) {
  const wid = parseRallyId(b.walk_id);
  if (wid === null) return { ...NONE, reason: "no_walk" };
  const { data: w, error } = await admin.from("walks").select("user_id, viewers").eq("id", wid).maybeSingle();
  if (error) throw error;
  if (!w || (w.user_id !== uid && !((w.viewers ?? []) as string[]).includes(uid))) return { ...NONE, reason: "no_walk" };
  const { data, error: cErr } = await admin.rpc("walk_timer_push_claim", { p_walk_id: wid });
  if (cErr) { console.warn("walk_timer_push_claim", cErr.message); return { ...NONE, reason: "no_timer" }; }
  const rows = (Array.isArray(data) ? data : []) as GwWalkRow[];
  return rows.length ? await gwWalkSend(admin, rows) : { ...NONE, reason: "nothing_due" };
}
/** {event:"knuff", knuff_id}: one push per knuff (knuff_push_claim checks the sender and the 5 min window). */
async function gwKnuff(admin: Admin, uid: string, b: Body) {
  const id = parseRallyId(b.knuff_id);
  if (id === null) return { ...NONE, reason: "no_knuff" };
  const { data, error } = await admin.rpc("knuff_push_claim", { p_id: id, p_from: uid });
  if (error) { console.warn("knuff_push_claim", error.message); return { ...NONE, reason: "no_knuff" }; }
  const d = (data ?? {}) as { ok?: boolean; to?: string; name?: string };
  if (!d.ok || !isUuid(d.to)) return { ...NONE, reason: "already_sent" };
  const payload = JSON.stringify(knuffPayload(d.name || "", id));
  const jobs = (await subsOf(admin, [d.to])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 900) : { ...NONE, reason: "no_subs" };
}
/** Cron: "Ute ikväll?" (ikvall_prompt_claim returns users only inside Fri/Sat 20:00-22:29) + due walk timers. */
async function gwCron(admin: Admin, key: string) {
  let ikvall = 0, walk = 0;
  try {
    const c = await keyRpc(key, "ikvall_prompt_claim", { p_limit: 500 });
    const uids = (Array.isArray(c.data) ? c.data : []).map((x) => typeof x === "string" ? x : (x && typeof x === "object" ? String(Object.values(x as Record<string, unknown>)[0] ?? "") : ""))
      .filter(isUuid);
    if (c.ok && uids.length) {
      const now = Date.now();
      const jobs = (await subsOf(admin, uids)).map((s) => ({ sub: s, payload: JSON.stringify(ikvallPayload(Math.floor(Math.random() * IKVALL_LINES.length), now)) }));
      ikvall = jobs.length ? (await sendAll(admin, jobs, 3600)).sent || 0 : 0;
    }
  } catch (e) { console.error("gw ikvall cron failed", e); }
  try {
    const w = await keyRpc(key, "walk_timer_due_claim", { p_limit: 50 });
    if (w.ok && Array.isArray(w.data) && w.data.length) walk = (await gwWalkSend(admin, w.data as GwWalkRow[])).sent || 0;
  } catch (e) { console.error("gw walk cron failed", e); }
  return { ikvall, walk };
}

/** lane-after-0450: send due rows of after_push_q (morning report 0450, moments 0451, game start 0452). Each kind has its
 *  own flag in after_flags (the SQL claim checks it). by = only the caller's rows ({event:"after_q"}). */
type AfterRow = { uid: string; kind: string; tag: string; title: string; body: string; url: string; has_sub: boolean };
async function afterQueueSend(admin: Admin, by: string | null): Promise<number> {
  try {
    const { data, error } = await admin.rpc("after_push_due", by ? { p_limit: 50, p_by: by } : { p_limit: 500 });
    if (error) { if (!/PGRST202|does not exist/i.test(String(error.message || ""))) console.error("after_push_due", error.message); return 0; }
    const rows = ((Array.isArray(data) ? data : []) as AfterRow[]).filter((r) => r && r.has_sub && isUuid(r.uid));
    if (!rows.length) return 0;
    const byUid = new Map(rows.map((r) => [r.uid, r]));
    const jobs = (await subsOf(admin, [...byUid.keys()])).map((sub) => {
      const r = byUid.get(sub.user_id)!;
      return { sub, payload: JSON.stringify({ title: r.title, body: r.body, url: r.url, tag: r.tag, k: r.kind === "am" ? "after" : r.kind, v: r.kind + ".1", ts: Date.now() }) };
    });
    return jobs.length ? (await sendAll(admin, jobs, 3 * 3600)).sent || 0 : 0;
  } catch (e) { console.error("after queue", e); return 0; }
}
// ---- sec X7 crash alert (0435) ----
// Owner-only: crash_alert_claim (service role) decides (flag, > N users in 1 h, 3 h cooldown) and returns ONE uid.
async function crashAlertCron(admin: Admin, key: string): Promise<number> {
  try {
    const c = await keyRpc(key, "crash_alert_claim", {});
    const r = (c.ok && c.data && typeof c.data === "object" && !Array.isArray(c.data) ? c.data : null) as
      { send?: boolean; owner?: string; users?: number; top?: string | null } | null;
    if (!r || r.send !== true || !isUuid(r.owner)) return 0;
    const n = Math.max(0, Number(r.users) || 0);
    const top = typeof r.top === "string" && r.top ? " Vanligast: " + cutCp(r.top, 60) : "";
    const payload = JSON.stringify({
      title: "⚠️ PintsNow: " + n + " kraschar senaste timmen",
      body: cutCp(n + " olika användare fick fel." + top, 160),
      url: "/stats.html", tag: "olnu-crash-alert",
    });
    const jobs = (await subsOf(admin, [r.owner])).map((s) => ({ sub: s, payload }));
    return jobs.length ? (await sendAll(admin, jobs, 3600, true)).sent || 0 : 0;   // raw: owner-only, not paced
  } catch (e) { console.error("crash alert", e); return 0; }
}

async function cronDue(key: string): Promise<Response> {
  if (key.length < 20 || key.length > 4096) return json({ error: "forbidden" }, 403);
  const claim = await keyRpc(key, "invite_due_claim", {});
  if (!claim.ok) return json({ error: "forbidden" }, 403);
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = (Array.isArray(claim.data) ? claim.data : []) as DueRow[];
  const due = rows.length ? await dueSend(admin, rows) : NONE;
  let yesSent = 0;
  const pend = await keyRpc(key, "invite_yes_due", {});
  if (pend.ok && Array.isArray(pend.data)) {
    for (const x of pend.data.slice(0, 50)) {
      const id = parseRallyId(typeof x === "object" && x ? (x as Record<string, unknown>).invite_yes_due ?? x : x);
      if (id === null) continue;
      try { yesSent += (await inviteYesSend(admin, id)).sent || 0; } catch (e) { console.error("yes flush failed", e); }
    }
  }
  // v24 📅 Går reminders (a missing RPC on an old database = skipped)
  let evDue = 0, evSent = 0;
  try {
    const ev = await keyRpc(key, "ev_going_due_claim", {});
    if (ev.ok && Array.isArray(ev.data) && ev.data.length) {
      evDue = ev.data.length;
      evSent = (await evDueSend(admin, ev.data as EvDueRow[])).sent || 0;
    }
  } catch (e) { console.error("ev_due failed", e); }
  const gw = await gwCron(admin, key);   // gw 0310 / 0313
  const v2 = await v2Cron(admin, key);   // ntf v2 (0390): each kind behind its own flag
  const afterQ = await afterQueueSend(admin, null);   // lane-after-0450
  lastFlush28 = 0;
  const crash = await crashAlertCron(admin, key);   // sec X7 (0435)
  const digests = await paceFlush(admin);   // v28 (deploy)
  // feat 0250 ⏰ Baren stänger (a missing RPC on an old database = skipped)
  let closeSent = 0;
  try {
    const cr = await keyRpc(key, "close_remind_claim", {});
    if (cr.ok && Array.isArray(cr.data) && cr.data.length) closeSent = (await closeSend(admin, cr.data as CloseRow[])).sent || 0;
  } catch (e) { console.error("close_remind failed", e); }
  return json({ ok: true, close_sent: closeSent, due: rows.length, sent: due.sent, failed: due.failed, yes_sent: yesSent, ev_due: evDue, ev_sent: evSent, digests, gw_ikvall: gw.ikvall, gw_walk: gw.walk, v2, after_q: afterQ, crash_alert: crash });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    if (!vapidReady || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "server_not_configured" }, 500);
    }
    // v28: the reminder cron (service key in x-olnu-cron, checked against a service-role-only RPC).
    const cronKey = req.headers.get("x-olnu-cron") ?? "";
    if (cronKey) return await cronDue(cronKey);

    // 1. Who is calling? Use the forwarded user JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Pass the JWT explicitly: with persistSession=false there is no stored session to read.
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const uid = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await v2Load(admin);   // ntf v2 (0390): flags (cached 60 s)
    await paceFlush(admin);   // v28 (deploy): held lines -> one digest (at most every 30 s per isolate)

    // Light cleanup: anonymous heat events older than 10 days (ghost_points shows 1-8 days).
    if (Math.random() < 0.05) {
      const { error } = await admin.from("beer_events").delete()
        .lt("created_at", new Date(Date.now() - 10 * 86_400_000).toISOString());
      if (error) console.error("beer_events cleanup failed", error);
    }

    // Optional body {event: ...}. Old clients send no body (= beer push).
    let event = "";
    let body: Body = {};
    try {
      const bj = await req.json();
      if (bj && typeof bj === "object") body = bj as Body;
      event = typeof body.event === "string" ? body.event : "";
    } catch (_e) { event = ""; }
    if (event === "home" || event === "pause") {
      return json(await statusPush(admin, uid, event));
    }
    if (event === "comehere") return json(await comeHere(admin, uid, body));
    if (event === "sos") return json(await sos(admin, uid, body));
    if (event === "msg" || event === "dm") return json(await msgPush(admin, uid, body));
    if (event === "rally") return json(await rallyPush(admin, uid, body));
    if (event === "rally_yes") return json(await rallyYesPush(admin, uid, body));
    if (event === "checkin") return json(await checkinPush(admin, uid, body));
    if (event === "tip") return json(await tipPush(admin, uid, body));
    if (event === "takeover") return json(await takeoverPush(admin, uid, body));
    if (event === "medevac_check") return json(await medcheckPush(admin, uid, body));
    if (event === "voice") return json(await voicePush(admin, uid, body));
    if (event === "eta") return json(await etaPush(admin, uid, body));
    if (event === "status_req") return json(await statusReqPush(admin, uid, body));
    if (event === "skal_hour") return json(await skalHourPush(admin, uid, body));
    if (event === "film") return json(await filmPush(admin, uid, body));
    if (event === "film_start") return json(await filmStartPush(admin, uid, body));   // 0195
    if (event === "helg_remind") return json(await helgRemindPush(admin, uid));
    if (event === "friend") return json(await friendPush(admin, uid, body));
    if (event === "find") return json(await findPush(admin, uid, body));
    if (event === "invite") return json(await invitePush(admin, uid, body));
    if (event === "invite_yes") return json(await inviteYesPush(admin, uid, body));
    if (event === "invite_due") return json(await inviteDuePush(admin, uid, body));
    if (event === "ev_due") return json(await evDuePush(admin, uid, body));
    if (event === "walk") return json(await walkPush(admin, uid, body, false));
    if (event === "walk_home") return json(await walkPush(admin, uid, body, true));
    if (event === "coming") return json(await comingPush(admin, uid, body));
    if (event === "knuff") return json(await gwKnuff(admin, uid, body));            // gw 0312
    if (event === "walk_check") return json(await gwWalkCheck(admin, uid, body));   // gw 0313
    if (event === "replay_ready") return json(await replayReadyPush(admin, uid, body));   // bold §3.7 (flag bold_replay)
    if (event === "krog_crown") return json({ ...NONE, reason: "off_v1" });   // bold §4.7: kept OFF in v1 (tag olnu-crown-* = kind bar when it comes)
    if (event === "after_q") return json({ ok: true, sent: await afterQueueSend(admin, uid) });   // lane-after-0450
    if (event === "pickup" && body.ride) return json(await ridePush(admin, uid, body));   // lane ride (0420): ride v2
    if (event === "pickup") return json(await pickupPush(admin, uid, body));          // feat 0250
    if (event === "pickup_yes") return json(await pickupYesPush(admin, uid, body));   // feat 0250

    // 2. Caller's beer. Nothing to do unless it is live and was accepted in the last 5 min.
    const nothing = { sent: 0, failed: 0, friends: 0, kaos: 0 };
    const { data: beer, error: beerErr } = await admin
      .from("beers")
      .select("id, lat, lng, beer_count, other_count, notified_level, stopped, expires_at, updated_at, precise, snap_bar")
      .eq("user_id", uid)
      .maybeSingle();
    if (beerErr) throw beerErr;
    const now = Date.now();
    const since = new Date(now - 5 * 60 * 1000).toISOString();
    if (
      !beer || !(drinksOf(beer) >= 1) || beer.stopped ||
      Date.parse(beer.expires_at) <= now || Date.parse(beer.updated_at) <= Date.parse(since)
    ) {
      return json(nothing);
    }

    const jobs: Job[] = [];
    let friendCount = 0;

    // Meriter -> title (v26, migration 0036). Missing table -> no title, pushes still work.
    let total = -1;
    try {
      total = await lifetimeTotal(admin, uid);
    } catch (e) {
      console.error("lifetime total failed", e);
    }
    const titel = total >= 0 ? titleFor(total).title : "";

    // A) FRIENDS: milestone push, once per level per night.
    // v17: levels count all drinks (beers + other drinks). Migration 0023 set notified_level for
    // tonight's rows to their current level, so the switch sends no late pushes.
    const level = milestoneLevel(drinksOf(beer));
    if (level > 0 && (beer.notified_level ?? 0) < level) {
      // Atomic claim: a concurrent call (or a retry) finds notified_level already >= level.
      const { data: claimed, error: claimErr } = await admin
        .from("beers")
        .update({ notified_level: level })
        .eq("user_id", uid)
        .lt("notified_level", level)
        .eq("stopped", false)
        .gt("updated_at", since)
        .gt("expires_at", new Date(now).toISOString())
        .select("id");
      if (claimErr) throw claimErr;
      if (claimed && claimed.length > 0) {
        // owner 13 Nov 19:51: snap_bar is a bar ID (e.g. "n3911317766"), never show it as a name. Look the name up; none = no bar.
        let barNm = "";
        if (beer.precise && beer.snap_bar) {
          try {
            const { data: bn } = await admin.from("bars_lite").select("name").eq("id", String(beer.snap_bar)).maybeSingle();
            barNm = cleanBarName(bn?.name ?? "");
          } catch (_e) { barNm = ""; }
        }
        const fj = await friendJobs(admin, uid, claimed[0].id as number, level as 1 | 5 | 10, titel, barNm, hhmm(now));
        friendCount = fj.length;
        jobs.push(...fj);
      }
    }

    // B) KAOS I STAN: every call; cheap when the area is calm.
    let kaosCount = 0;
    try {
      const k = await kaosJobs(admin, uid, beer);
      kaosCount = k.jobs.length;
      jobs.push(...k.jobs);
    } catch (e) {
      // Friend pushes must still go out if the area check fails (e.g. migration 0006 not run yet).
      console.error("kaos check failed", e);
    }

    // C) LEVEL-UP: new title -> group-mates, once per title per user ever.
    let levelUpCount = 0;
    if (total > 0) {
      try {
        const lj = await levelUpJobs(admin, uid, beer.id as number, total);
        levelUpCount = lj.length;
        jobs.push(...lj);
      } catch (e) {
        console.error("level-up check failed", e);
      }
    }

    if (jobs.length === 0) return json(nothing);
    const { sent, failed } = await sendAll(admin, jobs);
    return json({ sent, failed, friends: friendCount, kaos: kaosCount, levelup: levelUpCount });
  } catch (e) {
    console.error("notify-group error", e);
    return json({ error: "internal_error" }, 500);
  }
});
