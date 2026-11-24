#!/usr/bin/env node
// Beer library (I-132): turn the research data (lane beerdata, ops repo research/beer-library) into small app data in docs/data/beer/.
//   node scripts/beer/build-data.mjs [research dir] [--no-img]
//   default research dir: ../pintsnow-ops/research/beer-library (next to this repo) or $PN_BEER_SRC.
// Writes (only the fields the app needs; the app loads them when the Öl tab opens):
//   docs/data/beer/styles.json   61 styles: names, family, colour, IBU / ABV ranges, taste tags, glass, serve temp, food, our texts
//   docs/data/beer/beers.json    beers: rows [id, name, brewery, style, conf, abv, af, photo, credit, group, nn] (see COLS) +
//                                alias {id: kept id} (a duplicate beer: old chat tips and favourites still find it)
//   docs/data/beer/styles/*.svg  the style pictures (our own art)
//   docs/data/beer/img/<id>.jpg  photos (Open Food Facts, CC BY-SA): only for the beers we ship, resized to <= 300 px high
//   docs/data/beer/taps.json     bar tap lists: { v, bars: { <bar id>: [beer id, ...] } }. Empty until bars send lists (I-132 phase 3).
// Which beers ship: Sweden (beers_se), Nordic (beers_nordic) and world rows marked se_likely (a guess: sold in Sweden).
// Data rules (coordinator 19 Nov): ABV only when plausible (0 % only on an alcohol-free beer; nothing above 16 %; not far above the
// style's range; not when the name says another strength); the style is a guess unless its confidence is "high" (the app says
// "Stil (gissning)"). Names: see "name quality" below. Nothing is made up here.
// Lane beerlist (24 Nov; the rules live in scripts/beer/checks.mjs, tests/unit/beerdata.test.mjs audits the output):
// - alcohol-free needs evidence (afOk: the name, an alcohol-free brand, the source's "non-alcoholic beers" category, or a real
//   0,05-0,5 % number) and no contradiction (a strong name or style, or more than 0,5 %). Without it: no mark and NO strength.
// - a name that says alcohol-free makes the beer alcohol-free; an alcohol-free beer with no style gets the style "alkoholfri".
// - no ABV far below the style's range unless the name says light / low (Corona Extra had 1,4 %).
// - a name that is only a big brand gets the brand's flagship style as a guess (flagshipStyle).
// - the same beer twice (sameBeer: same name + same brand) is one row; the other ids are aliases. Vinegar is not a drink: out.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { MAX_ABV as AUDIT_MAX, LIGHT_RE, NOT_DRINK_RE, afOk, strongStyle, sameBeer, nameKey, flagshipStyle, fold, coreKey } from "./checks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const args = process.argv.slice(2);
const SRC = resolve(args.find((a) => !a.startsWith("--")) || process.env.PN_BEER_SRC || join(REPO, "../pintsnow-ops/research/beer-library"));
const NO_IMG = args.includes("--no-img");
const OUT = join(REPO, "docs/data/beer");
const MAX_ABV = AUDIT_MAX, IMG_H = 300, IMG_Q = 72;
export const COLS = ["id", "name", "brewery", "style", "conf", "abv", "af", "photo", "credit", "group", "nn"];   // nn 1 = no real name (search only)
const CONF = { low: 1, medium: 2, high: 3 };
const GROUPS = ["se", "nordic", "world_se_likely"];

const rd = (p) => JSON.parse(readFileSync(join(SRC, p), "utf8"));
const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 80);
const cleanName = (s) => clean(s).replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}%)]+$/u, "");   // "‘Drink’in …" sorts under D

/* ---------- name quality (lane beer2, 19 Nov) ----------
   OFF names often hold the strength, the pack size, HTML entities or SHOUTING ("6X25CL LEFFE BLONDE 6,6%").
   A strength in the name would show the ABV without the plausible check, so it goes (an alcohol-free 0,0–0,5 % stays: it is
   information, not a strength). A name that is only a style ("Blanche") gets the brewery in front ("Hoegaarden Blanche").
   A name that is only "beer" words ("Bière", "Bier Dose") = no real name: nn = 1, the app shows it in search only. */
const BEERW = new Set(("beer bier biere bière birra cerveza cervesa öl ol øl olut alus piwo pivo bryggeri brewery brewing " +
  "pk pack boks burk burkar dose dosen can cans bottle bottles flaska flasche fles vol alc abv cl ml l x").split(" "));
const STYLEW = new Set(("lager pils pilsner pilsener pilsener ipa apa dipa neipa iipa xpa ale pale india stout porter wheat weiss weisse weissbier weizen " +
  "hefe hefeweizen witbier wit blanche blanc blonde blond ambrée ambree amber brune brown dunkel dunkles dark hell helles ljus ljusa mörk mork " +
  "red rouge rosé rose rosee rosée triple tripel dubbel double sour gose saison bock märzen marzen kölsch kolsch export premium classic original " +
  "light lätt lättöl folköl starköl mellanöl alkoholfri alkoholfritt alkoholfrei alcohol free sans alcool non alcoholic zero craft hveteøl veteöl " +
  "session cider radler och and de la le the with mit med").split(" "));
