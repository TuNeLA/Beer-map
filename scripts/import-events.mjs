#!/usr/bin/env node
// Öl Nu — import bar/pub events into public.bar_events (CONTRACT "v26 EXTRAS", migration 0065).
// Node 18+ (global fetch). Made for GitHub Actions (.github/workflows/events.yml), runs daily.
//
// Sources (each optional; a source without its config is skipped):
//   1. Ticketmaster Discovery API v2 — env TICKETMASTER_KEY (free key, 5000 calls/day, 5/s). One call per town
//      (olnu_towns via import_event_towns(), or EVENT_TOWNS="Ludvika:60.15:15.19,Borlänge:60.48:15.43"), 25 km, 14 days.
//   2. Public iCal feeds (.ics) — listed in scripts/event-feeds.json: {"type":"ical","url":…,"bar_id"?:…,"place"?:…,"lat"?,"lng"?}.
//      Weekly/daily RRULEs (pub quiz every Thursday) are expanded for 14 days.
//   3. schema.org Event JSON-LD on a bar's OWN web page — {"type":"jsonld","url":…,"bar_id"?…}. robots.txt is respected.
//   Facebook pages/events are NEVER fetched (Meta's terms forbid automated collection without written permission).
//
// Output: POST {p_rows:[…]} to <SUPABASE_URL>/rest/v1/rpc/import_events with the SERVICE ROLE key
// (env SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — GitHub secrets, never in the repo). `--dry` prints the rows instead.
// Exit 0 when a source fails (logged), 1 only when the upload fails.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const UA = "OlNu-events/1.0 (+https://github.com/TuNeLA/Beer-map; daily event import)";
const DAYS = 14;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[events]", ...a);

/* ---------- time helpers ---------- */
// Offset (ms) of a time zone at a UTC instant.
function tzOffset(utcMs, tz) {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs)).forEach((x) => { p[x.type] = x.value; });
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
// Wall-clock time in tz → UTC ms (DST-safe: two passes).
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  let off = tzOffset(guess, tz);
  let t = guess - off;
  const off2 = tzOffset(t, tz);
  if (off2 !== off) t = guess - off2;
  return t;
}
// iCal date value → {ms, allDay}
export function icalTime(val, params, defTz) {
  const v = String(val || "").trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m || /VALUE=DATE(?!-)/i.test(params || "")) {
    m = m || v.match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? { ms: zonedToUtc(+m[1], +m[2], +m[3], 20, 0, 0, defTz), allDay: true } : null;   // all-day → assume 20:00
  }
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  if (m[7]) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)), allDay: false };
  const tzm = String(params || "").match(/TZID=("?)([^;:"]+)\1/i);
  let tz = tzm ? tzm[2] : defTz;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = defTz; }
  return { ms: zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tz), allDay: false };
}

