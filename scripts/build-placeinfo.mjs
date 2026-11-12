#!/usr/bin/env node
// Build docs/placeinfo/ (place card data: hours, cuisine, takeaway / outdoor / diet / wheelchair flags, website, phone) from the
// raw Overpass answers that scripts/fetch-places.mjs and scripts/fetch-bars.mjs save when OSM_RAW_DIR is set (no extra Overpass
// load), plus the optional Overture gap filler (OVERTURE_JSON, scripts/overture-se.py). Row format: scripts/placeinfo.mjs.
// Output: docs/placeinfo/index.json { v, b, n, t } (same tree as docs/places/index.json) + docs/placeinfo/<key>.json { id: row }.
//   ids: restaurants / cafés / fast food = "pl_<lat*1e5>_<lng*1e5>" (as docs/js/bars.js), bars = OSM "n123" / "w456" (as bars.json).
// The app loads ONE small tile when a card opens (docs/js/placecard.js). Run weekly by .github/workflows/bars.yml.
// Usage: OSM_RAW_DIR=<dir> [OVERTURE_JSON=<file>] node scripts/build-placeinfo.mjs [outDir=docs/placeinfo]
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { gzipSync } from "node:zlib";
import { r5, placeId, infoRow, ovIndex, ovMatch, fillFromOverture, infoTiles } from "./placeinfo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] || join(here, "../docs/placeinfo"));
const raw = process.env.OSM_RAW_DIR;
if (!raw) { console.error("OSM_RAW_DIR is not set: nothing to build."); process.exit(1); }
const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
const now = new Date();

let ov = null, ovRelease = "";
if (process.env.OVERTURE_JSON) {
  try { const o = await readJson(process.env.OVERTURE_JSON); ov = ovIndex(o.food); ovRelease = o.release || ""; }
  catch (e) { console.log("::warning::No Overture file (" + (e && e.message) + "): OSM only."); }
}
let closed = new Set();
try { closed = new Set((await readJson(join(here, "../docs/bars-closed.json"))).map((x) => x.id)); } catch (e) { /* none */ }

const entries = [], seen = new Set(), ids = new Set();
const stat = { places: 0, bars: 0, hours: 0, cuisine: 0, ovFill: 0, web: 0, phone: 0 };
function add(id, lat, lng, row) {
  if (!row || ids.has(id)) return;
  ids.add(id);
  entries.push([id, lat, lng, row]);
  if (row[0]) stat.hours++;
  if (row[1]) stat.cuisine++;
  if (row[3]) stat.web++;
  if (row[4]) stat.phone++;
  if (row[5]) stat.ovFill++;
}
for (const [file, kind] of [["places.json", "place"], ["bars.json", "bar"]]) {
  let j;
  try { j = await readJson(join(raw, file)); } catch (e) { console.error(`No ${file} in ${raw}: ${e.message}`); process.exit(1); }
  for (const el of j.elements || []) {
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon, t = el.tags || {};
    if (lat == null || lng == null) continue;
    const oid = el.type[0] + el.id;
    if (seen.has(oid)) continue;
    seen.add(oid);
    const name = (t.name || "").trim();
    if (kind === "place") {
      if (!name || !/^(restaurant|fast_food|cafe)$/.test(t.amenity || "")) continue;
      const la = r5(lat), lo = r5(lng);
      stat.places++;
      add(placeId(la, lo), la, lo, fillFromOverture(infoRow(t, now, true), ovMatch(ov, name, la, lo)));
    } else {
      if (!/^(bar|pub|nightclub|biergarten)$/.test(t.amenity || "") || closed.has(oid)) continue;
      stat.bars++;
      const la = r5(lat), lo = r5(lng);
      add(oid, la, lo, fillFromOverture(infoRow(t, now, false), name ? ovMatch(ov, name, la, lo) : null));
    }
  }
}
console.log(`places ${stat.places}, bars ${stat.bars}, rows ${entries.length}, hours ${stat.hours}, cuisine ${stat.cuisine}, ` +
  `website ${stat.web}, phone ${stat.phone}, Overture-filled ${stat.ovFill}${ovRelease ? " (Overture " + ovRelease + ")" : ""}`);
if (entries.length < 3000) { console.error("Too few rows (broken input?): keeping the old docs/placeinfo/."); process.exit(1); }

const { index, files } = infoTiles(entries);
await mkdir(outDir, { recursive: true });
const keep = new Set(["index.json"]);
let bytes = 0, gz = 0, maxB = 0, maxGz = 0;
for (const [key, obj] of files) {
  const s = JSON.stringify(obj), g = gzipSync(s).length;
  bytes += s.length; gz += g; maxB = Math.max(maxB, s.length); maxGz = Math.max(maxGz, g);
  keep.add(key + ".json");
  await writeFile(join(outDir, key + ".json"), s);
}
for (const f of await readdir(outDir)) if (f.endsWith(".json") && !keep.has(f)) await unlink(join(outDir, f));
const ix = JSON.stringify(index);
await writeFile(join(outDir, "index.json"), ix);
console.log(`Wrote ${files.size} tiles to ${outDir}: total ${bytes} B (gzip ${gz} B), largest tile ${maxB} B (gzip ${maxGz} B), ` +
  `index ${ix.length} B (gzip ${gzipSync(ix).length} B)`);
