#!/usr/bin/env node
// Öl Nu — 🏠 bar buildings (CONTRACT "KARTSTIL 2 · lit bar buildings").
// For every bar / pub / restaurant in docs/bars.json + docs/bars-extra.json + approved place suggestions (server,
// optional), find the OSM building it is in, and write small GeoJSON tiles that docs/js/barlit.js draws as lit
// outlines on every map style.
//
// How a spot gets its building (first match wins):
//   1. the spot itself is an OSM way/relation (id "w…"/"r…") tagged building=*            → that outline ("self")
//   2. a building way/multipolygon that CONTAINS the spot point (the smallest one)        → "in"
//   3. the spot is an OSM area (no building tag) inside no building, area ≤ 4000 m²       → the venue outline ("area")
//   4. the nearest building edge within NEAR_M (15 m)                                      → "near"
//   5. no OSM building: Microsoft Global ML Building Footprints (ODbL, same rules 2 + 4)     → "ms-in" / "ms-near"
//      (many Swedish town centres, Ludvika included, have few OSM buildings; Microsoft has them all)
//   else no outline (the marker stays as it is).
//
// Microsoft data: https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv lists one gzipped
// GeoJSON-lines file per zoom-9 quadkey (~80 km); only the files with unresolved spots are downloaded (static
// Azure storage, cached in $RUNNER_TEMP or the OS temp dir for the run).
// Data source: the OSM editing API "map" call (bbox, ways come back complete). Overpass is not used.
// OSM API usage policy: a clear User-Agent, ONE request at a time, ≥ 1.5 s apart, back off on 429/509/5xx,
// and a rolling refresh (only new spots + spots older than REFRESH_DAYS, capped by --max calls per run), so a
// weekly run makes a few hundred small calls at most.
//
// Spots are grouped in cells of 0.003° × 0.006° (~330 m); one map call per cell with spots (+ 40 m margin).
// A cell the API refuses as too big (400) is split in four.
//
// Output (docs/buildings/):
//   index.json        = { v: 1, d: [0.05, 0.1], n: <features>, t: { "<ty>_<tx>": <features in tile> } }
//                        tile key = floor(lat / 0.05) + "_" + floor(lng / 0.1)  (~5.5 × 5.5 km in Sweden)
//   <ty>_<tx>.json    = GeoJSON FeatureCollection; Feature.properties = { bar_id, also? (more spot ids in the same
//                        building), k: self|in|area|near }; Polygon / MultiPolygon, rings simplified (0.4 m) and
//                        rounded to 6 decimals. A feature goes into the tile of its spot.
// State (not served): scripts/bar-buildings-state.json = { "<bar_id>": { at, lat, lng, k, g } } (g = geometry or null).
//
// Usage:
//   node scripts/bar-buildings.mjs [--region dalarna|sweden|s,w,n,e] [--max 400] [--refresh-days 28]
//                                  [--suggestions file.json] [--places] [--delay 1500] [--dry]
//     --region       which spots to (re)check this run; the output always holds every known spot
//     --places       also restaurants / cafés from docs/places.json (many: use with a small region)
//     --suggestions  JSON [{bar_id, lat, lng}] of approved place suggestions. Without it, and with
//                    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set, they are read from place_suggestions (status ok).
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(here, "../docs");
const OUT = join(DOCS, "buildings");
const STATE = join(here, "bar-buildings-state.json");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : null; };
const UA = "OlNu-bar-buildings/1.0 (+https://github.com/TuNeLA/Beer-map; weekly, few hundred small map calls, 1 at a time)";
const API = "https://api.openstreetmap.org/api/0.6/map.json";
export const TILE_LAT = 0.05, TILE_LNG = 0.1;
const CELL_LAT = 0.003, CELL_LNG = 0.006, MARGIN = 0.0004;
const NEAR_M = 15, AREA_MAX_M2 = 4000, SIMPLIFY_M = 0.4;
const REGIONS = { dalarna: [59.85, 12.1, 62.3, 16.8], sweden: [55.0, 10.9, 69.1, 24.2] };
const DELAY = +(opt("--delay") || 1500), MAX_CALLS = +(opt("--max") || 400), REFRESH_DAYS = +(opt("--refresh-days") || 28);
const DRY = !!opt("--dry");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };

