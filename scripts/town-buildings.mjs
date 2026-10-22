#!/usr/bin/env node
// Öl Nu — 🏙️ town buildings for the 3D map (CONTRACT "KARTSTIL 4 · 3D hus").
// Mapbox has almost no buildings in small Swedish towns (Ludvika: none), so on the Mapbox styles js/map3d.js extrudes
// OUR footprints: every building of a town, not only the bars. This script writes them as small GeoJSON tiles.
//
// Sources (both ODbL):
//   1. OpenStreetMap buildings (the OSM editing API "map" call per cell; Overpass is not used). Height from
//      height=* / building:levels=* / the building type.
//   2. Microsoft Global ML Building Footprints (dataset-links.csv → one gzipped GeoJSON-lines file per zoom-9 quadkey).
//      A Microsoft footprint is skipped when it overlaps an OSM building (its centre in an OSM house, or an OSM
//      house centre in it). Microsoft heights are -1 (unknown) in Sweden, so the height comes from the area.
// OSM API usage policy: a clear User-Agent, ONE request at a time, ≥ 1.5 s apart, back off on 429/509/5xx.
// A town of ~0.06° × 0.14° is ~12 small calls. Run it by hand (or on dispatch) when a town is added, not weekly.
//
// Output (docs/buildings3d/):
//   index.json      = { v: 1, d: [0.02, 0.04], n, towns: { <name>: [s, w, n, e] }, t: { "<floor(lat/0.02)>_<floor(lng/0.04)>": count } }
//   <ty>_<tx>.json  = FeatureCollection; Polygon features, properties { h: height m (int) }, rings simplified (0.3 m),
//                     6 decimals. A feature goes into the tile of its first point. Other towns' tiles are kept.
// Usage:
//   node scripts/town-buildings.mjs [--town ludvika | --bbox s,w,n,e --name x] [--delay 1500] [--no-ms] [--dry]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../docs/buildings3d");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : null; };
const UA = "OlNu-town-buildings/1.0 (+https://github.com/TuNeLA/Beer-map; by hand, ~12 small map calls per town, 1 at a time)";
const API = "https://api.openstreetmap.org/api/0.6/map.json";
const MS_LINKS = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv";
const DELAY = +(opt("--delay") || 1500);
const TOWNS = { ludvika: [60.118, 15.115, 60.182, 15.262] };
const D = [0.02, 0.04];
const RAD = Math.PI / 180;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let name = opt("--town") || "ludvika", box = TOWNS[name];
if (opt("--bbox")) { box = String(opt("--bbox")).split(",").map(Number); name = String(opt("--name") || "bbox"); }
if (!box || box.length !== 4 || box.some((x) => !isFinite(x))) { console.error("unknown --town / bad --bbox"); process.exit(1); }
const [S, W, N, E] = box;

