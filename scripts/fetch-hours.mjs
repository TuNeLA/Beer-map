#!/usr/bin/env node
// ⏰ Opening hours from OpenStreetMap (Overpass) for Öl Nu (CONTRACT "⏰ ÖPPETTIDER · 🍾 SYSTEMET · 💰 PRIS · 🚪 ENTRÉ · 🌭 NATTMAT").
// Writes (Node 18+, global fetch; run weekly by .github/workflows/hours.yml):
//   docs/hours.json         { v, at, bars: { "<bars.json id>": [Mo..Su] }, age: { id: min_age }, nm: [[name, lat, lng, t, [Mo..Su]], …] }
//                           bars = bar | pub | nightclub | biergarten with a usable opening_hours tag.
//                           nm (🌭 nattmat) = fast food, pizza / kebab / burger / korv restaurants and 7-Eleven / Pressbyrån style
//                           shops that are open after 01:00 on at least one day (t = f fast food | r restaurant | k kiosk).
//   docs/systembolaget.json { v, at, stores: [[name, lat, lng, [Mo..Su], guess 0|1], …] } (shop=alcohol, brand Systembolaget).
// A day is "start-end" in minutes after the day's 00:00 ("960-1620" = 16:00–03:00), several joined with ",", "" = closed.
// Parsing: scripts/oh-parse.mjs (minimal, no dependency). Month rules use the build date, so the weekly run follows seasons.
// Env OVERPASS_URL overrides the first mirror. Safety floors keep the old files when Overpass returns too little.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseOH, packW, lateClose } from "./oh-parse.mjs";
import { mergeSystembolaget } from "./placeinfo.mjs";   // placesdata: Overture stores + source column