/* ---------- geometry (local metres around a point) ---------- */
const R = 6371000, RAD = Math.PI / 180;
function proj(lat0) { const kx = Math.cos(lat0 * RAD) * RAD * R, ky = RAD * R; return (p) => [p[0] * kx, p[1] * ky]; }   // p = [lng, lat]
export function ringArea(ring, lat0) {   // m², ring = [[lng, lat], …]
  const P = proj(lat0); let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) { const p = P(ring[i]), q = P(ring[(i + 1) % n]); a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a / 2);
}
export function inRing(pt, ring) {   // pt = [lng, lat]
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
// polys = [[outer, hole, …], …]
export function inPolys(pt, polys) {
  return polys.some((rings) => inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)));
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1]; return Math.sqrt(x * x + y * y);
}
export function edgeDist(pt, polys) {   // metres from pt to the nearest edge
  const P = proj(pt[1]), p = P(pt); let best = Infinity;
  for (const rings of polys) for (const r of rings) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, segDist(p, P(r[i]), P(r[i + 1])));
  return best;
}
// Douglas–Peucker on a closed ring (first == last), tolerance in metres. Keeps ≥ 4 points.
export function simplifyRing(ring, tolM) {
  if (ring.length <= 5) return ring;
  const P = proj(ring[0][1]), pts = ring.map(P), keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  // split at the point farthest from the start, so the closed ring keeps its shape
  let far = 1, fd = -1;
  for (let i = 1; i < ring.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  keep[far] = 1;
  const stack = [[0, far], [far, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let md = 0, mi = -1;
    for (let i = s + 1; i < e; i++) { const d = segDist(pts[i], pts[s], pts[e]); if (d > md) { md = d; mi = i; } }
    if (mi >= 0 && md > tolM) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;
function cleanPolys(polys) {
  return polys.map((rings) => rings.map((r) => simplifyRing(r, SIMPLIFY_M).map((p) => [r6(p[0]), r6(p[1])])));
}

/* ---------- OSM response → polygons ---------- */
// Join open ways into closed rings (multipolygon members). ways = [[nodeIds…], …]
function joinRings(ways) {
  const rings = [], open = ways.filter((w) => w.length > 1).map((w) => w.slice());
  while (open.length) {
    let cur = open.shift();
    let grew = true;
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
export function parseMap(json) {
  const nodes = new Map(), ways = new Map(), rels = [];
  for (const el of json.elements || []) {
    if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
    else if (el.type === "way") ways.set(el.id, el);
    else if (el.type === "relation") rels.push(el);
  }
  const coords = (ids) => { const out = []; for (const id of ids) { const c = nodes.get(id); if (!c) return null; out.push(c); } return out; };
  const shapes = [];   // { id: "w1", tags, polys, building }
  const inRel = new Set();
  for (const r of rels) {
    const t = r.tags || {};
    if (t.type !== "multipolygon" && t.type !== "building") continue;
    const outer = [], inner = [];
    for (const m of r.members || []) {
      if (m.type !== "way" || !ways.has(m.ref)) continue;
      (m.role === "inner" ? inner : outer).push(ways.get(m.ref).nodes);
      if (m.role !== "inner" && !Object.keys(ways.get(m.ref).tags || {}).some((k) => k === "building")) inRel.add(m.ref);
    }
    const oR = joinRings(outer).map(coords).filter(Boolean), iR = joinRings(inner).map(coords).filter(Boolean);
    if (!oR.length) continue;
    const polys = oR.map((o) => [o].concat(iR.filter((h) => inRing(h[0], o))));
    shapes.push({ id: "r" + r.id, tags: t, polys, building: !!t.building && t.building !== "no" });
  }
  for (const w of ways.values()) {
    const n = w.nodes || [];
    if (n.length < 4 || n[0] !== n[n.length - 1]) continue;
    const t = w.tags || {};
    const isB = !!t.building && t.building !== "no";
    if (!isB && !t.amenity) continue;
    const c = coords(n); if (!c) continue;
    shapes.push({ id: "w" + w.id, tags: t, polys: [[c]], building: isB });
  }
  return shapes;
}
const polysArea = (polys, lat) => polys.reduce((s, rings) => s + ringArea(rings[0], lat) - rings.slice(1).reduce((h, r) => h + ringArea(r, lat), 0), 0);

// Pick the building for one spot from the shapes of its cell. → { k, polys } | null
export function pickBuilding(spot, shapes) {
  const pt = [spot.lng, spot.lat], lat = spot.lat;
  const self = spot.osm ? shapes.find((s) => s.id === spot.osm) : null;
  if (self && self.building) return { k: "self", polys: self.polys, src: self.id };
  const blds = shapes.filter((s) => s.building);
  let best = null, ba = Infinity;
  for (const b of blds) {
    if (!inPolys(pt, b.polys)) continue;
    const a = polysArea(b.polys, lat);
    if (a < ba && a > 4) { ba = a; best = b; }
  }
  if (best) return { k: "in", polys: best.polys, src: best.id };
  if (self && polysArea(self.polys, lat) <= AREA_MAX_M2) return { k: "area", polys: self.polys, src: self.id };
  let nd = NEAR_M, near = null;
  for (const b of blds) {
    if (polysArea(b.polys, lat) > 60000) continue;   // never light up a whole factory / mall from 15 m away
    const d = edgeDist(pt, b.polys);
    if (d <= nd) { nd = d; near = b; }
  }
  if (near) return { k: "near", polys: near.polys, src: near.id };
  return null;
}

/* ---------- OSM API ---------- */
let calls = 0, lastCall = 0;
async function mapCall(s, w, n, e, depth = 0) {
  const wait = lastCall + DELAY - Date.now(); if (wait > 0) await sleep(wait);
  const url = `${API}?bbox=${w.toFixed(6)},${s.toFixed(6)},${e.toFixed(6)},${n.toFixed(6)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    lastCall = Date.now(); calls++;
    let res = null;
    try { res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); } catch { res = null; }
    if (res && res.ok) return (await res.json());
    const st = res ? res.status : 0;
    if (st === 400 && depth < 3) {   // too many nodes: split in four
      const mh = (s + n) / 2, mw = (w + e) / 2, parts = [];
      for (const [a, b, c, d] of [[s, w, mh, mw], [s, mw, mh, e], [mh, w, n, mw], [mh, mw, n, e]]) parts.push(await mapCall(a, b, c, d, depth + 1));
      return { elements: parts.flatMap((p) => (p && p.elements) || []) };
    }
    if (st === 400) return { elements: [] };
    const back = st === 429 || st === 509 ? 60000 : 5000 * (attempt + 1);
    console.warn(`OSM API ${st || "network"} for ${url} — waiting ${back / 1000} s`);
    await sleep(back);
  }
  throw new Error("OSM API keeps failing");
}

/* ---------- Microsoft Global ML Building Footprints (fallback) ---------- */
const MS_LINKS = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv";
export function quadkey(lat, lng, z) {
  const n = 2 ** z, x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * n);
  let q = "";
  for (let i = z; i > 0; i--) { const m = 1 << (i - 1); q += String((x & m ? 1 : 0) + (y & m ? 2 : 0)); }
  return q;
}
let msIndex = null;
async function msLinks() {
  if (msIndex) return msIndex;
  msIndex = new Map();
  try {
    const r = await fetch(MS_LINKS, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error("links " + r.status);
    for (const line of (await r.text()).split("\n")) {
      const c = line.split(",");
      if (c[0] === "Sweden" || c[0] === "Norway" || c[0] === "Finland") (msIndex.get(c[1]) || msIndex.set(c[1], []).get(c[1])).push(c[2]);
    }
  } catch (e) { console.warn("Microsoft buildings index:", e.message); }
  return msIndex;
}
const CACHE = join(process.env.RUNNER_TEMP || tmpdir(), "olnu-ms-buildings");
async function msFile(url) {
  await mkdir(CACHE, { recursive: true });
  const f = join(CACHE, url.replace(/[^a-z0-9]+/gi, "_").slice(-120));
  try { return await readFile(f); } catch {}
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("ms " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(f, buf);
  return buf;
}
// spots without an OSM building → { id: {k, polys} }
async function msPass(spots) {
  const out = {}, byQ = new Map();
  for (const s of spots) { const q = quadkey(s.lat, s.lng, 9); (byQ.get(q) || byQ.set(q, []).get(q)).push(s); }
  const ix = await msLinks();
  for (const [q, list] of byQ) {
    const urls = ix.get(q) || [];
    const shapes = [];
    const PAD_LAT = 0.0004, PAD_LNG = 0.0008;
    for (const url of urls) {
      let txt;
      try { txt = gunzipSync(await msFile(url)).toString("utf8"); } catch (e) { console.warn("Microsoft file", q, e.message); continue; }
      for (const line of txt.split("\n")) {
        if (!line) continue;
        // quick bbox test on the first coordinate before JSON.parse
        const m = /\[\[\[(-?[\d.]+), (-?[\d.]+)/.exec(line); if (!m) continue;
        const x = +m[1], y = +m[2];
        if (!list.some((s) => Math.abs(s.lng - x) < PAD_LNG * 3 && Math.abs(s.lat - y) < PAD_LAT * 3)) continue;
        let f; try { f = JSON.parse(line); } catch { continue; }
        const g = f.geometry; if (!g) continue;
        const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;
        if (polys) shapes.push({ id: "ms", tags: {}, polys, building: true });
      }
    }
    for (const s of list) {
      const b = pickBuilding({ id: s.id, lat: s.lat, lng: s.lng, osm: null }, shapes);
      if (b) out[s.id] = { k: "ms-" + b.k, polys: b.polys };
    }
    console.log(`Microsoft ${q}: ${shapes.length} buildings near ${list.length} spots, ${list.filter((s) => out[s.id]).length} found`);
  }
  return out;
}

/* ---------- spots ---------- */
async function loadSuggestions() {
  const f = opt("--suggestions");
  if (f && f !== true) return readJSON(resolve(f), []);
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/rest/v1/place_suggestions?status=eq.ok&select=bar_id,lat,lng",
      { headers: { apikey: key, Authorization: "Bearer " + key } });
    if (!r.ok) { console.warn("place_suggestions", r.status); return []; }
    return await r.json();
  } catch (e) { console.warn("place_suggestions", e.message); return []; }
}
const placeId = (lat, lng) => "pl_" + Math.round(lat * 1e5) + "_" + Math.round(lng * 1e5);
async function loadSpots() {
  const bars = await readJSON(join(DOCS, "bars.json"), []);
  const extra = await readJSON(join(DOCS, "bars-extra.json"), []);
  const closed = new Set((await readJSON(join(DOCS, "bars-closed.json"), [])).map((c) => String(c.id)));
  const sugg = await loadSuggestions();
  const out = new Map();
  const add = (id, lat, lng) => {
    id = String(id); if (!id || closed.has(id) || typeof lat !== "number" || typeof lng !== "number" || out.has(id)) return;
    const osm = /^[nwr]\d+$/.test(id) ? id : null;
    out.set(id, { id, lat, lng, osm: osm && osm[0] !== "n" ? osm : null });
  };
  for (const b of bars) add(b.id, b.lat, b.lng);
  for (const b of extra) add(b.id, b.lat, b.lng);
  for (const s of sugg) add(s.bar_id, +s.lat, +s.lng);
  if (opt("--places")) for (const p of await readJSON(join(DOCS, "places.json"), [])) if (Array.isArray(p)) add(placeId(p[1], p[2]), p[1], p[2]);
  return [...out.values()];
}

/* ---------- output ---------- */
export async function writeTiles(state, outDir) {
  await mkdir(outDir, { recursive: true });
  const byGeom = new Map();   // same building for several spots → one feature
  for (const [id, s] of Object.entries(state)) {
    if (!s || !s.g) continue;
    const key = JSON.stringify(s.g);
    const cur = byGeom.get(key);
    if (cur) cur.ids.push(id); else byGeom.set(key, { ids: [id], s });
  }
  const tiles = new Map();
  for (const { ids, s } of byGeom.values()) {
    ids.sort();
    const k = Math.floor(s.lat / TILE_LAT) + "_" + Math.floor(s.lng / TILE_LNG);
    const props = { bar_id: ids[0], k: s.k }; if (ids.length > 1) props.also = ids.slice(1);
    const geometry = s.g.length === 1 ? { type: "Polygon", coordinates: s.g[0] } : { type: "MultiPolygon", coordinates: s.g };
    (tiles.get(k) || tiles.set(k, []).get(k)).push({ type: "Feature", properties: props, geometry });
  }
  const keep = new Set(["index.json"]), t = {};
  let n = 0;
  for (const [k, feats] of [...tiles.entries()].sort()) {
    feats.sort((a, b) => (a.properties.bar_id < b.properties.bar_id ? -1 : 1));
    keep.add(k + ".json"); t[k] = feats.length; n += feats.length;
    await writeFile(join(outDir, k + ".json"), JSON.stringify({ type: "FeatureCollection", features: feats }));
  }
  for (const f of await readdir(outDir)) if (f.endsWith(".json") && !keep.has(f)) await unlink(join(outDir, f));
  await writeFile(join(outDir, "index.json"), JSON.stringify({ v: 1, d: [TILE_LAT, TILE_LNG], n, t }));
  return { tiles: tiles.size, features: n };
}

async function main() {
  const reg = opt("--region") || "dalarna";
  const box = REGIONS[reg] || String(reg).split(",").map(Number);
  if (box.length !== 4 || box.some((v) => !isFinite(v))) throw new Error("bad --region");
  const [S, W, N, E] = box;
  const state = await readJSON(STATE, {});
  const spots = await loadSpots();
  const ids = new Set(spots.map((s) => s.id));
  for (const id of Object.keys(state)) if (!ids.has(id)) delete state[id];   // gone from the lists (closed, removed)
  const old = Date.now() - REFRESH_DAYS * 86400e3;
  const due = spots.filter((s) => s.lat >= S && s.lat <= N && s.lng >= W && s.lng <= E &&
    (!state[s.id] || state[s.id].at < old || Math.abs(state[s.id].lat - s.lat) > 1e-4 || Math.abs(state[s.id].lng - s.lng) > 1e-4));
  // Oldest first (new spots have at = 0), grouped by cell.
  const cells = new Map();
  for (const s of due) {
    const k = Math.floor(s.lat / CELL_LAT) + "_" + Math.floor(s.lng / CELL_LNG);
    (cells.get(k) || cells.set(k, []).get(k)).push(s);
  }
  const order = [...cells.entries()].sort((a, b) => Math.min(...a[1].map((s) => (state[s.id] || {}).at || 0)) - Math.min(...b[1].map((s) => (state[s.id] || {}).at || 0)));
  console.log(`${spots.length} spots, ${due.length} due in ${reg}, ${cells.size} cells, max ${MAX_CALLS} calls`);
  if (DRY) return;
  let done = 0, found = 0;
  const kinds = {};
  for (const [k, list] of order) {
    if (calls >= MAX_CALLS) break;
    const [cy, cx] = k.split("_").map(Number);
    const json = await mapCall(cy * CELL_LAT - MARGIN, cx * CELL_LNG - MARGIN * 2, (cy + 1) * CELL_LAT + MARGIN, (cx + 1) * CELL_LNG + MARGIN * 2);
    const shapes = parseMap(json);
    for (const s of list) {
      const b = pickBuilding(s, shapes);
      state[s.id] = { at: Date.now(), lat: s.lat, lng: s.lng, k: b ? b.k : null, g: b ? cleanPolys(b.polys) : null };
      done++; if (b) { found++; kinds[b.k] = (kinds[b.k] || 0) + 1; }
    }
    if (done % 50 < list.length) console.log(`… ${done}/${due.length} spots, ${found} buildings, ${calls} calls`);
    if (calls % 40 === 0) await writeFile(STATE, JSON.stringify(state));
  }
  // Spots with no OSM building: Microsoft footprints (also earlier misses, so they get one without waiting 28 days).
  if (!opt("--no-ms")) {
    const miss = spots.filter((s) => state[s.id] && !state[s.id].g && !state[s.id].ms && s.lat >= S && s.lat <= N && s.lng >= W && s.lng <= E);
    if (miss.length) {
      const got = await msPass(miss);
      for (const s of miss) {
        state[s.id].ms = Date.now();
        const b = got[s.id];
        if (b) { state[s.id].k = b.k; state[s.id].g = cleanPolys(b.polys); found++; kinds[b.k] = (kinds[b.k] || 0) + 1; }
      }
    }
  }
  await writeFile(STATE, JSON.stringify(state));
  const r = await writeTiles(state, OUT);
  console.log(`Checked ${done} spots (${found} with a building: ${JSON.stringify(kinds)}) in ${calls} calls. ` +
    `Wrote ${r.features} buildings in ${r.tiles} tiles to ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
