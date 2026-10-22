// Öl Nu — 🎟️ Tickster events + per-match ticket links (CONTRACT "ARENOR · 🎟️ biljetter"). Optional: runs only with the
// GitHub secret TICKSTER_KEY. Called by scripts/import-events.mjs (daily run).
// Source: Tickster "Event dump API" (developer.tickster.com/documentation/eventdump): ONE call a day gives a signed link to a
// gzipped JSON file with every upcoming public event + its venue (name, city, geo) and its shop link (shopUri).
// Terms: all access needs a Tickster API key (request at developer.tickster.com → "Request API key"); Tickster offers the
// data "for customers and event aggregators". secure.tickster.com/robots.txt disallows crawling, so the shop pages are
// NEVER fetched — only the API. The dump is published ~07:00 UTC; Tickster asks to fetch it ≥ 1 h later (our run is later).
// What we use from it:
//   1. ticketFor(row): a hockey / football match row (scripts/import-sport.mjs) gets the EXACT match shop link when a Tickster
//      event starts within 45 min of it at a venue ≤ 3 km away and its name has the away team's first word (else none).
//   2. ticksterRows(towns): the other events at venues ≤ 25 km from an app town in the next 14 days → import_events rows
//      (source "tickster", url = shop link = the 🎟️ button, kind from tags/name: quiz / live / standup / party / null).
import { gunzipSync } from "node:zlib";

const UA = "OlNu-events/1.0 (+https://github.com/TuNeLA/Beer-map; daily Tickster event dump)";
const DAYS = 31;   // 📅 Månad (one dump download either way)
export const tnorm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const km = (a, b) => Math.hypot((a.lng - b.lng) * 111.32 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 111.32);
const GENERIC = new Set(["if", "ik", "hc", "hk", "bk", "sk", "aik", "ff", "fk", "fc", "is", "hockey", "the", "and", "och"]);

export async function ticksterDump(key, log) {
  if (!key) { log("tickster skipped (no TICKSTER_KEY)"); return null; }
  try {
    const r = await fetch("https://api.tickster.com/sv/api/" + (process.env.TICKSTER_DUMP_VERSION || "0.4") + "/events/dump/upcoming?key=" + encodeURIComponent(key), { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) { log("tickster dump", r.status); return null; }
    const meta = await r.json();
    if (!meta || !meta.uri) { log("tickster dump: no uri"); return null; }
    const f = await fetch(meta.uri, { headers: { "User-Agent": UA } });
    if (!f.ok) { log("tickster file", f.status); return null; }
    const buf = Buffer.from(await f.arrayBuffer());
    let txt; try { txt = gunzipSync(buf).toString("utf8"); } catch { txt = buf.toString("utf8"); }   // some clients unzip already
    return parseDump(JSON.parse(txt), log);
  } catch (e) { log("tickster", String(e.message || e)); return null; }
}
// dump JSON → [{ id, name, start, end, url, tags, venue: { name, city, lat, lng } }] (upcoming DAYS days, with a position)
export function parseDump(json, log, now = Date.now()) {
  const venues = new Map(((json && json.venues) || []).map((v) => [v.id, v]));
  const out = [];
  const add = (e) => {
    if (!e || e.published === false || e.isCollectionEvent) return;
    const v = venues.get(e.venueId), g = v && v.geo;
    const st = Date.parse(e.start || "");
    if (!g || !isFinite(+g.latitude) || !isFinite(+g.longitude) || !isFinite(st) || st < now - 3 * 3600e3 || st > now + DAYS * 864e5) return;
    const url = String(e.shopUri || "");
    if (!/^https:\/\/secure\.tickster\.com\//.test(url)) return;
    const end = Date.parse(e.end || "");
    out.push({ id: String(e.id), name: String(e.name || "").trim(), start: st, end: isFinite(end) && end > st && end - st < 864e5 ? end : null, url,
      tags: (e.tags || []).map((t) => tnorm(t)), venue: { name: String(v.name || "").slice(0, 60), city: v.city || null, lat: +g.latitude, lng: +g.longitude } });
  };
  for (const e of (json && json.events) || []) { add(e); for (const c of e.childEvents || []) add(c); }
  if (log) log("tickster events with a position:", out.length);
  return out;
}
function firstWord(team) { return tnorm(team).split(" ").find((w) => w.length >= 3 && !GENERIC.has(w)) || null; }
// The exact Tickster match for a sport row, or null.
export function ticketFor(row, evs) {
  if (!evs || !row || row.tv || !isFinite(row.lat)) return null;
  const st = Date.parse(row.starts_at), aw = firstWord(row.away), hw = firstWord(row.home);
  let best = null, bd = Infinity;
  for (const e of evs) {
    const dt = Math.abs(e.start - st);
    if (dt > 45 * 60e3 || km(e.venue, row) > 3) continue;
    const n = " " + tnorm(e.name) + " ";
    if (aw && !n.includes(" " + aw)) continue;
    if (!aw && hw && !n.includes(" " + hw)) continue;
    if (dt < bd) { bd = dt; best = e; }
  }
  return best ? best.url : null;
}
function kindOf(e) {
  const s = e.tags.join(" ") + " " + tnorm(e.name);
  if (/\b(quiz|pubquiz|frageesport|musikquiz)\b/.test(s)) return "quiz";
  if (/\b(standup|stand up|komik|humor)\b/.test(s)) return "standup";
  if (/\b(konsert|musik|live|band|rock|jazz|blues|pop|trubadur)\b/.test(s)) return "live";
  if (/\b(fest|klubb|dj|party|disco)\b/.test(s)) return "party";
  if (/\b(hockey|ishockey|fotboll|bandy|innebandy|handboll|basket)\b/.test(s)) return "sport";
  return null;
}
// Other Tickster events near the app's towns → import_events rows. usedUrls = shop links already used as match tickets.
export function ticksterRows(evs, towns, usedUrls) {
  const out = [];
  for (const e of evs || []) {
    if (usedUrls && usedUrls.has(e.url)) continue;
    if (towns && towns.length && !towns.some((t) => km(t, e.venue) <= 25)) continue;
    if (e.name.length < 3) continue;
    out.push({ source: "tickster", source_id: "tix:" + e.id, title: e.name.slice(0, 80), starts_at: new Date(e.start).toISOString(),
      ends_at: e.end ? new Date(e.end).toISOString() : null, url: e.url, place: e.venue.name || null, lat: e.venue.lat, lng: e.venue.lng, kind: kindOf(e) });
  }
  return out;
}
