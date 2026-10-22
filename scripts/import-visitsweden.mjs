// Öl Nu — 🇸🇪 Visit Sweden open data events → public.bar_events (CONTRACT "📅 VISIT SWEDEN-EVENEMANG"). No key.
// Called by scripts/import-events.mjs (daily run) with ONE hook line; all logic lives here. Node 18+ (global fetch).
// Source: Visit Sweden national open API (EntryStore, data.visitsweden.com), JSON-LD. Terms: "Öppna data är publik information
// som kan användas fritt, återanvändas och delas av vem som helst helt utan kostnad … utan licensrestriktioner" (spec CC-BY 4.0).
// We store facts only (title, time, place, position) + the event page link; never their texts or images.
// What it does:
//   1. Reads every public schema:Event (≈ 45 pages × 100), keeps starts in [now − 3 h, now + 31 days].
//   2. kind: quiz | karaoke | standup | dj (club / DJ / nattklubb) | party (afterwork) → the 📅 "🎉 Fest" filter covers dj + party,
//      live (MusicEvent / konsert …), other. Children / exhibitions / courses / sales / film / sports / church / multi-day are skipped.
//      Strong kinds (quiz … party) are kept anywhere (loose event at the venue position). live / other only when the venue is a
//      bar (or live when the venue name says pub / bar / krog …).
//   3. Bar match: the nearest bar in docs/bars.json + bars-extra.json ≤ 60 m, else a restaurant in docs/places.json ≤ 60 m,
//      else a bar whose name is in the venue / title ≤ 500 m. A matched row gets the bar's exact position, so the server's
//      olnu_ev_bar() attaches it to that bar. No match → the venue position (a loose event).
//   4. Dedupe: drops a row when a Ticketmaster / Tickster row of the same run is ≤ 250 m away, starts ± 1 h and has a similar
//      title; also duplicates inside Visit Sweden (two regional sites sending the same event).
// Rows: {source:"visitsweden", source_id:"vs:<context>-<entry>[#time]", title, starts_at, ends_at, url, place, lat, lng, kind} → import_events.
// The API has no ticket links (no schema:offers), so ticket_url stays empty; url = the event page.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const UA = "OlNu-events/1.0 (+https://github.com/TuNeLA/Beer-map; daily Visit Sweden open data import)";
const API = "https://data.visitsweden.com/store/search?type=solr&query=public:true+AND+rdfType:http%5C%3A%2F%2Fschema.org%2FEvent&rdfFormat=application/ld+json&limit=100&offset=";
const DAYS = 31, SERIES_DAYS = 15, MAX_ROWS = 800;   // a weekly / daily season is expanded 15 days ahead (like the recurring rules)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const meters = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 111320);

/* ---------- JSON-LD helpers ---------- */
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
function lit(v) {   // string | {@value,@language} | list → Swedish first
  const xs = arr(v).map((x) => (x && typeof x === "object" ? { v: x["@value"], l: x["@language"] } : { v: x, l: null })).filter((x) => x.v != null && String(x.v).trim());
  const sv = xs.find((x) => x.l === "sv") || xs.find((x) => !x.l) || xs[0];
  return sv ? String(sv.v) : null;
}
const idOf = (v) => (v && typeof v === "object" ? v["@id"] : typeof v === "string" ? v : null);
function clean(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "’")
    .replace(/&[a-z]+;/g, " ").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

