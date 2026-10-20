#!/usr/bin/env node
// Öl Nu — clean the bar list (CONTRACT "v26 EXTRAS" → "Bar list cleanup").
// Checks docs/bars.json + docs/bars-extra.json (+ docs/places tiles, docs/bars-closed.json, and optionally the
// server bars_lite list) for:
//   1. duplicates      — same (normalised) name within 150 m, or an x- extra bar that OSM already has;
//   2. closed places   — OSM element deleted, amenity gone, disused:/was:/abandoned:/removed: tags, end_date in
//                        the past, opening_hours=closed, or "stängd/nedlagd/closed" in the name;
//   3. very old data   — last OSM edit before STALE_BEFORE, version 1 and only bare tags (amenity/name/source);
//   4. wrong positions — outside Sweden, the OSM node moved > 75 m since bars.json was made, server row far from
//                        bars.json, and server rows that no longer exist in bars.json / bars-extra.json.
// Reads OSM through the editing API multi-fetch (nodes.json / ways.json, 300 ids per call, 1 call per 1.5 s,
// with a User-Agent) — about 5 calls for all of Sweden. No Overpass needed.
//
// Usage:
//   node scripts/clean-bars.mjs [--server server-bars.json] [--report out.json] [--write] [--stale]
//     --server  JSON array [[id,name,lat,lng,type,active],…] = `select json_agg(json_build_array(id,name,lat,lng,type,active))
//               from bars_lite where id not like 'pl\_%';`
//     --write   add the bad ids to docs/bars-closed.json (keeps old entries) and print the SQL UPDATE for the server
//     --stale   also treat "very old data" as closed (default: report only)
//     --offline skip the OSM calls (duplicates / positions / server diff only)
// Exit code 0. Prints a short summary; the full list goes to --report (default scripts/clean-bars-report.json).
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(here, "../docs");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : null; };
const UA = "OlNu-clean-bars/1.0 (+https://github.com/TuNeLA/Beer-map; bar list cleanup, ~5 calls)";
const STALE_BEFORE = Date.parse(process.env.STALE_BEFORE || "2015-01-01T00:00:00Z");
const BARE = new Set(["amenity", "name", "source", "created_by", "note"]);
const SE = { minLat: 55.0, maxLat: 69.1, minLng: 10.9, maxLng: 24.2 };

const readJSON = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function dist(a, b, c, d) {
  const R = 6371000, r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * R;
}
export function norm(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " och ").replace(/\b(the|pub|bar|restaurang|restaurant|och|and|nattklubb|club|krog|ab)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
export function similar(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const short = x.length < y.length ? x : y, long = x.length < y.length ? y : x;
  return short.length >= 4 && long.includes(short);
}
const CLOSED_NAME = /\b(st[äa]ngd|stängt|nedlagd|closed|f\.?\s?d\.?|tidigare|permanently closed|upphört)\b/i;
// Why an OSM element counts as closed (null = open).
export function closedWhy(el, now = Date.now()) {
  if (!el) return "deleted";
  if (el.visible === false) return "deleted";
  const t = el.tags || {};
  const am = t.amenity;
  const life = Object.keys(t).find((k) => /^(disused|was|abandoned|removed|demolished|razed|closed):/.test(k));
  if (!/^(bar|pub|nightclub|biergarten)$/.test(am || "")) {
    if (life) return "tag " + life + "=" + t[life];
    return am ? "amenity=" + am : "no amenity";
  }
  // Still a bar: a lifecycle tag only counts when it says the SAME amenity closed (disused:amenity=restaurant on a
  // working pub is the old kitchen, not the pub).
  if (life && /:amenity$/.test(life) && t[life] === am) return "tag " + life + "=" + t[life];
  if (t.end_date && Date.parse(t.end_date) < now) return "end_date " + t.end_date;
  if (/^(closed|off)$/i.test(t.opening_hours || "")) return "opening_hours=" + t.opening_hours;
  if (CLOSED_NAME.test(t.name || "")) return "name '" + t.name + "'";
  return null;
}
export function staleWhy(el) {
  if (!el || !el.timestamp) return null;
  const ts = Date.parse(el.timestamp);
  const keys = Object.keys(el.tags || {});
  if (ts < STALE_BEFORE && (el.version | 0) <= 1 && keys.every((k) => BARE.has(k)))
    return "last edit " + el.timestamp.slice(0, 10) + ", version 1, tags: " + keys.join(",");
  return null;
}

async function osmFetch(kind, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const url = `https://api.openstreetmap.org/api/0.6/${kind}s.json?${kind}s=${chunk.join(",")}`;
    for (let tries = 0; tries < 4; tries++) {
      let res;
      try { res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); } catch (e) { res = null; }
      if (res && res.ok) {
        const j = await res.json();
        (j.elements || []).forEach((e) => out.set(e.type[0] + e.id, e));
        break;
      }
      // 404/410 = one id is gone: the API answers the whole call with an error, so split it.
      if (res && (res.status === 404 || res.status === 410) && chunk.length > 1) {
        const half = Math.ceil(chunk.length / 2);
        const a = await osmFetch(kind, chunk.slice(0, half).map(String)), b = await osmFetch(kind, chunk.slice(half).map(String));
        a.forEach((v, k) => out.set(k, v)); b.forEach((v, k) => out.set(k, v));
        break;
      }
      if (res && (res.status === 404 || res.status === 410)) break;   // single deleted id → missing = deleted
      await sleep(3000 * (tries + 1));
    }
    await sleep(1500);
  }
  return out;
}