const here = dirname(fileURLToPath(import.meta.url));
const OUT_H = resolve(here, "../docs/hours.json");
const OUT_S = resolve(here, "../docs/systembolaget.json");
// OVERPASS_ONLY=1 uses only OVERPASS_URL. HOURS_CACHE=<dir> keeps each answered query (local re-runs after a mirror timeout).
const mirrors = process.env.OVERPASS_ONLY && process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] :
  [process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const UA = "OlNu-hours/1.0 (+https://github.com/TuNeLA/Beer-map; weekly fetch of Swedish opening hours)";

// Several small queries (a big one times out on the public mirrors); the elements are merged.
const AREA = `[out:json][timeout:180];area["ISO3166-1"="SE"][admin_level=2]->.se;`;
const queries = [
  `nwr["amenity"~"^(bar|pub|nightclub|biergarten)$"]["opening_hours"](area.se);`,
  `nwr["amenity"="nightclub"]["min_age"](area.se);`,   // optional (index 1): a failure only loses the club ages
  `nwr["amenity"="fast_food"]["opening_hours"](area.se);`,
  `(nwr["amenity"="restaurant"]["cuisine"~"pizza|kebab|burger|hot_dog|sausage|falafel|shawarma|grill",i]["opening_hours"](area.se);` +
    `nwr["shop"="convenience"]["opening_hours"]["brand"~"7-Eleven|Pressbyrån|MyWay",i](area.se););`,
  `(nwr["shop"="alcohol"]["brand"~"Systembolaget",i](area.se);nwr["shop"~"^(alcohol|wine|alcohol;beverages)$"]["name"~"Systembolaget",i](area.se);nwr["shop"="alcohol"]["operator"~"Systembolaget",i](area.se););`,
].map((q) => AREA + q + "out center tags;");

const r5 = (v) => Math.round(v * 1e5) / 1e5;
async function fetchOnce(url, query) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8 * 60 * 1000);
  try {
    const res = await fetch(url, { method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
      body: "data=" + encodeURIComponent(query) });
    if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
const json = { elements: [] };
for (const [qi, query] of queries.entries()) {
  let got = null, lastErr = null;
  const cacheFile = process.env.HOURS_CACHE ? resolve(process.env.HOURS_CACHE, "q" + qi + ".json") : null;
  if (cacheFile) { try { got = JSON.parse(await readFile(cacheFile, "utf8")); console.log(`Query ${qi + 1}: cached`); } catch (e) { got = null; } }
  for (let attempt = 0; attempt < 6 && !got; attempt++) {
    const url = mirrors[attempt % mirrors.length];
    try { console.log(`Query ${qi + 1}/${queries.length} from ${url} (attempt ${attempt + 1})…`); got = await fetchOnce(url, query); }
    catch (e) { lastErr = e; console.error(String(e && e.message || e).slice(0, 120)); if (attempt < 5) await new Promise((r) => setTimeout(r, 15000 * (attempt + 1))); }
  }
  if (!got && qi === 1) { console.error("Skipping the optional min_age query."); continue; }
  if (!got) { console.log("::warning::Overpass unreachable (" + (lastErr && lastErr.message) + "): keeping last week's hours.json / systembolaget.json"); process.exit(0); }
  if (cacheFile) await writeFile(cacheFile, JSON.stringify(got)).catch(() => {});
  json.elements.push(...(got.elements || []));
  await new Promise((r) => setTimeout(r, 3000));
}
const now = new Date();
const bars = {}, age = {}, nm = [], stores = [];
const seen = new Set();
let bad = 0;
// Systembolaget's normal week (most stores): used when a store has no opening_hours in OSM (guess = 1 → "brukar").
const SB_DEFAULT = parseOH("Mo-Fr 10:00-19:00; Sa 10:00-15:00; Su off", now).w;
for (const el of json.elements || []) {
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) continue;
  const id = el.type[0] + el.id;
  if (seen.has(id)) continue;
  seen.add(id);
  const t = el.tags || {};
  const oh = t.opening_hours ? parseOH(t.opening_hours, now) : null;
  if (t.opening_hours && !oh) bad++;
  if (/^(alcohol|wine|alcohol;beverages)$/.test(t.shop || "")) {
    if (!/systembolaget/i.test((t.brand || "") + " " + (t.name || "") + " " + (t.operator || "")) || /ombud/i.test(t.name || "")) continue;   // ombud = pick-up point, other hours
    const nm0 = (t.name || "Systembolaget").replace(/\s+/g, " ").trim().slice(0, 60);
    const ad = [[t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" "), t["addr:city"] || t["addr:place"]].filter(Boolean).join(", ").slice(0, 80);
    stores.push([nm0, r5(lat), r5(lng), packW(oh ? oh.w : SB_DEFAULT), oh ? 0 : 1, ad]);   // [5] = address (optional, "" when OSM has none)
    continue;
  }
  if (/^(bar|pub|nightclub|biergarten)$/.test(t.amenity || "")) {
    if (oh) bars[id] = packW(oh.w);
    const a = parseInt(t.min_age, 10);
    if (t.amenity === "nightclub" && a >= 18 && a <= 30) age[id] = a;
    continue;
  }
  if (!oh || !t.name) continue;
  // 🌭 open after 01:00 on some day (or 24/7)
  if (!oh.a && lateClose(oh.w) <= 1500) continue;
  const code = t.shop ? "k" : t.amenity === "fast_food" ? "f" : "r";
  nm.push([t.name.replace(/\s+/g, " ").trim().slice(0, 60), r5(lat), r5(lng), code, packW(oh.w)]);
}
nm.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
stores.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
const nb = Object.keys(bars).length;
console.log(`bars with hours ${nb}, nightclub ages ${Object.keys(age).length}, nattmat ${nm.length}, systembolaget ${stores.length}, unparsed ${bad}`);
if (nb < 150 || stores.length < 200) { console.error("Too few rows (broken query?): keeping the old files."); process.exit(1); }
await writeFile(OUT_H, JSON.stringify({ v: 1, at: now.toISOString(), bars, age, nm }));
// placesdata: Systembolaget's own location feed (PinMeTo, via Overture Maps, CDLA-Permissive-2.0) adds the stores OSM lacks
// (no OSM store within 200 m; hours = the normal week, guess = 1); a complete feed also leaves out closed / moved OSM stores.
// Row [6] = source "osm" | "ovr". OVERTURE_JSON: scripts/overture-se.py.
let ovSb = [];
if (process.env.OVERTURE_JSON) { try { ovSb = JSON.parse(await readFile(process.env.OVERTURE_JSON, "utf8")).sb || []; } catch (e) { console.log("::warning::No Overture file: OSM stores only"); } }
const allStores = mergeSystembolaget(stores, ovSb, packW(SB_DEFAULT));
const nOv = allStores.filter((r) => r[6] === "ovr").length;
console.log(`systembolaget: ${stores.length} from OSM (${allStores.dropped.length} left out: not in Systembolaget's feed) + ${nOv} from Overture = ${allStores.length}`);
for (const r of allStores.dropped) console.log("  left out (closed / moved?):", r[0], r[5] || "", r[1], r[2]);
const sbLic = "Stores: (c) OpenStreetMap contributors (ODbL 1.0)" + (nOv ? "; rows with source ovr: Systembolaget location feed by PinMeTo via Overture Maps, CDLA-Permissive-2.0 (cdla.dev/permissive-2-0)" : "");
await writeFile(OUT_S, JSON.stringify({ v: 1, at: now.toISOString(), lic: sbLic, stores: allStores }));
console.log(`Wrote ${OUT_H} and ${OUT_S}`);