/* ---------- time ---------- */
function stockholmToUtc(y, mo, d, h, mi) {
  let g = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(g)).reduce((o, x) => ((o[x.type] = x.value), o), {});
    g += Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  }
  return g;
}
// A clock time written in the title / description ("kl 19", "kl. 19.30", "at 18:00", "19:00", "8 PM") → [h, m] or null.
export function timeIn(text) {
  const t = String(text || "");
  let m = t.match(/\b(1[0-2]|[1-9])(?:[.:]([0-5]\d))?\s*pm\b/i);
  if (m) return [(+m[1] % 12) + 12, +(m[2] || 0)];
  m = t.match(/\bkl(?:ockan)?\.?\s*([01]?\d|2[0-3])(?:[.:]([0-5]\d))?\b/i)
    || t.match(/\b(?:at|from|fr[aå]n|starts?|startar)\s+(1\d|2[0-3])(?:[.:]([0-5]\d))?\b(?!\s*(?:kr|sek|%|år|years))/i)
    || t.match(/\b(1[2-9]|2[0-3])[:.]([0-5]\d)\b(?![.,]\d)/);
  return m ? [+m[1], +(m[2] || 0)] : null;
}
// "varje onsdag", "alla torsdagar", "every Wednesday", "Wednesdays", "varje dag", "every day" → [weekday 0–6] or null.
const WD = [["sondag", "sunday"], ["mandag", "monday"], ["tisdag", "tuesday"], ["onsdag", "wednesday"], ["torsdag", "thursday"], ["fredag", "friday"], ["lordag", "saturday"]];
export function weekdaysIn(text) {
  const t = " " + norm(text) + " ";
  if (/\b(varje dag|alla dagar|dagligen|every day|daily|each day)\b/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const out = [];
  WD.forEach(([sv, en], i) => {
    if (new RegExp("\\b(varje|alla|every|each) (" + sv + "|" + en + ")|\\b(" + sv + "ar|" + en + "s)\\b").test(t)) out.push(i);
  });
  return out.length ? out : null;
}
// One schema date value → {ms, dateOnly} (date-only values become null-time; the caller adds a written time or skips).
export function dateVal(x) {
  const v = String(x && typeof x === "object" ? x["@value"] : x || "").trim(), ty = x && typeof x === "object" ? String(x["@type"] || "") : "";
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!m) return null;
  // A day, not a time: no time part, "T00:00:00" (unknown time), "T12:00:00.000Z" typed xsd:date (Gotland day marker).
  const dateOnly = !m[4] || (m[4] === "00" && m[5] === "00") || (/xsd:date$/.test(ty) && m[4] === "12" && m[5] === "00" && /Z$/.test(v));
  if (dateOnly) return { y: +m[1], mo: +m[2], d: +m[3], ms: null, dateOnly: true };
  // "…T20:00:00.000Z" (Norrtälje / Gotland exports) is the local wall clock with a wrong "Z" (the pages say 20:00) → local.
  const ms = m[7] && !/\.000Z$/.test(v) ? Date.parse(v) : stockholmToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]);
  return isFinite(ms) ? { y: +m[1], mo: +m[2], d: +m[3], ms, dateOnly: false } : null;
}

const localParts = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
  .formatToParts(new Date(ms)).reduce((o, x) => ((o[x.type] = x.value), o), {});
const localYmd = (ms) => { const p = localParts(ms); return [+p.year, +p.month, +p.day]; };
const localHm = (ms) => { const p = localParts(ms); return [+p.hour % 24, +p.minute]; };

/* ---------- kinds ---------- */
const SKIP_TYPES = /(Childrens|Exhibition|VisualArts|CourseInstance|Education|Sale|Literary|Screening|Sports|Festival|Food)Event$|CourseInstance|Festival/;
const SKIP_STRONG = /(Childrens|Exhibition|VisualArts|Education|Literary)Event$|CourseInstance/;   // "Konstquiz" at a museum, a kids' disco
const SKIP_ANY = /\b(hostlov|sportlov|lov|isdisco|skridsko\w*|barn\w*|familj\w*|kyrk\w*|installt|installd|cancelled|canceled|uppskjut\w*)\b/;
const TASTING = /\b(ol|whisky|rom|cider|gin|vin|ost och ol)provning|\bbeer tasting|\bbryggeribesok/;
const SKIP_TEXT = /\b(barn\w*|familj\w*|kyrk\w*|domkyrka|gudstjanst|massa|teater\w*|pjas|\w*forestallning|fore?drag|julmarknad|marknad|loppis|utstallning|vernissage|kurs|workshop|bibliotek\w*|forelasning|guidad|visning|simhall|bad|lov)\b/;
export function kindOf(title, types, venue) {
  const t = norm(title), all = " " + t + " " + norm(venue) + " ";
  if (/quiz|fragesport|trivia/.test(t)) return "quiz";
  if (/karaoke/.test(t)) return "karaoke";
  if (/stand ?up|komik|comedy|humorkvall/.test(t)) return "standup";
  if (/\bdj\b|nattklubb|club ?night|klubbkvall|disco|\brave\b/.test(t)) return "dj";
  if (/after ?work|\baw\b|pubkvall|krogkvall/.test(t)) return "party";
  if (types.some((x) => /MusicEvent|DanceEvent/.test(x)) || /\blive\b|konsert|spelning|trubadur|jazz|blues|\brock\b|\bband\b|liveband/.test(all)) return "live";
  return "other";
}
const STRONG = new Set(["quiz", "karaoke", "standup", "dj", "party"]);
const BARRY = /\b(pub|bar|krog|krogen|brygg\w*|bistro|kallare|kallaren|nattklubb|jazzklubb|bierhaus|taproom|saloon|irish|tavern|hotel|hotell)\b/;