const ENT = { "&quot;": '"', "&amp;": "&", "&#39;": "'", "&apos;": "'", "&lt;": "", "&gt;": "" };
const ACR = new Set(["IPA", "APA", "DIPA", "NEIPA", "IIPA", "XPA", "ESB", "BA", "IPL", "DDH", "TIPA", "AB", "XO", "NZ", "USA", "UK"]);
const pctRe = /(\d+(?:[.,]\d+)?)\s*%\s*(?:v(?:ol)?\b\.?|alc\b\.?|abv\b)?/gi;
export function nameStrength(s) {
  const m = [...String(s || "").matchAll(pctRe)].map((x) => parseFloat(x[1].replace(",", "."))).filter((v) => isFinite(v) && v >= 0.6 && v <= 70);
  return m.length ? m[0] : null;
}
function titleCase(s) {
  if (/\p{Ll}/u.test(s) || !/\p{Lu}{4}/u.test(s)) return s;   // only SHOUTING names
  return s.replace(/[\p{L}\p{N}'’]+/gu, (w) => ACR.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
}
function words(s) { return String(s || "").toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
export function tidyName(raw) {
  let s = String(raw == null ? "" : raw).replace(/&(quot|amp|#39|apos|lt|gt);?/gi, (m) => ENT[m.toLowerCase().replace(/;?$/, ";")] ?? "");
  s = s.replace(/["“”„«»]/g, " ");                                                                                  // quotes break when cut
  s = s.replace(pctRe, (m, n) => { const v = parseFloat(n.replace(",", ".")); return v < 0.6 ? m : " "; });            // strengths out, 0,0 % stays
  s = s.replace(/\b\d+\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:cl|ml|l)?\b/gi, " ")                                         // 6X25CL, 6 x 33 cl
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:cl|ml|l|liter|litre)\b/gi, " ")                                                // 50 cl, 0,33 l
    .replace(/\b\d+\s*-?\s*(?:pack|pk)\b/gi, " ").replace(/\b(?:pk|boks|burk|dose)\b/gi, " ");                    // 6 pack, PK, boks
  s = cleanName(s.replace(/\s*[,;:–-]\s*(?=[,;:–-]|$)/g, " ").replace(/\(\s*\)/g, " "));
  s = titleCase(s);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
// 0 = a real name; 1 = only "beer" words (no name: search only); 2 = only style words (gets the brewery in front)
export function nameKind(name) {
  const w = words(name).filter((x) => !BEERW.has(x) && !/^\d+([.,]\d+)?$/.test(x));
  if (!w.some((x) => (x.match(/\p{L}/gu) || []).length >= 2)) return 1;
  return w.every((x) => STYLEW.has(x) || (x.match(/\p{L}/gu) || []).length < 2) ? 2 : 0;
}
function hasBrewery(name, brewery) {
  const n = words(name), b = words(brewery).filter((x) => x.length >= 3 && !BEERW.has(x));
  return b.length > 0 && b.some((x) => n.indexOf(x) >= 0);
}

// ABV that we dare to show, else null
export function plausibleAbv(b, style) {
  const a = typeof b.abv === "number" && isFinite(b.abv) ? b.abv : null;
  if (a == null) return null;
  const inName = nameStrength(b.name);
  if (inName != null && Math.abs(inName - a) > 1) return null;   // the label and the data do not agree: show nothing
  if (b.alcohol_free) return a <= 0.5 ? Math.round(a * 10) / 10 : null;
  if (a < 0.6 || a > MAX_ABV) return null;
  const r = style && style.strength && style.strength.abv;
  if (r && r[1] && a > r[1] + 4) return null;
  if (r && r[0] && a < r[0] - 2 && !LIGHT_RE.test(b.name || "")) return null;   // 1,4 % on Corona Extra: the source is wrong
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
  const seen = new Set(), seenName = new Map(), rows = [], photos = [], ids = {}, alias = {};
  for (const [f, g, keep] of files) {
    if (!existsSync(join(SRC, f))) continue;
    for (const b of rd(f).beers || []) {
      if (!keep(b) || !b.barcode || !cleanName(b.name) || seen.has(b.barcode)) continue;
      const id = String(b.barcode).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40); if (!id) continue;
      ids[id] = b.barcode;
      const brewery = tidyName(clean(b.brand, 60)), raw = tidyName(b.name);
      let name = (raw.match(/\p{L}/gu) || []).length >= 2 ? raw : brewery && brewery.toLowerCase() !== raw.toLowerCase() ? cleanName(brewery + " " + raw) : "";   // "1664" -> "Kronenbourg 1664"
      const kind = name ? nameKind(name) : 1;
      if (kind && brewery && !hasBrewery(name, brewery)) name = cleanName(brewery + " " + name);   // "Blanche" -> "Hoegaarden Blanche"
      if ((name.match(/\p{L}/gu) || []).length < 2) continue;
      const nn = kind === 1 || (kind === 2 && !brewery) ? 1 : 0;
      if (NOT_DRINK_RE.test(name) || NOT_DRINK_RE.test(b.name)) continue;   // "Lager eddike" = vinegar
      const rawAbv = typeof b.abv === "number" && isFinite(b.abv) ? b.abv : null;
      let sg = b.style_guess && st.byId[b.style_guess.id] ? b.style_guess : null;
      const sgLo = sg && st.byId[sg.id].strength && st.byId[sg.id].strength.abv ? st.byId[sg.id].strength.abv[0] : null;
      const af = afOk({ name, brewery, abv: rawAbv, af: !!b.alcohol_free, cat: (b.categories || []).indexOf("en:non-alcoholic-beers") >= 0, strongStyle: strongStyle(sgLo) });
      if (sg && sg.id === "alkoholfri" && !af) sg = null;                    // the guess came from the wrong alcohol-free mark
      if (!sg && af && st.byId.alkoholfri) sg = { id: "alkoholfri", confidence: "low" };
      if (!sg && !af && flagshipStyle(name)) sg = { id: flagshipStyle(name), confidence: "low" };   // "Heineken Bier" -> Ljus lager (gissning)
      const abv = b.alcohol_free && !af ? null : plausibleAbv({ ...b, alcohol_free: af }, sg ? st.byId[sg.id] : null);
      const cr = credit[b.barcode], src = cr ? join(SRC, "beers", cr.file) : null, photo = !!(src && existsSync(src));
      const nk = nameKey(name), same = seenName.get(nk) || [];
      const had = same.find((i) => sameBeer({ name, brewery, af }, { name: rows[i][1], brewery: rows[i][2], af: rows[i][6] }));
      seen.add(b.barcode);
      const row = [id, name, brewery, sg ? sg.id : "", sg ? CONF[sg.confidence] || 1 : 0, abv,
        af ? 1 : 0, photo ? 1 : 0, photo ? clean(cr.contributor, 40) || "openfoodfacts-contributors" : "", g, nn];
      // the same beer twice (a pack and a bottle, or a licence brewer): keep the best row (photo, then style, then ABV; a tie
      // keeps the first = the Swedish list first); the other id stays an alias (old tips + favourites + the scanner find it)
      const score = (r) => (r[7] ? 4 : 0) + (r[3] ? 2 : 0) + (r[5] != null ? 1 : 0);
      if (had != null && score(row) <= score(rows[had])) { alias[id] = rows[had][0]; rows[had][1] = cleaner(rows[had][1], name); rows[had][10] = Math.min(rows[had][10], nn); continue; }
      if (had != null) {
        const old = rows[had][0]; alias[old] = id; row[9] = Math.min(row[9], rows[had][9]); row[1] = cleaner(row[1], rows[had][1]); row[10] = Math.min(row[10], rows[had][10]);
        for (const k of Object.keys(alias)) if (alias[k] === old) alias[k] = id;
        rows[had] = row;
      } else { same.push(rows.length); seenName.set(nk, same); rows.push(row); }
    }
  }
  rows.sort((a, b) => a[1].localeCompare(b[1], "sv"));
  for (const r of rows) if (r[7]) photos.push([r[0], join(SRC, "beers", credit[ids[r[0]]].file)]);
  return { rows, photos, alias };
}

// fixC P-11: the kept row shows the cleanest name of its group ("Heineken", not "Beer Heineken" or "Heineken st 330"):
// the name with the fewest beer / pack words, then the shorter one. Same core name = the same words, so nothing is lost.
function noise(n) { const w = fold(n).split(" ").filter(Boolean); return w.length - coreKey(n).split(" ").filter(Boolean).length; }
function cleaner(a, b) { const d = noise(b) - noise(a); return d < 0 || (d === 0 && b.length < a.length) ? b : a; }
function resize(src, dst) {
  const r = spawnSync("convert", [src, "-auto-orient", "-strip", "-resize", "x" + IMG_H + ">", "-quality", String(IMG_Q), "-interlace", "JPEG", dst], { encoding: "utf8" });
  if (r.status !== 0) copyFileSync(src, dst);
}

function main() {
  if (!existsSync(join(SRC, "styles/styles.json"))) { console.error("no research data at " + SRC); process.exit(2); }
  mkdirSync(join(OUT, "styles"), { recursive: true }); mkdirSync(join(OUT, "img"), { recursive: true });
  const st = styles(), { rows, photos, alias } = beers(st);
  const { byId, ...stOut } = st;
  writeFileSync(join(OUT, "styles.json"), JSON.stringify(stOut));
  writeFileSync(join(OUT, "beers.json"), JSON.stringify({ v: 1, made: new Date().toISOString().slice(0, 10),
    src: "Open Food Facts (openfoodfacts.org): data ODbL, photos CC BY-SA", cols: COLS, groups: GROUPS, rows, alias }));
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