/* ---------- iCal ---------- */
function unfold(text) { return String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, ""); }
function unescapeIcs(s) { return String(s || "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim(); }
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
// Returns [{uid, title, start (ms), end (ms|null), url, location, geo}] from now−12 h to now+DAYS.
export function parseIcal(text, opts = {}) {
  const now = opts.now || Date.now(), from = now - 12 * 3600e3, to = now + (opts.days || DAYS) * 86400e3, defTz = opts.tz || "Europe/Stockholm";
  const out = [];
  const blocks = ("\n" + unfold(text) + "\n").split(/\nBEGIN:VEVENT\n/i).slice(1).map((b) => b.split(/\nEND:VEVENT/i)[0]);
  for (const b of blocks) {
    const f = {}, ex = [];
    for (const line of b.split("\n")) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/i);
      if (!m) continue;
      const k = m[1].toUpperCase();
      if (k === "EXDATE") { m[3].split(",").forEach((x) => { const t = icalTime(x, m[2], defTz); if (t) ex.push(t.ms); }); continue; }
      if (!(k in f)) f[k] = { p: m[2], v: m[3] };
    }
    if (!f.DTSTART || !f.SUMMARY) continue;
    if (f.STATUS && /CANCELLED/i.test(f.STATUS.v)) continue;
    const st = icalTime(f.DTSTART.v, f.DTSTART.p, defTz);
    if (!st) continue;
    const en = f.DTEND ? icalTime(f.DTEND.v, f.DTEND.p, defTz) : null;
    const dur = en && !st.allDay ? Math.max(0, en.ms - st.ms) : 0;
    const base = { uid: unescapeIcs(f.UID ? f.UID.v : f.SUMMARY.v + "@" + f.DTSTART.v), title: unescapeIcs(f.SUMMARY.v),
      url: f.URL ? unescapeIcs(f.URL.v) : null, location: f.LOCATION ? unescapeIcs(f.LOCATION.v) : null, geo: null };
    if (f.GEO) { const g = f.GEO.v.split(/[;,]/).map(Number); if (g.length === 2 && g.every(isFinite)) base.geo = { lat: g[0], lng: g[1] }; }
    const starts = [];
    if (f.RRULE) {
      const r = {}; f.RRULE.v.split(";").forEach((kv) => { const [a, c] = kv.split("="); r[a.toUpperCase()] = c; });
      const until = r.UNTIL ? (icalTime(r.UNTIL, "", defTz) || {}).ms : Infinity, count = r.COUNT ? +r.COUNT : Infinity, iv = Math.max(1, +(r.INTERVAL || 1));
      if (r.FREQ === "WEEKLY" || r.FREQ === "DAILY") {
        const days = r.FREQ === "WEEKLY" ? (r.BYDAY ? r.BYDAY.split(",").map((x) => DOW[x.slice(-2)]).filter((x) => x != null) : [new Date(st.ms).getUTCDay()]) : [0, 1, 2, 3, 4, 5, 6];
        let n = 0;
        for (let t = st.ms, i = 0; t <= Math.min(to, until) && n < count && i < 4000; t += 86400e3, i++) {
          // keep the wall-clock time across DST: rebuild from the local date
          const loc = new Date(t + tzOffset(t, defTz));
          const wk = Math.floor(i / 7);
          const day = loc.getUTCDay();
          if (!days.includes(day)) continue;
          if (r.FREQ === "WEEKLY" && wk % iv) continue;
          if (r.FREQ === "DAILY" && i % iv) continue;
          const s0 = new Date(st.ms + tzOffset(st.ms, defTz));
          const ms = zonedToUtc(loc.getUTCFullYear(), loc.getUTCMonth() + 1, loc.getUTCDate(), s0.getUTCHours(), s0.getUTCMinutes(), 0, defTz);
          n++;
          if (ex.some((e) => Math.abs(e - ms) < 60000)) continue;
          if (ms >= from && ms <= to) starts.push(ms);
        }
      } else if (st.ms >= from && st.ms <= to) starts.push(st.ms);
    } else if (st.ms >= from && st.ms <= to) starts.push(st.ms);
    for (const ms of starts) out.push({ ...base, uid: starts.length > 1 || f.RRULE ? base.uid + "#" + new Date(ms).toISOString().slice(0, 10) : base.uid, start: ms, end: dur ? ms + dur : null });
  }
  return out;
}

/* ---------- JSON-LD ---------- */
export function parseJsonLd(html, pageUrl, opts = {}) {
  const now = opts.now || Date.now(), from = now - 12 * 3600e3, to = now + (opts.days || DAYS) * 86400e3;
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const walk = (x) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x["@graph"]) walk(x["@graph"]);
    const t = [].concat(x["@type"] || []);
    if (t.some((y) => /Event$/.test(String(y))) && x.name && x.startDate) {
      const ms = Date.parse(x.startDate);
      if (isFinite(ms) && ms >= from && ms <= to) {
        const loc = Array.isArray(x.location) ? x.location[0] : x.location || {};
        const geo = loc && loc.geo ? { lat: +loc.geo.latitude, lng: +loc.geo.longitude } : null;
        out.push({ uid: String(x["@id"] || x.url || x.name + "@" + x.startDate), title: String(x.name).replace(/<[^>]+>/g, "").trim(),
          start: ms, end: x.endDate && isFinite(Date.parse(x.endDate)) ? Date.parse(x.endDate) : null,
          url: typeof x.url === "string" ? new URL(x.url, pageUrl).href : pageUrl, location: loc && loc.name ? String(loc.name) : null,
          geo: geo && isFinite(geo.lat) && isFinite(geo.lng) ? geo : null });
      }
    }
  };
  while ((m = re.exec(html))) { try { walk(JSON.parse(m[1].trim())); } catch {} }
  return out;
}