/* ---------- bars ---------- */
async function json(f) { try { return JSON.parse(await readFile(resolve(here, f), "utf8")); } catch { return []; } }
const cell = (lat, lng) => Math.floor(lat * 100) + ":" + Math.floor(lng * 50);   // ≈ 1.1 km cells
export async function loadBars() {
  const closed = new Set((await json("../docs/bars-closed.json")).map((x) => String(x.id)));
  const bars = [...(await json("../docs/bars.json")), ...(await json("../docs/bars-extra.json"))]
    .filter((b) => b && b.id && isFinite(b.lat) && isFinite(b.lng) && !closed.has(String(b.id)))
    .map((b) => ({ id: String(b.id), name: b.name || "", lat: +b.lat, lng: +b.lng, bar: b.type !== "restaurant" }));
  for (const p of await json("../docs/places.json"))
    if (Array.isArray(p) && p[3] === "r" && p[0] && isFinite(p[1])) bars.push({ id: "pl_" + Math.round(p[1] * 1e5) + "_" + Math.round(p[2] * 1e5), name: p[0], lat: +p[1], lng: +p[2], bar: false });
  const grid = new Map();
  for (const b of bars) { b.n = norm(b.name); const k = cell(b.lat, b.lng); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); }
  return { grid, count: bars.length };
}
function around(idx, p) {
  const out = [], la = Math.floor(p.lat * 100), ln = Math.floor(p.lng * 50);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of idx.grid.get(la + i + ":" + (ln + j)) || []) out.push(b);
  return out;
}
const GENERIC = new Set(["the", "bar", "pub", "restaurang", "restaurant", "krog", "och", "and", "cafe", "hotel", "hotell", "kok", "grill", "bistro", "pizzeria"]);
// Best bar for an event: nearest bar ≤ 60 m, else a restaurant ≤ 60 m whose name is in the venue / title (a museum next to a
// pizzeria is not that pizzeria), else a bar / restaurant whose name is in the venue / title ≤ 500 m.
export function matchBar(idx, p, venue, title) {
  let best = null, bd = Infinity, bestR = null, rd = Infinity, byName = null, nd = Infinity;
  const text = " " + norm(venue) + " " + norm(title) + " ";
  for (const b of around(idx, p)) {
    const d = meters(p, b);
    // a bar ≤ 60 m; when the venue has its own, different name ("Haymarket" next to O'Learys) only ≤ 20 m
    if (b.bar && d < bd && (d <= 20 || (d <= 60 && (!venue || similar(venue, b.name) || text.includes(" " + b.n + " "))))) { best = b; bd = d; }
    if (!b.bar && d <= 60 && d < rd && b.n.length >= 4 && (text.includes(" " + b.n + " ") || similar(venue || "", b.name))) { bestR = b; rd = d; }
    if (d <= 500 && d < nd) {
      const words = b.n.split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w));
      if (words.length && words.join(" ").length >= 4 && text.includes(" " + words.join(" ") + " ")) { byName = b; nd = d; }
    }
  }
  return best || bestR || byName || null;
}

