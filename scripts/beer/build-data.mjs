#!/usr/bin/env node
// Beer library (I-132): turn the research data (lane beerdata, ops repo research/beer-library) into small app data in docs/data/beer/.
//   node scripts/beer/build-data.mjs [research dir] [--no-img]
//   default research dir: ../pintsnow-ops/research/beer-library (next to this repo) or $PN_BEER_SRC.
// Writes (only the fields the app needs; the app loads them when the Öl tab opens):
//   docs/data/beer/styles.json   61 styles: names, family, colour, IBU / ABV ranges, taste tags, glass, serve temp, food, our texts
//   docs/data/beer/beers.json    beers: rows [id, name, brewery, style, conf, abv, af, photo, credit, group] (see COLS)
//   docs/data/beer/styles/*.svg  the style pictures (our own art)
//   docs/data/beer/img/<id>.jpg  photos (Open Food Facts, CC BY-SA): only for the beers we ship, resized to <= 300 px high
//   docs/data/beer/taps.json     bar tap lists: { v, bars: { <bar id>: [beer id, ...] } }. Empty until bars send lists (I-132 phase 3).
// Which beers ship: Sweden (beers_se), Nordic (beers_nordic) and world rows marked se_likely (a guess: sold in Sweden).
// Data rules (coordinator 19 Nov): ABV only when plausible (0 % only on an alcohol-free beer; nothing above 16 %; not far above the
// style's range); the style is a guess unless its confidence is "high" (the app says "gissning"). Nothing is made up here.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const args = process.argv.slice(2);
const SRC = resolve(args.find((a) => !a.startsWith("--")) || process.env.PN_BEER_SRC || join(REPO, "../pintsnow-ops/research/beer-library"));
const NO_IMG = args.includes("--no-img");
const OUT = join(REPO, "docs/data/beer");
const MAX_ABV = 16, IMG_H = 300, IMG_Q = 72;
export const COLS = ["id", "name", "brewery", "style", "conf", "abv", "af", "photo", "credit", "group"];
const CONF = { low: 1, medium: 2, high: 3 };
const GROUPS = ["se", "nordic", "world_se_likely"];

const rd = (p) => JSON.parse(readFileSync(join(SRC, p), "utf8"));
const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 80);
const cleanName = (s) => clean(s).replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}%)]+$/u, "");   // "‘Drink’in …" sorts under D

// ABV that we dare to show, else null
export function plausibleAbv(b, style) {
  const a = typeof b.abv === "number" && isFinite(b.abv) ? b.abv : null;
  if (a == null) return null;
  if (b.alcohol_free) return a <= 0.5 ? Math.round(a * 10) / 10 : null;
  if (a < 0.6 || a > MAX_ABV) return null;
  const r = style && style.strength && style.strength.abv;
  if (r && r[1] && a > r[1] + 4) return null;
  return Math.round(a * 10) / 10;
}

function styles() {
  const s = rd("styles/styles.json");
  const list = s.styles.map((x) => ({
    id: x.id, sv: x.name_sv, en: x.name_en, fam: x.family,
    srm: x.colour && x.colour.srm || null, hex: x.colour && x.colour.hex || null,
    ibu: x.bitterness && x.bitterness.ibu || null, abv: x.strength && x.strength.abv || null,
    tags: x.tags || [], glass: x.glass || null, serve: x.serve_c || null,
    food_sv: x.food_sv || "", food_en: x.food_en || "", text_sv: x.text_sv || "", text_en: x.text_en || "",
    ref: x.numbers_ref || "", est: !!x.numbers_are_estimate
  }));
  return { v: 1, made: s.made || null, note: "Texts: PintsNow. Numbers: " + (s.note || "").replace(/^Numbers:\s*/, "").split(". ")[0],
    tags: s.tags, families: s.families, glasses: s.glasses, styles: list, byId: Object.fromEntries(s.styles.map((x) => [x.id, x])) };
}