/* ---------- robots.txt (very small parser: User-agent * / OlNu, Disallow prefixes) ---------- */
export function robotsAllows(txt, path) {
  let applies = false, rules = [];
  for (const raw of String(txt || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); if (!line) continue;
    const [k, ...rest] = line.split(":"); const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = v === "*" || /olnu/i.test(v);
    else if (applies && /^disallow$/i.test(k) && v) rules.push(v);
    else if (applies && /^allow$/i.test(k) && v) rules.push("!" + v);
  }
  let best = null;
  for (const r of rules) { const allow = r[0] === "!", p = allow ? r.slice(1) : r; if (path.startsWith(p) && (!best || p.length > best.p.length)) best = { p, allow }; }
  return !best || best.allow;
}

/* ---------- Ticketmaster ---------- */
const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
export function geohash(lat, lng, len = 7) {
  let la = [-90, 90], ln = [-180, 180], h = "", bit = 0, ch = 0, even = true;
  while (h.length < len) {
    const r = even ? ln : la, v = even ? lng : lat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch = ch << 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { h += B32[ch]; bit = 0; ch = 0; }
  }
  return h;
}
export function tmRows(json) {
  const out = [];
  for (const e of (json && json._embedded && json._embedded.events) || []) {
    const v = (e._embedded && e._embedded.venues && e._embedded.venues[0]) || {};
    const lat = v.location ? +v.location.latitude : NaN, lng = v.location ? +v.location.longitude : NaN;
    const st = e.dates && e.dates.start;
    const ms = st && st.dateTime ? Date.parse(st.dateTime) : st && st.localDate ? zonedToUtc(...st.localDate.split("-").map(Number), ...(st.localTime ? st.localTime.split(":").map(Number) : [20, 0, 0]), "Europe/Stockholm") : NaN;
    if (!isFinite(lat) || !isFinite(lng) || !isFinite(ms)) continue;
    if (e.dates && e.dates.status && /cancel|postpon/i.test(e.dates.status.code || "")) continue;
    const seg = e.classifications && e.classifications[0] && e.classifications[0].segment ? e.classifications[0].segment.name : "";
    out.push({ source: "ticketmaster", source_id: String(e.id), title: String(e.name).slice(0, 80), starts_at: new Date(ms).toISOString(),
      url: e.url || null, place: v.name ? String(v.name).slice(0, 60) : null, lat, lng, kind: /sport/i.test(seg) ? "sport" : /music/i.test(seg) ? "live" : /arts/i.test(seg) ? "standup" : null });
  }
  return out;
}
async function ticketmaster(key, towns) {
  const rows = [], now = new Date(), end = new Date(Date.now() + DAYS * 86400e3);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const t of towns) {
    const u = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    u.searchParams.set("apikey", key); u.searchParams.set("geoPoint", geohash(t.lat, t.lng)); u.searchParams.set("radius", "25"); u.searchParams.set("unit", "km");
    u.searchParams.set("startDateTime", iso(now)); u.searchParams.set("endDateTime", iso(end)); u.searchParams.set("size", "100"); u.searchParams.set("sort", "date,asc");
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.status === 429) { log("ticketmaster rate limited, stopping"); break; }
      if (!r.ok) { log("ticketmaster", t.name, r.status); continue; }
      const got = tmRows(await r.json()); rows.push(...got);
      if (got.length) log("ticketmaster", t.name, got.length);
    } catch (e) { log("ticketmaster", t.name, String(e.message || e)); }
    await sleep(260);   // < 5 requests per second
  }
  const seen = new Set();
  return rows.filter((x) => (seen.has(x.source_id) ? false : seen.add(x.source_id)));
}