/* ---------- parse one API page ---------- */
// The venue: the position's own name (not when it only repeats the title), else "… på / at / hos X" in the title.
function venueOf(v, title) {
  if (v && norm(v) !== norm(title)) return v;
  const m = String(title).match(/\s(?:på|at|hos|@)\s+([^–\-|!,(]{3,40})/i);
  return m ? m[1].trim() : "";
}

// → [{uid, title, venue, town, lat, lng, url, types, starts:[ms], end:ms|null}]
export function parsePage(page, now = Date.now()) {
  const from = now - 3 * 3600e3, to = now + DAYS * 864e5, out = [];
  for (const ch of (page && page.resource && page.resource.children) || []) {
    const g = arr(ch && ch.metadata && ch.metadata["@graph"]), byId = new Map(g.map((n) => [n["@id"], n]));
    for (const e of g) {
      if (!e || e["@type"] !== "schema:Event") continue;
      const title = clean(lit(e["schema:name"]));
      if (!title || title.length < 3) continue;
      const geo = byId.get(idOf(e["schema:geo"])) || {}, adr = byId.get(idOf(e["schema:address"])) || {};
      const lat = +lit(geo["schema:latitude"]), lng = +lit(geo["schema:longitude"]);
      if (!isFinite(lat) || !isFinite(lng) || !lat || !lng) continue;
      const types = arr(e["schema:additionalType"]).map(idOf).filter(Boolean);
      const sd = arr(e["schema:startDate"]).map(dateVal).filter(Boolean), ed = arr(e["schema:endDate"]).map(dateVal).filter(Boolean)[0] || null;
      if (!sd.length) continue;
      // ["2026-12-31", "2026-10-20"] style lists are a period, not dates → skip; a long period (> 26 h) too.
      if (sd.length === 2 && sd.every((x) => x.dateOnly) && Date.UTC(sd[1].y, sd[1].mo - 1, sd[1].d) < Date.UTC(sd[0].y, sd[0].mo - 1, sd[0].d)) continue;
      const dur = String(lit(e["schema:duration"]) || "");
      if (/^P(\d+)D/.test(dur) && +dur.match(/^P(\d+)D/)[1] >= 2) continue;
      const allText = title + " " + clean(arr(e["schema:description"]).map(lit).join(" ")) + " " + (lit(e["schema:alternateName"]) || "");
      const hm0 = timeIn(title) || timeIn(allText), wd = weekdaysIn(allText);
      const starts = [];
      let end = null;
      const first = sd[0], spanEnd = ed ? (ed.dateOnly ? Date.UTC(ed.y, ed.mo - 1, ed.d, 23, 59) : ed.ms) : null;
      const firstMs = first.dateOnly ? Date.UTC(first.y, first.mo - 1, first.d, 12) : first.ms;
      if (sd.length === 1 && spanEnd && spanEnd - firstMs > 26 * 3600e3) {
        // A season ("every Wednesday 18:00", start → end): expand the written weekly rule, else skip (exhibition, festival).
        const hm = first.dateOnly ? hm0 : hm0 || localHm(first.ms);
        if (!wd || !hm) continue;
        for (let t = Math.max(firstMs, now - 864e5); t <= Math.min(spanEnd, now + SERIES_DAYS * 864e5); t += 864e5) {
          const p = localYmd(t);
          if (!wd.includes(new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay())) continue;
          const ms = stockholmToUtc(p[0], p[1], p[2], hm[0], hm[1]);
          if (ms >= from && ms <= to && ms <= spanEnd) starts.push(ms);
        }
      } else {
        for (const x of sd) {
          const ms = x.dateOnly ? (hm0 ? stockholmToUtc(x.y, x.mo, x.d, hm0[0], hm0[1]) : null) : x.ms;
          if (ms != null && ms >= from && ms <= to) starts.push(ms);
        }
        if (sd.length === 1 && ed && !ed.dateOnly && starts.length && ed.ms > starts[0] && ed.ms - starts[0] <= 12 * 3600e3) end = ed.ms;
      }
      if (!starts.length) continue;
      const url = idOf(e["schema:url"]);
      out.push({ uid: ch.entryId ? (ch.contextId || "0") + "-" + ch.entryId + (g.filter((n) => n && n["@type"] === "schema:Event").length > 1 ? "-" + String(e["@id"]).slice(-8) : "") : String(e["@id"]).replace(/^urn:uuid:/, "").slice(-60), title, venue: venueOf(clean(lit(geo["schema:name"]) || ""), title), town: clean(lit(adr["schema:addressLocality"]) || ""),
        street: clean(lit(adr["schema:streetAddress"]) || ""), lat, lng, url: /^https?:\/\/\S+$/.test(url || "") && url.length <= 300 ? url : null, types, starts: [...new Set(starts)].sort(), end });
    }
  }
  return out;
}

/* ---------- events → rows ---------- */
const localHour = (ms) => +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }).format(new Date(ms)) % 24;
const STOP = new Set(["med", "och", "the", "and", "pa", "live", "kvall", "pub", "bar", "quiz", "konsert", "presenterar", "tour", "turne", "2026", "2027"]);
const toks = (s) => new Set(norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)));
export function similar(a, b) {
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return norm(a) === norm(b);
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.5;
}
export function toRows(evs, idx, existing = []) {
  const sellers = existing.filter((r) => r && (r.source === "ticketmaster" || r.source === "tickster"));
  const out = [], seen = [], stat = { events: evs.length, skipped_type: 0, skipped_loose: 0, dup_seller: 0, dup_vs: 0, at_bar: 0 };
  for (const e of evs) {
    const text = norm(e.title + " " + e.venue), local = localHour(e.starts[0]);
    const kind = TASTING.test(text) ? "other" : kindOf(e.title, e.types, e.venue);
    const strong = STRONG.has(kind) || TASTING.test(text);
    if (SKIP_ANY.test(text) || (strong ? e.types.some((x) => SKIP_STRONG.test(x)) : e.types.some((x) => SKIP_TYPES.test(x)) || SKIP_TEXT.test(text))) { stat.skipped_type++; continue; }
    const bar = idx ? matchBar(idx, e, e.venue, e.title) : null;
    // live: at a bar / restaurant, or a venue that says pub / bar / krog …; other: only at a real bar (bars.json), evening (16–03).
    const keep = strong || (kind === "live" && (bar || (BARRY.test(text) && (local >= 16 || local < 3)))) || (kind === "other" && bar && bar.bar && (local >= 16 || local < 3));
    if (!keep) { stat.skipped_loose++; continue; }
    const pos = bar ? { lat: bar.lat, lng: bar.lng } : { lat: +e.lat.toFixed(5), lng: +e.lng.toFixed(5) };
    const place = (e.venue || (bar && bar.name) || e.street || e.town || "").slice(0, 60) || null;
    for (const st of e.starts) {
      if (sellers.some((r) => Math.abs(Date.parse(r.starts_at) - st) <= 3600e3 && meters(r, pos) <= 250 && similar(r.title, e.title))) { stat.dup_seller++; continue; }
      if (seen.some((r) => Math.abs(r.st - st) <= 15 * 60e3 && meters(r, pos) <= 250 && similar(r.title, e.title))) { stat.dup_vs++; continue; }
      const row = { source: "visitsweden", source_id: "vs:" + e.uid + (e.starts.length > 1 ? "#" + new Date(st).toISOString().slice(0, 16) : ""),
        title: e.title.slice(0, 80), starts_at: new Date(st).toISOString(), ends_at: e.starts.length === 1 && e.end ? new Date(e.end).toISOString() : null,
        url: e.url, place, lat: pos.lat, lng: pos.lng, kind };
      seen.push({ st, lat: pos.lat, lng: pos.lng, title: e.title });
      if (bar) stat.at_bar++;
      out.push(Object.defineProperty(row, "_dbg", { value: { bar: bar ? bar.id + " " + bar.name : null, town: e.town }, enumerable: false }));
    }
  }
  out.sort((a, b) => (STRONG.has(b.kind) - STRONG.has(a.kind)) || a.starts_at.localeCompare(b.starts_at));
  return { rows: out.slice(0, MAX_ROWS), stat };
}