async function main() {
  const bars = await readJSON(resolve(DOCS, "bars.json"), []);
  const extra = await readJSON(resolve(DOCS, "bars-extra.json"), []);
  const closedList = await readJSON(resolve(DOCS, "bars-closed.json"), []);
  const closedIds = new Set(closedList.map((x) => x.id));
  const serverPath = opt("--server");
  const server = serverPath && serverPath !== true ? await readJSON(resolve(serverPath), null) : null;
  // places tiles: [[name, lat, lng, t]] (restaurants etc.)
  const places = [];
  try {
    for (const f of await readdir(resolve(DOCS, "places"))) {
      if (!f.endsWith(".json")) continue;
      const rows = await readJSON(resolve(DOCS, "places", f), []);
      rows.forEach((r) => Array.isArray(r) && places.push({ name: r[0], lat: r[1], lng: r[2], t: r[3] }));
    }
  } catch {}

  const all = bars.map((b) => ({ ...b, src: "bars.json" })).concat(extra.map((b) => ({ ...b, src: "bars-extra.json" })));
  const byId = new Map(all.map((b) => [b.id, b]));
  const report = { generated_at: new Date().toISOString(), counts: {}, duplicates: [], closed: [], stale: [], positions: [], server: [], places_dupes: 0 };

  // 1. Duplicates (grid buckets of ~0.01°)
  const grid = new Map(), key = (la, ln) => Math.floor(la * 100) + ":" + Math.floor(ln * 50);
  all.forEach((b) => { const k = key(b.lat, b.lng); (grid.get(k) || grid.set(k, []).get(k)).push(b); });
  const dupDrop = new Set();
  all.forEach((b) => {
    const ka = Math.floor(b.lat * 100), kb = Math.floor(b.lng * 50);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      (grid.get(ka + i + ":" + (kb + j)) || []).forEach((o) => {
        if (o.id >= b.id && !(o.src !== b.src)) return;       // each pair once (and every cross-file pair)
        if (o.id === b.id || dupDrop.has(o.id) || dupDrop.has(b.id)) return;
        const d = dist(b.lat, b.lng, o.lat, o.lng);
        // same name (case/“The” ignored) up to 150 m; a name inside the other (“Arbis” / “Arbis Altan”) only up to 25 m
        const plain = (x) => String(x || "").toLowerCase().replace(/^the\s+/, "").trim();
        if (d > 150 || !similar(b.name, o.name)) return;
        if (plain(b.name) !== plain(o.name) && d > 25) return;
        // keep: OSM over hand-made x- rows; way over node (usually the building); else the older id
        const rank = (x) => (x.id.startsWith("x-") ? 0 : x.id.startsWith("w") ? 2 : 1);
        const keep = rank(b) !== rank(o) ? (rank(b) > rank(o) ? b : o) : (b.id < o.id ? b : o), drop = keep === b ? o : b;
        dupDrop.add(drop.id);
        report.duplicates.push({ drop: drop.id, drop_name: drop.name, keep: keep.id, keep_name: keep.name, m: Math.round(d) });
      });
    }
  });
  // places that repeat a bar (client already hides them in "Var dricker du?"; count only)
  places.forEach((p) => {
    const ka = Math.floor(p.lat * 100), kb = Math.floor(p.lng * 50);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      (grid.get(ka + i + ":" + (kb + j)) || []).forEach((b) => { if (!p._d && dist(p.lat, p.lng, b.lat, b.lng) <= 80 && similar(p.name, b.name)) { p._d = 1; report.places_dupes++; } });
  });

  // 4a. Positions outside Sweden
  all.forEach((b) => {
    if (!(b.lat >= SE.minLat && b.lat <= SE.maxLat && b.lng >= SE.minLng && b.lng <= SE.maxLng))
      report.positions.push({ id: b.id, name: b.name, why: "outside Sweden", lat: b.lat, lng: b.lng });
  });

  // 2/3/4b. OSM state
  if (!opt("--offline")) {
    const nodes = all.filter((b) => /^n\d+$/.test(b.id)).map((b) => b.id.slice(1));
    const ways = all.filter((b) => /^w\d+$/.test(b.id)).map((b) => b.id.slice(1));
    const osm = new Map([...(await osmFetch("node", nodes)), ...(await osmFetch("way", ways))]);
    all.forEach((b) => {
      if (!/^[nw]\d+$/.test(b.id)) return;
      const el = osm.get(b.id);
      const why = closedWhy(el);
      if (why) { report.closed.push({ id: b.id, name: b.name, why }); return; }
      const st = staleWhy(el);
      if (st) report.stale.push({ id: b.id, name: b.name, why: st });
      if (el && el.type === "node" && isFinite(el.lat)) {
        const d = dist(b.lat, b.lng, el.lat, el.lon);
        if (d > 75) report.positions.push({ id: b.id, name: b.name, why: "OSM node moved " + Math.round(d) + " m", lat: el.lat, lng: el.lon });
      }
    });
  }

  // 4c. Server rows
  if (Array.isArray(server)) {
    server.forEach((r) => {
      const [id, name, lat, lng, , active] = r;
      if (!active) return;
      const b = byId.get(id);
      if (!b) { if (!closedIds.has(id)) report.server.push({ id, name, why: "on the server, not in bars.json / bars-extra.json" }); return; }
      const d = dist(lat, lng, b.lat, b.lng);
      if (d > 50) report.server.push({ id, name, why: "server position " + Math.round(d) + " m from bars.json (re-import)", lat: b.lat, lng: b.lng });
    });
  }

  const bad = new Map();
  report.duplicates.forEach((x) => bad.set(x.drop, { id: x.drop, name: x.drop_name, note: "Dubblett av " + x.keep + " (" + x.keep_name + ", " + x.m + " m) — clean-bars " + report.generated_at.slice(0, 10) }));
  report.closed.forEach((x) => bad.set(x.id, { id: x.id, name: x.name, note: "Stängd enligt OSM: " + x.why + " — clean-bars " + report.generated_at.slice(0, 10) }));
  if (opt("--stale")) report.stale.forEach((x) => bad.set(x.id, { id: x.id, name: x.name, note: "Mycket gammal OSM-data: " + x.why + " — clean-bars " + report.generated_at.slice(0, 10) }));
  report.server.filter((x) => /not in bars/.test(x.why)).forEach((x) => bad.set(x.id, { id: x.id, name: x.name, note: "Finns inte längre i bars.json — clean-bars " + report.generated_at.slice(0, 10) }));
  closedIds.forEach((id) => bad.delete(id));
  report.new_closed = [...bad.values()];
  report.counts = { bars: bars.length, extra: extra.length, places: places.length, duplicates: report.duplicates.length, closed: report.closed.length,
    stale: report.stale.length, positions: report.positions.length, server: report.server.length, places_dupes: report.places_dupes, new_closed: report.new_closed.length };

  const out = opt("--report");
  await writeFile(resolve(out && out !== true ? out : resolve(here, "clean-bars-report.json")), JSON.stringify(report, null, 1) + "\n");
  if (opt("--write") && report.new_closed.length) {
    const merged = closedList.concat(report.new_closed);
    await writeFile(resolve(DOCS, "bars-closed.json"), "[\n" + merged.map((x) => "  " + JSON.stringify(x)).join(",\n") + "\n]\n");
  }
  const ids = closedList.map((x) => x.id).concat(report.new_closed.map((x) => x.id));
  console.log(JSON.stringify(report.counts));
  if (ids.length) console.log("-- server:\nupdate public.bars_lite set active = false, updated_at = now() where active and id in (" + ids.map((i) => "'" + i.replace(/'/g, "''") + "'").join(", ") + ");\nselect public.olnu_resnap();");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