function beers(st) {
  const credit = {};
  for (const c of rd("beers/credits.json").credits || []) credit[c.barcode] = c;
  const files = [["beers/beers_se.json", 0, () => true], ["beers/beers_nordic.json", 1, () => true], ["beers/beers_world.json", 2, (b) => !!b.se_likely]];
  const seen = new Set(), seenName = new Set(), rows = [], photos = [];
  for (const [f, g, keep] of files) {
    if (!existsSync(join(SRC, f))) continue;
    for (const b of rd(f).beers || []) {
      if (!keep(b) || !b.barcode || !cleanName(b.name) || seen.has(b.barcode)) continue;
      const id = String(b.barcode).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40); if (!id) continue;
      const brewery = clean(b.brand, 60), raw = cleanName(b.name);
      const name = (raw.match(/\p{L}/gu) || []).length >= 2 ? raw : brewery && brewery.toLowerCase() !== raw.toLowerCase() ? cleanName(brewery + " " + raw) : "";   // "1664" -> "Kronenbourg 1664"
      if ((name.match(/\p{L}/gu) || []).length < 2) continue;
      const nk = (name + "|" + brewery).toLowerCase(); if (seenName.has(nk)) continue;
      seen.add(b.barcode); seenName.add(nk);
      const sg = b.style_guess && st.byId[b.style_guess.id] ? b.style_guess : null;
      const cr = credit[b.barcode], src = cr ? join(SRC, "beers", cr.file) : null, photo = !!(src && existsSync(src));
      if (photo) photos.push([id, src]);
      rows.push([id, name, brewery, sg ? sg.id : "", sg ? CONF[sg.confidence] || 1 : 0, plausibleAbv(b, sg ? st.byId[sg.id] : null),
        b.alcohol_free ? 1 : 0, photo ? 1 : 0, photo ? clean(cr.contributor, 40) : "", g]);
    }
  }
  rows.sort((a, b) => a[1].localeCompare(b[1], "sv"));
  return { rows, photos };
}

function resize(src, dst) {
  const r = spawnSync("convert", [src, "-auto-orient", "-strip", "-resize", "x" + IMG_H + ">", "-quality", String(IMG_Q), "-interlace", "JPEG", dst], { encoding: "utf8" });
  if (r.status !== 0) copyFileSync(src, dst);
}

function main() {
  if (!existsSync(join(SRC, "styles/styles.json"))) { console.error("no research data at " + SRC); process.exit(2); }
  mkdirSync(join(OUT, "styles"), { recursive: true }); mkdirSync(join(OUT, "img"), { recursive: true });
  const st = styles(), { rows, photos } = beers(st);
  const { byId, ...stOut } = st;
  writeFileSync(join(OUT, "styles.json"), JSON.stringify(stOut));
  writeFileSync(join(OUT, "beers.json"), JSON.stringify({ v: 1, made: new Date().toISOString().slice(0, 10),
    src: "Open Food Facts (openfoodfacts.org): data ODbL, photos CC BY-SA", cols: COLS, groups: GROUPS, rows }));
  if (!existsSync(join(OUT, "taps.json"))) writeFileSync(join(OUT, "taps.json"), JSON.stringify({ v: 1, bars: {} }));
  for (const s of st.styles) { const p = join(SRC, "styles/img", s.id + ".svg"); if (existsSync(p)) copyFileSync(p, join(OUT, "styles", s.id + ".svg")); }
  let made = 0, kept = 0;
  if (!NO_IMG) for (const [id, src] of photos) {
    const dst = join(OUT, "img", id + ".jpg");
    if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) { kept++; continue; }
    resize(src, dst); made++;
  }
  const keep = new Set(photos.map((p) => p[0] + ".jpg")); let gone = 0;
  if (!NO_IMG) for (const f of readdirSync(join(OUT, "img"))) if (!keep.has(f)) { unlinkSync(join(OUT, "img", f)); gone++; }   // a beer that left the list
  const bytes = readdirSync(join(OUT, "img")).reduce((s, f) => s + statSync(join(OUT, "img", f)).size, 0);
  const by = [0, 0, 0]; rows.forEach((r) => by[r[9]]++);
  console.log("styles " + st.styles.length + " · beers " + rows.length + " (se " + by[0] + ", nordic " + by[1] + ", world se_likely " + by[2] + ")" +
    " · photos " + photos.length + " (new " + made + ", kept " + kept + ", gone " + gone + ") · img " + (bytes / 1e6).toFixed(1) + " MB" +
    " · beers.json " + (statSync(join(OUT, "beers.json")).size / 1e3).toFixed(0) + " kB · styles.json " + (statSync(join(OUT, "styles.json")).size / 1e3).toFixed(0) + " kB");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
