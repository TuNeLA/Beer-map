#!/usr/bin/env node
// Fetch all bars/pubs/nightclubs/biergartens in Sweden from OpenStreetMap (Overpass)
// and write docs/bars.json as [{id,name,lat,lng,type}]. Node 18+ (global fetch). Run weekly by .github/workflows/bars.yml.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../docs/bars.json");
const endpoint = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

const query = `[out:json][timeout:180];
area["ISO3166-1"="SE"][admin_level=2]->.se;
(
  node["amenity"~"^(bar|pub|nightclub|biergarten)$"](area.se);
  way["amenity"~"^(bar|pub|nightclub|biergarten)$"](area.se);
);
out center tags;`;

const r5 = (v) => Math.round(v * 1e5) / 1e5;

// Polite client: identify ourselves, give the server time, retry a few times with back-off.
const UA = "OlNu-bars/1.1 (+https://github.com/TuNeLA/Beer-map; weekly fetch of Swedish bars)";
const TIMEOUT_MS = 10 * 60 * 1000; // generous: whole-country query can take minutes
const mirrors = [endpoint, "https://overpass.kumi.systems/api/interpreter"];

async function fetchOnce(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
      body: "data=" + encodeURIComponent(query),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let json = null;
let lastErr = null;
for (let attempt = 0; attempt < 4 && !json; attempt++) {
  const url = mirrors[attempt % mirrors.length];
  try {
    console.log(`Fetching bars from ${url} (attempt ${attempt + 1})…`);
    json = await fetchOnce(url);
  } catch (e) {
    lastErr = e;
    console.error(String(e && e.message || e));
    if (attempt < 3) await new Promise((r) => setTimeout(r, 30000 * (attempt + 1)));
  }
}
if (!json) {
  console.error("Giving up:", lastErr && lastErr.message);
  process.exit(1);
}
// Places we know are closed (OSM is not always up to date). Edit docs/bars-closed.json to add more.
let closed = new Set();
try {
  const { readFile } = await import("node:fs/promises");
  const list = JSON.parse(await readFile(resolve(here, "../docs/bars-closed.json"), "utf8"));
  closed = new Set(list.map((x) => x.id));
} catch (_e) { /* no list: keep all */ }
const seen = new Set();
const bars = [];
for (const el of json.elements || []) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) continue;
  const id = el.type[0] + el.id; // "n123" / "w456", same ids as the in-app Overpass fallback
  if (seen.has(id) || closed.has(id)) continue;
  seen.add(id);
  const t = el.tags || {};
  bars.push({ id, name: t.name ?? null, lat: r5(lat), lng: r5(lng), type: t.amenity || "bar" });
}
bars.sort((a, b) => a.lat - b.lat || a.lng - b.lng);
// Safety: Sweden has thousands of bars. A tiny result means a broken query; keep the old file.
if (bars.length < 500) {
  console.error(`Only ${bars.length} bars returned; not writing ${out}.`);
  process.exit(1);
}
await writeFile(out, JSON.stringify(bars));
console.log(`Wrote ${bars.length} bars to ${out}`);