/* ---------- feeds file ---------- */
async function barsIndex() {
  const idx = new Map();
  for (const f of ["../docs/bars.json", "../docs/bars-extra.json"]) {
    try { for (const b of JSON.parse(await readFile(resolve(here, f), "utf8"))) idx.set(String(b.id), b); } catch {}
  }
  return idx;
}
function feedPos(feed, ev, bars) {
  const b = feed.bar_id ? bars.get(String(feed.bar_id)) : null;
  if (b) return { lat: b.lat, lng: b.lng, place: feed.place || b.name };
  if (isFinite(feed.lat) && isFinite(feed.lng)) return { lat: +feed.lat, lng: +feed.lng, place: feed.place || ev.location };
  if (ev.geo) return { lat: ev.geo.lat, lng: ev.geo.lng, place: feed.place || ev.location };
  return null;
}
async function feeds(list, bars) {
  const rows = [];
  for (const feed of list) {
    if (!feed || !feed.url || /facebook\.com|fb\.me|instagram\.com/i.test(feed.url)) { if (feed && feed.url) log("skip (Meta terms):", feed.url); continue; }
    try {
      const url = new URL(feed.url);
      if (feed.type === "jsonld") {
        let ok = true;
        try { const rb = await fetch(url.origin + "/robots.txt", { headers: { "User-Agent": UA } }); if (rb.ok) ok = robotsAllows(await rb.text(), url.pathname); } catch {}
        if (!ok) { log("robots.txt says no:", feed.url); continue; }
      }
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: feed.type === "ical" ? "text/calendar,*/*" : "text/html,*/*" } });
      if (!r.ok) { log(feed.type, feed.url, r.status); continue; }
      const text = await r.text();
      const evs = feed.type === "ical" ? parseIcal(text) : parseJsonLd(text, url.href);
      let n = 0;
      for (const ev of evs) {
        const p = feedPos(feed, ev, bars); if (!p) continue;
        rows.push({ source: feed.type, source_id: (feed.id || url.host) + ":" + ev.uid, title: ev.title.slice(0, 80), starts_at: new Date(ev.start).toISOString(),
          ends_at: ev.end ? new Date(ev.end).toISOString() : null, url: ev.url || feed.link || null, place: p.place ? String(p.place).slice(0, 60) : null,
          lat: p.lat, lng: p.lng, kind: feed.kind || null });
        n++;
      }
      log(feed.type, feed.url, n);
    } catch (e) { log(feed.type, feed.url, String(e.message || e)); }
    await sleep(800);
  }
  return rows;
}

async function rpc(name, body) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(url.replace(/\/$/, "") + "/rest/v1/rpc/" + name, {
    method: "POST", headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const t = await r.text();
  if (!r.ok) throw new Error(name + " " + r.status + " " + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const haveDb = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!dry && !haveDb) { log("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (use --dry to test)"); process.exit(1); }
  let towns = [];
  if (process.env.EVENT_TOWNS) towns = process.env.EVENT_TOWNS.split(",").map((s) => { const [name, lat, lng] = s.split(":"); return { name, lat: +lat, lng: +lng }; }).filter((t) => isFinite(t.lat));
  else if (haveDb) { try { towns = await rpc("import_event_towns"); } catch (e) { log("towns:", e.message); } }
  const list = JSON.parse(await readFile(resolve(here, "event-feeds.json"), "utf8").catch(() => "[]"));
  const rows = [];
  if (process.env.TICKETMASTER_KEY && towns.length) rows.push(...await ticketmaster(process.env.TICKETMASTER_KEY, towns));
  else log("ticketmaster skipped (no TICKETMASTER_KEY or no towns)");
  rows.push(...await feeds(Array.isArray(list) ? list : [], await barsIndex()));
  log("rows:", rows.length);
  if (dry) { console.log(JSON.stringify(rows.slice(0, 50), null, 1)); return; }
  for (let i = 0; i < rows.length; i += 500) log("import:", JSON.stringify(await rpc("import_events", { p_rows: rows.slice(i, i + 500) })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