/* ---------- fetch ---------- */
export async function fetchAll(log) {
  const evs = [];
  let total = Infinity;
  for (let off = 0; off < total && off < 10000; off += 100) {
    let page = null;
    for (let tr = 0; tr < 3 && !page; tr++) {
      try {
        const r = await fetch(API + off, { headers: { "User-Agent": UA, Accept: "application/ld+json, application/json" } });
        if (r.ok) page = await r.json(); else { log("visitsweden page", off, r.status); await sleep(2000); }
      } catch (e) { log("visitsweden page", off, String(e.message || e)); await sleep(2000); }
    }
    if (!page) break;
    total = +page.results || 0;
    evs.push(...parsePage(page));
    await sleep(400);
  }
  log("visitsweden: upcoming events with a position (≤ " + DAYS + " d):", evs.length, "of", total === Infinity ? "?" : total);
  return evs;
}

// The hook: rows of this run (for dedupe) → new Visit Sweden rows. Never throws.
export async function visitSwedenRows(existing, log = console.log) {
  if (process.argv.includes("--no-visitsweden") || process.env.VISITSWEDEN === "0") { log("visitsweden skipped"); return []; }
  try {
    const [evs, idx] = await Promise.all([fetchAll(log), loadBars()]);
    const { rows, stat } = toRows(evs, idx, existing || []);
    log("visitsweden rows:", rows.length, JSON.stringify(stat));
    if (process.argv.includes("--dry")) {
      const by = {}; rows.forEach((r) => { by[r.kind] = (by[r.kind] || 0) + 1; });
      log("visitsweden by kind:", JSON.stringify(by));
      const show = (r) => Object.assign({}, r, r._dbg);
      const big = rows.filter((r) => /stockholm|goteborg|gothenburg/.test(norm(r._dbg.town + " " + r.place)) && STRONG.has(r.kind));
      console.log("[events] 🇸🇪 Visit Sweden sample (Stockholm / Göteborg, quiz … party):\n" + JSON.stringify(big.slice(0, 15).map(show), null, 1));
      console.log("[events] 🇸🇪 Visit Sweden sample (other places / kinds):\n" + JSON.stringify(rows.filter((r) => !big.includes(r)).slice(0, 15).map(show), null, 1));
    }
    return rows;
  } catch (e) { log("visitsweden:", String(e.message || e)); return []; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Stand-alone test: node scripts/import-visitsweden.mjs --dry  (prints; never uploads)
  if (!process.argv.includes("--dry")) process.argv.push("--dry");
  visitSwedenRows([], (...a) => console.log("[events]", ...a));
}
