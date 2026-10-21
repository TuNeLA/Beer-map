#!/usr/bin/env node
// Öl Nu — 🏟️ arena outlines (CONTRACT "ARENOR · matchpins, glöd och incheckning").
// For every arena in scripts/sport-venues.json, find its real outline in OpenStreetMap and write docs/arenas.json,
// which docs/js/bars.js (arenas = check-in places, type "arena") and docs/js/arenapin.js (glow + match pin) read.
//
// How an arena gets its outline (first match wins, all within ~150 m of the venue point):
//   1. a leisure=stadium | ice_rink | sports_centre area or a building whose name matches the venue (the point inside first,
//      then most matching words, then stadium / ice_rink, building, small sports_centre; a sports park > 15 000 m² last) → "name"
//   2. a leisure=stadium | ice_rink area that contains the point (smallest, ≤ 80 000 m²)                          → "leisure"
//   3. a building that contains the point (smallest, ≥ 300 m²)                                                    → "building"
//   4. a leisure=sports_centre area that contains the point (≤ 40 000 m²)                                         → "centre"
//   5. the nearest stadium / ice_rink area or big building (≥ 800 m²) whose edge is within 60 m                  → "near"
//   else no outline (g = null): the arena is still a check-in place, it just has no glow.
// Data: the OSM editing API "map" call (bbox ~300 × 300 m, ways come back complete), like scripts/bar-buildings.mjs.
// OSM API usage policy: a clear User-Agent, ONE request at a time, ≥ 1.5 s apart, back off on 429/509/5xx, and a rolling
// refresh (arenas checked < --refresh-days ago keep their outline; max --max calls per run).
// Output docs/arenas.json = { v: 1, src, n, a: [{ id, name, lat, lng, osm, k, s?, at, g }] }
//   id  = "a-<slug of the venue name>" (stable; also the bars_lite id, migration 0106), lat/lng = the venue point
//         (inside the outline when there is one), osm = "w…"/"r…" or null, k = how it was found, s = hockey | fotboll
//         when OSM says so, at = check date, g = [[ [lng, lat], … ]] outer rings (simplified 0.8 m, 6 decimals) or null.
// Usage: node scripts/arena-outlines.mjs [--max 200] [--refresh-days 60] [--delay 1500] [--only "Hitachi Arena"] [--dry]
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { ringArea, inPolys, edgeDist, simplifyRing } from "./bar-buildings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../docs/arenas.json");
const UA = "OlNu-arena-outlines/1.0 (+https://github.com/TuNeLA/Beer-map; weekly, ~150 small map calls, 1 at a time)";
const API = "https://api.openstreetmap.org/api/0.6/map.json";
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : null; };
const DELAY = +(opt("--delay") || 1500), MAX_CALLS = +(opt("--max") || 200), REFRESH_DAYS = +(opt("--refresh-days") || 60);
const DRY = !!opt("--dry"), ONLY = opt("--only");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const arenaId = (name) => "a-" + norm(name).replace(/ /g, "-").slice(0, 60);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const GENERIC = new Set(["arena", "ishall", "hallen", "hall", "ishallen", "is", "och", "sporthall", "a", "b", "the", "if", "ik", "hc"]);

