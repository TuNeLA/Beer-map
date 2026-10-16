#!/usr/bin/env node
// Fetch named restaurants, fast food places and cafés in Sweden from OpenStreetMap (Overpass)
// and write docs/places.json as [[name, lat, lng, t], …] with t = r (restaurant) | f (fast_food) | c (cafe).
// The app uses it only to name the spot where someone drinks ("nära Pizzeria X"), never to draw markers.
// Node 18+ (global fetch). Run weekly by .github/workflows/bars.yml.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../docs/places.json");
const endpoint = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

const query = `[out:json][timeout:240];
area["ISO3166-1"="SE"][admin_level=2]->.se;
(
  node["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](area.se);
  way["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](area.se);
);
out center tags;`;

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const CODE = { restaurant: "r", fast_food: "f", cafe: "c" };

const UA = "OlNu-places/1.0 (+https://github.com/TuNeLA/Beer-map; weekly fetch of Swedish restaurant names)";
const TIMEOUT_MS = 10 * 60 * 1000;
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
    console.log(`Fetching places from ${url} (attempt ${attempt + 1})…`);
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

const seen = new Set();
const places = [];
for (const el of json.elements || []) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const t = el.tags || {};
  const name = (t.name || "").trim();
  if (lat == null || lng == null || !name) continue;
  const id = el.type[0] + el.id;
  if (seen.has(id)) continue;
  seen.add(id);
  places.push([name.slice(0, 60), r5(lat), r5(lng), CODE[t.amenity] || "r"]);
}
places.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
// Safety: Sweden has many thousands of restaurants. A tiny result means a broken query; keep the old file.
if (places.length < 3000) {
  console.error(`Only ${places.length} places returned; not writing ${out}.`);
  process.exit(1);
}
await writeFile(out, JSON.stringify(places));
console.log(`Wrote ${places.length} places to ${out}`);