/* ---------- geometry ---------- */
function area(r, lat) {   // m², ring [[lng, lat]…]
  const kx = 111320 * Math.cos(lat * RAD), ky = 110540; let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * kx) * (r[i][1] * ky) - (r[i][0] * kx) * (r[j][1] * ky);
  return Math.abs(a / 2);
}
function centre(r) { let x = 0, y = 0; const n = r.length - 1 || 1; for (let i = 0; i < n; i++) { x += r[i][0]; y += r[i][1]; } return [x / n, y / n]; }
function inside(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}
function simplify(r, lat, tol) {   // Douglas–Peucker in metres, keeps the ring closed
  const kx = 111320 * Math.cos(lat * RAD), ky = 110540;
  if (r.length <= 5) return r;
  const keep = new Uint8Array(r.length); keep[0] = keep[r.length - 1] = 1;
  const st = [[0, r.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const ax = r[a][0] * kx, ay = r[a][1] * ky, bx = r[b][0] * kx, by = r[b][1] * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const px = r[i][0] * kx - ax, py = r[i][1] * ky - ay;
      const t = L2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  const out = r.filter((p, i) => keep[i]);
  return out.length >= 4 ? out : r;
}
const r6 = (p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];

/* ---------- heights ---------- */
const LOW = /^(garage|garages|shed|carport|hut|roof|cabin|greenhouse|kiosk|toilets|service|barn|boathouse|bunker|container|allotment_house|transformer_tower)$/;
function byArea(m2) { return m2 < 30 ? 3 : m2 < 80 ? 4 : m2 < 200 ? 6 : m2 < 600 ? 8 : m2 < 2000 ? 10 : m2 < 6000 ? 12 : 14; }
function heightOf(tags, m2) {
  const h = parseFloat(String(tags.height || "").replace(",", "."));
  if (isFinite(h) && h > 1 && h < 300) return Math.round(h);
  const lv = parseFloat(tags["building:levels"]);
  if (isFinite(lv) && lv > 0 && lv < 80) return Math.round(lv * 3.1 + 1 + (tags["roof:levels"] ? 1.5 : 0));
  const b = tags.building || "";
  if (LOW.test(b)) return 3;
  if (/^(house|detached|semidetached_house|terrace|bungalow|farm)$/.test(b)) return Math.min(byArea(m2), 7);
  if (b === "apartments") return Math.max(12, byArea(m2));
  if (/^(church|cathedral|chapel)$/.test(b)) return 14;
  if (/^(industrial|warehouse|manufacture|hangar)$/.test(b)) return Math.max(8, Math.min(byArea(m2), 12));
  if (/^(commercial|retail|office|hotel|public|civic|school|hospital|university|train_station)$/.test(b)) return Math.max(9, byArea(m2));
  return byArea(m2);
}

/* ---------- OSM ---------- */
let lastCall = 0, calls = 0;
async function mapCall(s, w, n, e, depth = 0) {
  const wait = lastCall + DELAY - Date.now(); if (wait > 0) await sleep(wait);
  const url = `${API}?bbox=${w.toFixed(6)},${s.toFixed(6)},${e.toFixed(6)},${n.toFixed(6)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    lastCall = Date.now(); calls++;
    let res = null;
    try { res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); } catch { res = null; }
    if (res && res.ok) return res.json();
    const st = res ? res.status : 0;
    if (st === 400 && depth < 3) {
      const mh = (s + n) / 2, mw = (w + e) / 2, parts = [];
      for (const [a, b, c, d] of [[s, w, mh, mw], [s, mw, mh, e], [mh, w, n, mw], [mh, mw, n, e]]) parts.push(await mapCall(a, b, c, d, depth + 1));
      return { elements: parts.flatMap((p) => (p && p.elements) || []) };
    }
    const back = st === 429 || st === 509 ? 60000 : 5000 * (attempt + 1);
    console.warn(`OSM API ${st || "network"} — waiting ${back / 1000} s`); await sleep(back);
  }
  throw new Error("OSM API keeps failing");
}
async function osmBuildings() {
  const nodes = new Map(), ways = new Map(), rels = [];
  const CY = 0.02, CX = 0.035;
  for (let s = S; s < N; s += CY) for (let w = W; w < E; w += CX) {
    const d = await mapCall(s, w, Math.min(N, s + CY), Math.min(E, w + CX));
    for (const el of d.elements || []) {
      if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
      else if (el.type === "way") ways.set(el.id, el);
      else if (el.type === "relation") rels.push(el);
    }
    process.stdout.write(".");
  }
  console.log(`\nOSM: ${calls} calls, ${ways.size} ways`);
  const out = [];
  const ringOf = (w) => { const r = (w.nodes || []).map((id) => nodes.get(id)); return r.length >= 4 && r.every(Boolean) && w.nodes[0] === w.nodes[w.nodes.length - 1] ? r : null; };
  const used = new Set();
  for (const r of rels) {
    const t = r.tags || {};
    if (t.type !== "multipolygon" || !t.building || t.building === "no") continue;
    for (const m of r.members || []) {
      if (m.type !== "way" || m.role === "inner") continue;
      const w = ways.get(m.ref); const ring = w && ringOf(w); if (!ring) continue;
      used.add(m.ref); out.push({ ring, tags: Object.assign({}, t, w.tags || {}) });
    }
  }
  for (const [id, w] of ways) {
    const t = w.tags || {};
    if (used.has(id) || !t.building || t.building === "no" || t.location === "underground" || t.building === "construction") continue;
    const ring = ringOf(w); if (ring) out.push({ ring, tags: t });
  }
  return out;
}

/* ---------- Microsoft ---------- */
function quadkey(lat, lng, z) {
  const n = 2 ** z, x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * n);
  let q = ""; for (let i = z; i > 0; i--) { const m = 1 << (i - 1); q += String((x & m ? 1 : 0) + (y & m ? 2 : 0)); } return q;
}
const CACHE = join(process.env.RUNNER_TEMP || tmpdir(), "olnu-ms-buildings");
async function msBuildings() {
  const qs = new Set(); for (let y = S; y <= N + 0.01; y += 0.05) for (let x = W; x <= E + 0.01; x += 0.1) qs.add(quadkey(Math.min(y, N), Math.min(x, E), 9));
  const r = await fetch(MS_LINKS, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error("ms links " + r.status);
  const urls = (await r.text()).split("\n").map((l) => l.split(",")).filter((c) => qs.has(c[1]) && /^(Sweden|Norway|Finland)$/.test(c[0])).map((c) => c[2]);
  await mkdir(CACHE, { recursive: true });
  const out = [];
  for (const url of urls) {
    const f = join(CACHE, url.replace(/[^a-z0-9]+/gi, "_").slice(-120)); let buf;
    try { buf = await readFile(f); } catch { const x = await fetch(url, { headers: { "User-Agent": UA } }); if (!x.ok) { console.warn("ms file", x.status); continue; } buf = Buffer.from(await x.arrayBuffer()); await writeFile(f, buf); }
    for (const line of gunzipSync(buf).toString("utf8").split("\n")) {
      const m = /\[\[\[(-?[\d.]+), (-?[\d.]+)/.exec(line); if (!m) continue;
      const x = +m[1], y = +m[2]; if (y < S || y > N || x < W || x > E) continue;
      let g; try { g = JSON.parse(line).geometry; } catch { continue; }
      const rings = g && g.type === "Polygon" ? [g.coordinates[0]] : g && g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : [];
      for (const ring of rings) if (ring && ring.length >= 4) out.push({ ring, tags: {}, ms: 1 });
    }
  }
  console.log(`Microsoft: ${urls.length} file(s), ${out.length} footprints in the box`);
  return out;
}

/* ---------- main ---------- */
const osm = await osmBuildings();
let ms = [];
if (!opt("--no-ms")) { try { ms = await msBuildings(); } catch (e) { console.warn("Microsoft skipped:", e.message); } }
// grid of OSM houses (~110 m cells) for the overlap test
const G = 0.001, grid = new Map(), key = (x, y) => Math.floor(y / G) + "_" + Math.floor(x / (G * 2));
for (const b of osm) { b.c = centre(b.ring); const k = key(b.c[0], b.c[1]); (grid.get(k) || grid.set(k, []).get(k)).push(b); }
function overlaps(m) {
  const c = centre(m.ring), [cy, cx] = [Math.floor(c[1] / G), Math.floor(c[0] / (G * 2))];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const b of grid.get((cy + dy) + "_" + (cx + dx)) || []) {
    if (inside(c, b.ring) || inside(b.c, m.ring)) return true;
  }
  return false;
}
const msKept = ms.filter((m) => !overlaps(m));
console.log(`OSM ${osm.length} + Microsoft ${msKept.length} (of ${ms.length}, the rest overlap OSM)`);
const tiles = {};
let n = 0;
for (const b of osm.concat(msKept)) {
  const lat = b.ring[0][1], m2 = area(b.ring, lat);
  if (m2 < 12 || m2 > 200000) continue;
  const ring = simplify(b.ring, lat, 0.3).map(r6);
  const h = b.ms ? byArea(m2) : heightOf(b.tags, m2);
  const k = Math.floor(lat / D[0]) + "_" + Math.floor(b.ring[0][0] / D[1]);
  (tiles[k] || (tiles[k] = [])).push({ type: "Feature", properties: { h }, geometry: { type: "Polygon", coordinates: [ring] } });
  n++;
}
let ix = { v: 1, d: D, n: 0, towns: {}, t: {} };
try { const old = JSON.parse(await readFile(join(OUT, "index.json"), "utf8")); if (old && old.t) ix = Object.assign(ix, old, { d: D }); } catch {}
ix.towns = ix.towns || {}; ix.towns[name] = [S, W, N, E];
for (const k of Object.keys(ix.t)) {   // tiles fully inside this box are rewritten; tiles on the edge keep other towns' houses
  const [ty, tx] = k.split("_").map(Number);
  if (ty * D[0] >= S && (ty + 1) * D[0] <= N && tx * D[1] >= W && (tx + 1) * D[1] <= E && !tiles[k]) delete ix.t[k];
}
if (!opt("--dry")) await mkdir(OUT, { recursive: true });
let bytes = 0;
for (const k of Object.keys(tiles)) {
  let feats = tiles[k];
  const [ty, tx] = k.split("_").map(Number), whole = ty * D[0] >= S && (ty + 1) * D[0] <= N && tx * D[1] >= W && (tx + 1) * D[1] <= E;
  if (!whole) {   // edge tile: keep the old houses outside this box
    try {
      const old = JSON.parse(await readFile(join(OUT, k + ".json"), "utf8"));
      feats = old.features.filter((f) => { const p = f.geometry.coordinates[0][0]; return p[1] < S || p[1] > N || p[0] < W || p[0] > E; }).concat(feats);
    } catch {}
  }
  const txt = JSON.stringify({ type: "FeatureCollection", features: feats });
  bytes += txt.length; ix.t[k] = feats.length;
  if (!opt("--dry")) await writeFile(join(OUT, k + ".json"), txt);
}
ix.n = Object.values(ix.t).reduce((a, b) => a + b, 0); ix.at = new Date().toISOString().slice(0, 10);
if (!opt("--dry")) await writeFile(join(OUT, "index.json"), JSON.stringify(ix));
console.log(`${name}: ${n} buildings in ${Object.keys(tiles).length} tiles, ${(bytes / 1024).toFixed(0)} KB (index: ${ix.n} in ${Object.keys(ix.t).length} tiles)`);
