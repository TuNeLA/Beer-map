// Öl Nu — notify-group Edge Function.
// The client calls it (fire-and-forget) after an accepted beer. Old clients call it only after a
// milestone beer (1, 5 or 10); new clients call it after EVERY accepted beer. One call does two jobs:
//  A) FRIENDS: when the caller's beer hit a milestone, push to everyone who shares a group with
//     the caller, once per level per night (atomic notified_level claim).
//  B) KAOS I STAN: when the area around the caller's beer is wild (>= 10 live beers or >= 3 on
//     HOT STREAK within 5 km), push to subscribers whose saved area is within 10 km, at most once
//     per subscriber per night (push_sent). Anonymous counts only: no names, no exact places.
// Keep this in ONE file (the deploy tool uploads files directly; no import map).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

// ---- pure:start (no Deno / network below this line until pure:end; tested by supabase/tests) ----

export type Pt = { lat: number; lng: number };
export type LiveBeer = Pt & { beer_count: number };

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
    if (!(b.beer_count >= 1)) continue;
    if (haversineKm(center, b) > CHAOS_RADIUS_KM) continue;
    out++;
    if (b.beer_count >= 5) hot++;
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

export const FRIEND_LINES: Record<1 | 5 | 10, string[]> = {
  1: [
    "🍻 Grabbarna går loss på stan! {namn} är ute",
    "🍺 {namn} har öppnat första ölen. Hänger du på?",
    "🚨 {namn} är ute och rör sig. Int' sitta hemma nu!",
    "🍺 {namn} har knäckt en kall. Var é du?",
    "🚜 {namn} har parkerat traktorn och gått ut!",
    "📣 {namn} är ute på byn. Ska du bara sitta där?",
  ],
  5: [
    "🔥 {namn} är på HOT STREAK! Öl nr 5",
    "🔥 {namn} har fått upp ångan – fem öl!",
    "🔥 Fem öl för {namn}. Det här går int' att stoppa.",
    "🥵 {namn} är varm i kläderna nu. Öl nr 5!",
    "🐎 {namn} går som en dalahäst i galopp – fem öl!",
    "🔥 {namn} har tagit fem. Nu börjar det likna nåt!",
  ],
  10: [
    "🚁 MEDEVAC: kolla till {namn}! Öl nr 10",
    "🚁 {namn} har druckit 10. Nån borde kolla läget.",
    "🚁 Tio öl för {namn}. Ring och hör hur det står till.",
    "🚕 {namn} är uppe i 10. Dags att ordna taxi hem?",
    "💧 {namn} har tagit 10. Nån som har en flaska vatten?",
    "🚁 MEDEVAC till {namn}! Kolla att allt é lugnt.",
  ],
};

export const FRIEND_BODY: Record<1 | 5 | 10, string> = {
  1: "Öppna kartan och se var.",
  5: "Öppna kartan och se var.",
  10: "Kolla kartan. Vatten och taxi hem 🚕",
};

export const KAOS_LINES: string[] = [
  "🚨 Nu ballar det ur i {stad}!",
  "🍺 Ölbilen har kommit till {stad}!",
  "😳 Hörru, int' kan du sitta hemma nu?",
  "💥 Ja men nu jäklar, {stad}!",
  "📞 Kaos i {stad}! Nån borde ringa morsan.",
  "🚜 Hela {stad} har släppt traktorn och gått ut!",
  "🌲 Sånt här har int' hänt sen midsommar!",
  "🦌 Till och med älgarna i {stad} har gått ut!",
  "🍻 {n} pers är ute i {stad} just nu. Och du då?",
];

export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
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
  const body = hot > 0 ? `${out} ute · ${hot} på hot streak` : `${out} ute`;
  return { title, body, url: "/", tag: `olnu-kaos-${nightLabel(nightIso)}` };
}

// ---- pure:end ----

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

async function friendJobs(admin: Admin, uid: string, beerId: number, level: 1 | 5 | 10): Promise<Job[]> {
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
  // Tag uses the beer id (already in the url), never the user id.
  const tag = `olnu-${beerId}-${level}`;
  return ((subs ?? []) as Sub[]).map((s) => {
    const name = senderNameFor.get(s.user_id) ?? "En vän";
    const title = fill(lines[lineFor.get(s.user_id) ?? 0], { namn: name });
    return {
      sub: s,
      payload: JSON.stringify({ title, body: FRIEND_BODY[level], url: `/?focus=${beerId}`, tag }),
    };
  });
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
    .select("lat, lng, beer_count")
    .gt("expires_at", nowIso)
    .eq("stopped", false)
    .gte("beer_count", 1)
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
      const idx = kaosLineIndex(KAOS_LINES.length, beer.expires_at, s.user_id);
      return { sub: s, payload: JSON.stringify(kaosPayload(idx, stad, out, hot, beer.expires_at)) };
    });

  // Light cleanup of old nights (kept out of the SQL migration on purpose).
  if (Math.random() < 0.05) {
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const { error } = await admin.from("push_sent").delete().lt("night", old);
    if (error) console.error("push_sent cleanup failed", error);
  }
  return { jobs, out, hot, chaos };
}

async function sendAll(admin: Admin, jobs: Job[]) {
  const results = await Promise.allSettled(
    jobs.map((j) =>
      webpush.sendNotification(
        { endpoint: j.sub.endpoint, keys: { p256dh: j.sub.p256dh, auth: j.sub.auth } },
        j.payload,
        { TTL: 3600, urgency: "high" },
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
  if (deadIds.size > 0) {
    const { error } = await admin.from("push_subscriptions").delete().in("id", [...deadIds]);
    if (error) console.error("failed to delete dead subscriptions", error);
  }
  return { sent, failed };
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

    // 2. Caller's beer. Nothing to do unless it is live and was accepted in the last 5 min.
    const nothing = { sent: 0, failed: 0, friends: 0, kaos: 0 };
    const { data: beer, error: beerErr } = await admin
      .from("beers")
      .select("id, lat, lng, beer_count, notified_level, stopped, expires_at, updated_at")
      .eq("user_id", uid)
      .maybeSingle();
    if (beerErr) throw beerErr;
    const now = Date.now();
    const since = new Date(now - 5 * 60 * 1000).toISOString();
    if (
      !beer || !(beer.beer_count >= 1) || beer.stopped ||
      Date.parse(beer.expires_at) <= now || Date.parse(beer.updated_at) <= Date.parse(since)
    ) {
      return json(nothing);
    }

    const jobs: Job[] = [];
    let friendCount = 0;

    // A) FRIENDS: milestone push, once per level per night.
    const level = milestoneLevel(beer.beer_count as number);
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
        const fj = await friendJobs(admin, uid, claimed[0].id as number, level as 1 | 5 | 10);
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

    if (jobs.length === 0) return json(nothing);
    const { sent, failed } = await sendAll(admin, jobs);
    return json({ sent, failed, friends: friendCount, kaos: kaosCount });
  } catch (e) {
    console.error("notify-group error", e);
    return json({ error: "internal_error" }, 500);
  }
});