function joinRings(ways) {
  const rings = [], open = ways.filter((w) => w.length > 1).map((w) => w.slice());
  while (open.length) {
    let cur = open.shift(), grew = true;
    while (cur[0] !== cur[cur.length - 1] && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i], a = cur[cur.length - 1];
        if (w[0] === a) cur = cur.concat(w.slice(1));
        else if (w[w.length - 1] === a) cur = cur.concat(w.slice(0, -1).reverse());
        else if (w[w.length - 1] === cur[0]) cur = w.slice(0, -1).concat(cur);
        else if (w[0] === cur[0]) cur = w.slice(1).reverse().concat(cur);
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    if (cur.length >= 4 && cur[0] === cur[cur.length - 1]) rings.push(cur);
  }
  return rings;
}
// OSM map.json → [{ id, tags, polys, kind: "leisure" | "building" }]
export function parseShapes(json) {
  const nodes = new Map(), ways = new Map(), rels = [];
  for (const el of (json && json.elements) || []) {
    if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
    else if (el.type === "way") ways.set(el.id, el);
    else if (el.type === "relation") rels.push(el);
  }
  const coords = (ids) => { const out = []; for (const id of ids) { const c = nodes.get(id); if (!c) return null; out.push(c); } return out; };
  const kindOf = (t) => (/^(stadium|ice_rink|sports_centre)$/.test(t.leisure || "") ? "leisure" : t.building && t.building !== "no" ? "building" : null);
  const out = [];
  for (const r of rels) {
    const t = r.tags || {}, k = kindOf(t);
    if (!k || (t.type !== "multipolygon" && t.type !== "building")) continue;
    const outer = [];
    for (const m of r.members || []) if (m.type === "way" && m.role !== "inner" && ways.has(m.ref)) outer.push(ways.get(m.ref).nodes);
    const polys = joinRings(outer).map(coords).filter(Boolean).map((o) => [o]);
    if (polys.length) out.push({ id: "r" + r.id, tags: t, polys, kind: k });
  }
  for (const w of ways.values()) {
    const n = w.nodes || [], t = w.tags || {}, k = kindOf(t);
    if (!k || n.length < 4 || n[0] !== n[n.length - 1]) continue;
    const c = coords(n); if (c) out.push({ id: "w" + w.id, tags: t, polys: [[c]], kind: k });
  }
  return out;
}
const area = (s, lat) => s.polys.reduce((a, rings) => a + ringArea(rings[0], lat), 0);
function nameHit(venue, note, tags) {
  const words = (s) => norm(s).split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w));
  const want = new Set(words(venue).concat(words((note || "").replace(/^[^(]*\(|\)$/g, ""))));
  const have = new Set(words([tags.name, tags.alt_name, tags.old_name, tags.official_name].filter(Boolean).join(" ")));
  let n = 0; for (const w of have) if (want.has(w)) n++;
  return n;
}
// → { k, shape } | null
export function pickOutline(v, shapes) {
  const pt = [v.lng, v.lat], lat = v.lat;
  const sized = shapes.map((s) => ({ s, a: area(s, lat) })).filter((x) => x.a >= 150);
  // named: the most matching words first, then the one the point is in, then leisure areas, then the smallest
  const named = sized.map((x) => Object.assign(x, { n: nameHit(v.name, v.note, x.s.tags), inside: inPolys(pt, x.s.polys) }))
    .filter((x) => x.n > 0 && x.a <= 120000 && (x.inside || ((x.s.kind === "leisure" || x.a >= 800) && edgeDist(pt, x.s.polys) <= 200)));
  // a big sports_centre (> 15 000 m²) is a whole sports park (fields, track): its hall building is the arena
  const rank = (x) => (x.s.kind === "building" ? 1 : x.s.tags.leisure === "sports_centre" ? (x.a <= 15000 ? 1.5 : 3) : 0);
  named.sort((x, y) => (y.inside - x.inside) || (y.n - x.n) || (rank(x) - rank(y)) || x.a - y.a);
  if (named.length) return { k: "name", shape: named[0].s };
  const pick = (f, k, byArea) => { const c = sized.filter(f); if (!c.length) return null; c.sort((x, y) => (byArea ? x.a - y.a : 0)); return { k, shape: c[0].s }; };
  return pick((x) => x.s.kind === "leisure" && /stadium|ice_rink/.test(x.s.tags.leisure) && x.a <= 80000 && inPolys(pt, x.s.polys), "leisure", true) ||
    pick((x) => x.s.kind === "building" && x.a >= 300 && inPolys(pt, x.s.polys), "building", true) ||
    pick((x) => x.s.kind === "leisure" && x.s.tags.leisure === "sports_centre" && x.a <= 40000 && inPolys(pt, x.s.polys), "centre", true) ||
    (() => {
      const c = sized.filter((x) => ((x.s.kind === "leisure" && /stadium|ice_rink/.test(x.s.tags.leisure) && x.a <= 80000) || (x.s.kind === "building" && x.a >= 800 && x.a <= 40000)))
        .map((x) => ({ x, d: inPolys(pt, x.s.polys) ? 0 : edgeDist(pt, x.s.polys) })).filter((y) => y.d <= 60);
      c.sort((p, q) => p.d - q.d);
      return c.length ? { k: "near", shape: c[0].x.s } : null;
    })();
}
function sportOf(tags) {
  const s = String(tags.sport || "") + " " + String(tags.leisure || "");
  if (/ice_hockey|ice_rink|ice_skating/.test(s)) return "hockey";
  if (/soccer|football/.test(s)) return "fotboll";
  return null;
}
function geom(shape) {
  return shape.polys.map((rings) => simplifyRing(rings[0], 0.8).map((p) => [r6(p[0]), r6(p[1])]));
}
async function fetchMap(v) {
  const dLat = 0.0014, dLng = 0.0014 / Math.cos(v.lat * Math.PI / 180);
  const bbox = [v.lng - dLng, v.lat - dLat, v.lng + dLng, v.lat + dLat].map((x) => x.toFixed(5)).join(",");
  for (let tries = 0; tries < 4; tries++) {
    const r = await fetch(API + "?bbox=" + bbox, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status === 509 || r.status >= 500) { await sleep(30000 * (tries + 1)); continue; }
    throw new Error("HTTP " + r.status);
  }
  throw new Error("gave up");
}

