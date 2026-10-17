#!/usr/bin/env node
// Split docs/places.json ([[name, lat, lng, t], …]) into small tiles that the app loads on demand
// for the map view (docs/js/bars.js). Output:
//   docs/places/index.json  = { v, b: [baseLatDeg, baseLngDeg], n, t: { "<by>_<bx>": tree } }
//       tree = 1 (a leaf file) | [c0, c1, c2, c3] (2x2 children: 0 south-west, 1 south-east, 2 north-west, 3 north-east;
//              each child is 0 (empty), 1 (leaf file) or again an array)
//   docs/places/<by>_<bx>[-<c>…].json = [[name, lat, lng, t], …]  (same rows and 5 decimals as places.json,
//       so place ids "pl_<lat*1e5>_<lng*1e5>" stay the same as the server's bars_lite ids)
// A tile with more than MAX rows is split 2x2 (up to MAX_DEPTH levels). Old tile files are removed.
// Usage: node scripts/places-tiles.mjs [in=docs/places.json] [outDir=docs/places]
// Also called by scripts/fetch-places.mjs after a new places.json is written.
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

export const BASE_LAT = 0.5, BASE_LNG = 1, MAX = 600, MAX_DEPTH = 6;

export async function writePlaceTiles(places, outDir) {
  await mkdir(outDir, { recursive: true });
  const files = new Map();   // key -> rows
  function build(rows, key, s, w, h, wd, depth) {
    if (!rows.length) return 0;
    if (rows.length <= MAX || depth >= MAX_DEPTH) { files.set(key, rows); return 1; }
    const mh = s + h / 2, mw = w + wd / 2, kids = [[], [], [], []];
    for (const p of rows) kids[(p[1] >= mh ? 2 : 0) + (p[2] >= mw ? 1 : 0)].push(p);
    return kids.map((k, i) => build(k, key + "-" + i, i >= 2 ? mh : s, i % 2 ? mw : w, h / 2, wd / 2, depth + 1));
  }
  const base = new Map();
  for (const p of places) {
    if (!Array.isArray(p) || typeof p[1] !== "number" || typeof p[2] !== "number") continue;
    const k = Math.floor(p[1] / BASE_LAT) + "_" + Math.floor(p[2] / BASE_LNG);
    (base.get(k) || base.set(k, []).get(k)).push(p);
  }
  const tree = {};
  for (const [k, rows] of [...base.entries()].sort()) {
    const [by, bx] = k.split("_").map(Number);
    tree[k] = build(rows, k, by * BASE_LAT, bx * BASE_LNG, BASE_LAT, BASE_LNG, 0);
  }
  const keep = new Set(["index.json"]);
  for (const [key, rows] of files) {
    rows.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    keep.add(key + ".json");
    await writeFile(join(outDir, key + ".json"), JSON.stringify(rows));
  }
  for (const f of await readdir(outDir)) if (f.endsWith(".json") && !keep.has(f)) await unlink(join(outDir, f));
  const index = { v: 1, b: [BASE_LAT, BASE_LNG], n: places.length, t: tree };
  await writeFile(join(outDir, "index.json"), JSON.stringify(index));
  return { files: files.size, rows: places.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const inFile = resolve(process.argv[2] || join(here, "../docs/places.json"));
  const outDir = resolve(process.argv[3] || join(here, "../docs/places"));
  const places = JSON.parse(await readFile(inFile, "utf8"));
  const r = await writePlaceTiles(places, outDir);
  console.log(`Wrote ${r.files} place tiles (${r.rows} places) to ${outDir}`);
}
