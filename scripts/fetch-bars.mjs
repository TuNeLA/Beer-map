#!/usr/bin/env node
// Fetch all bars/pubs/nightclubs/biergartens in Sweden from OpenStreetMap (Overpass)
// and write docs/bars.json as [{id,name,lat,lng,type}]. Node 18+ (global fetch).
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

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "olnu-fetch-bars/1.0" },
  body: "data=" + encodeURIComponent(query),
});
if (!res.ok) {
  console.error(`Overpass error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const json = await res.json();
const seen = new Set();
const bars = [];
for (const el of json.elements || []) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) continue;
  const id = el.type[0] + el.id; // "n123" / "w456", same ids as the in-app Overpass fallback
  if (seen.has(id)) continue;
  seen.add(id);
  const t = el.tags || {};
  bars.push({ id, name: t.name ?? null, lat: r5(lat), lng: r5(lng), type: t.amenity || "bar" });
}
bars.sort((a, b) => a.lat - b.lat || a.lng - b.lng);
await writeFile(out, JSON.stringify(bars));
console.log(`Wrote ${bars.length} bars to ${out}`);