async function main() {
  const venues = await readJSON(resolve(here, "sport-venues.json"), {});
  const old = await readJSON(OUT, { a: [] }), byId = new Map((old.a || []).map((x) => [x.id, x]));
  const out = [], seen = new Set();
  let calls = 0;
  for (const [name, v] of Object.entries(venues)) {
    if (name.startsWith("_") || !v || !isFinite(v.lat) || !isFinite(v.lng)) continue;
    const id = arenaId(name); if (seen.has(id)) continue; seen.add(id);
    const prev = byId.get(id);
    const fresh = prev && prev.at && Date.now() - Date.parse(prev.at) < REFRESH_DAYS * 864e5 && Math.abs(prev.lat - v.lat) < 1e-5 && Math.abs(prev.lng - v.lng) < 1e-5;
    if ((ONLY && name !== ONLY) || fresh || calls >= MAX_CALLS) { if (prev) out.push(Object.assign({}, prev, { name })); else out.push({ id, name, lat: +v.lat, lng: +v.lng, osm: null, k: null, at: null, g: null }); continue; }
    let row = { id, name, lat: +v.lat, lng: +v.lng, osm: null, k: null, at: new Date().toISOString().slice(0, 10), g: null };
    try {
      if (calls) await sleep(DELAY);
      calls++;
      const hit = pickOutline({ name, note: v.note, lat: +v.lat, lng: +v.lng }, parseShapes(await fetchMap(v)));
      if (hit) {
        row.osm = hit.shape.id; row.k = hit.k; row.g = geom(hit.shape);
        const s = sportOf(hit.shape.tags); if (s) row.s = s;
        // keep the point inside the outline (pins and check-ins snap to it)
        if (!inPolys([row.lng, row.lat], hit.shape.polys)) {
          const ring = row.g[0]; let x = 0, y = 0; ring.slice(0, -1).forEach((p) => { x += p[0]; y += p[1]; });
          const c = [x / (ring.length - 1), y / (ring.length - 1)];
          if (inPolys(c, hit.shape.polys)) { row.lng = Math.round(c[0] * 1e5) / 1e5; row.lat = Math.round(c[1] * 1e5) / 1e5; }
        }
      }
      console.log("[arenas]", name, "→", row.k || "none", row.osm || "", hit ? (hit.shape.tags.name || "") : "");
    } catch (e) {
      console.warn("[arenas]", name, e.message);
      if (prev) row = Object.assign({}, prev, { name });
    }
    out.push(row);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  // two venue names on the same spot (≤ 30 m, or the same OSM outline) = one arena: the first id wins, the other is an alias
  for (let i = out.length - 1; i >= 0; i--) {
    const x = out[i], twin = out.find((y, j) => j < i && ((x.osm && y.osm === x.osm) || Math.hypot((x.lat - y.lat) * 111195, (x.lng - y.lng) * 111195 * Math.cos(x.lat * Math.PI / 180)) <= 30));
    if (twin) { (twin.alias = twin.alias || []).push(x.name); out.splice(i, 1); }
  }
  const doc = { v: 1, src: "Arena outlines © OpenStreetMap contributors (ODbL)", n: out.length, a: out };
  if (DRY) { console.log(JSON.stringify(doc).slice(0, 2000)); return; }
  await writeFile(OUT, JSON.stringify(doc).replace(/\{"id"/g, "\n{\"id\"") + "\n");
  console.log("[arenas] wrote", out.length, "arenas,", out.filter((x) => x.g).length, "with outline,", calls, "OSM calls");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
