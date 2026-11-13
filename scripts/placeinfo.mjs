// Place info (lane placesdata, 13 Nov): pure transforms for docs/placeinfo/ (no I/O here; scripts/build-placeinfo.mjs writes).
// One compact row per food / drink place, for the place card (docs/js/placecard.js):
//   row = [h, c, f, u, p, s]   (trailing empty fields are dropped; a place with nothing useful has no row)
//   h = opening hours, 7 days Mo..Su joined by "|", each day "start-end[,start-end]" in minutes ("660-1320|…", "" = closed),
//       same day format as docs/hours.json (scripts/oh-parse.mjs). Empty for bars: their hours are in hours.json already.
//   c = cuisine, OSM values ";"-joined, normalised (max 4): "pizza;kebab"
//   f = flag letters: t takeaway, T takeaway only, d delivery, o outdoor seating, v vegetarian, V vegetarian only,
//       n vegan, N vegan only, g gluten free, h halal, w wheelchair yes, l wheelchair limited, x wheelchair no
//   u = website (https:// is dropped to save bytes, http:// is kept), p = phone
//   s = which fields did NOT come from OpenStreetMap: letters c / u / p = from Overture Maps (gap filler). "" = all OSM.
// Licence: OSM = ODbL (the app shows "© OpenStreetMap"); Overture places = CDLA-Permissive-2.0 / Apache-2.0 / CC0.
import { parseOH, packW } from "./oh-parse.mjs";

export const r5 = (v) => Math.round(v * 1e5) / 1e5;
export const placeId = (lat, lng) => "pl_" + Math.round(lat * 1e5) + "_" + Math.round(lng * 1e5);   // = docs/js/bars.js

// OSM cuisine spellings → one value (the card has the Swedish label per value).
const SYN = {
  coffee_shop: "coffee", cafe: "coffee", hamburger: "burger", burgers: "burger", sallad: "salad", svensk: "swedish",
  husmanskost: "swedish", italian_pizza: "pizza", pizzeria: "pizza", sushi_bar: "sushi", kebap: "kebab", gyros: "kebab",
  shawarma: "kebab", "tex-mex": "mexican", tacos: "mexican", steak: "steak_house", steakhouse: "steak_house",
  fish_and_chips: "fish", seafood: "fish", hot_dog: "sausage", korv: "sausage", noodles: "noodle", bubble_tea: "tea",
  fine_dining: "fine_dining", local: "regional", nordic: "regional", scandinavian: "regional",
};
export function normCuisine(v) {
  const out = [];
  for (let x of String(v || "").toLowerCase().split(/[;,]/)) {
    x = x.trim().replace(/\s+/g, "_");
    if (!x || x.length > 24 || !/^[a-z_\-åäö]+$/.test(x)) continue;
    x = SYN[x] || x;
    if (!out.includes(x)) out.push(x);
    if (out.length >= 4) break;
  }
  return out.join(";");
}

// Overture taxonomy.primary → an OSM-style cuisine value ("" = no cuisine meaning, e.g. "restaurant", "bar").
const OV = {
  pizza_restaurant: "pizza", sushi_restaurant: "sushi", thai_restaurant: "thai", burger_restaurant: "burger",
  italian_restaurant: "italian", indian_restaurant: "indian", chinese_restaurant: "chinese", asian_restaurant: "asian",
  scandinavian_restaurant: "regional", swedish_restaurant: "swedish", japanese_restaurant: "japanese", greek_restaurant: "greek",
  vietnamese_restaurant: "vietnamese", mexican_restaurant: "mexican", korean_restaurant: "korean", lebanese_restaurant: "lebanese",
  middle_eastern_restaurant: "middle_eastern", turkish_restaurant: "turkish", french_restaurant: "french", spanish_restaurant: "spanish",
  mediterranean_restaurant: "mediterranean", american_restaurant: "american", seafood_restaurant: "fish", steakhouse: "steak_house",
  barbecue_restaurant: "barbecue", bar_and_grill_restaurant: "grill", kebab_shop: "kebab", falafel_restaurant: "falafel",
  noodles_restaurant: "noodle", ramen_restaurant: "ramen", tapas_bar: "tapas", salad_bar: "salad", sandwich_shop: "sandwich",
  coffee_shop: "coffee", bakery: "bakery", ice_cream_shop: "ice_cream", dessert_shop: "dessert", hot_dog_stand: "sausage",
  chicken_restaurant: "chicken", vegan_restaurant: "vegan", vegetarian_restaurant: "vegetarian", ethiopian_restaurant: "ethiopian",
  persian_iranian_restaurant: "persian", poke_restaurant: "poke", breakfast_and_brunch_restaurant: "breakfast", buffet_restaurant: "buffet",
  pancake_house: "pancake", fish_and_chips_restaurant: "fish", gastropub: "", pub: "", bar: "", restaurant: "", cafe: "coffee",
};
export function ovCuisine(cat) {
  const c = String(cat || "");
  if (Object.prototype.hasOwnProperty.call(OV, c)) return OV[c];
  const m = c.match(/^([a-z]+)_restaurant$/);
  return m && !/^(fast_food|family_style|casual|fine_dining|food)$/.test(m[1]) ? normCuisine(m[1]) : "";
}

const yes = (v) => /^(yes|only|limited)$/.test(String(v || "").toLowerCase());
export function flags(t) {
  let f = "";
  const ta = String(t.takeaway || "").toLowerCase();
  if (ta === "only") f += "T"; else if (ta === "yes") f += "t";
  if (yes(t.delivery)) f += "d";
  const os = String(t.outdoor_seating || "").toLowerCase();
  if ((os && os !== "no") || t.beer_garden === "yes" || t.amenity === "biergarten") f += "o";
  const vg = String(t["diet:vegetarian"] || "").toLowerCase(), vn = String(t["diet:vegan"] || "").toLowerCase();
  if (vg === "only") f += "V"; else if (yes(vg)) f += "v";
  if (vn === "only") f += "N"; else if (yes(vn)) f += "n";
  if (yes(t["diet:gluten_free"])) f += "g";
  if (yes(t["diet:halal"])) f += "h";
  const wc = String(t.wheelchair || "").toLowerCase();
  if (wc === "yes" || wc === "designated") f += "w"; else if (wc === "limited") f += "l"; else if (wc === "no") f += "x";
  return f;
}

export function cleanUrl(v) {
  let u = String(v || "").split(";")[0].trim();
  if (!u || /\s/.test(u) || u.length > 150) return "";
  if (!/^https?:\/\//i.test(u)) { if (!/^[\w-]+(\.[\w-]+)+(\/|$)/.test(u)) return ""; u = "https://" + u; }
  if (!/^https?:\/\/[\w-]+(\.[\w-]+)+/i.test(u)) return "";
  return u.replace(/^https:\/\//i, "").replace(/\/$/, "");
}
export function cleanPhone(v) {
  let p = String(v || "").split(/[;,]/)[0].trim().replace(/[^\d+ ()-]/g, "").replace(/\s+/g, " ").trim();
  const digits = p.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15 || p.length > 25) return "";
  if (/^46\d{7,10}$/.test(p)) p = "+" + p;   // Overture: "4640456940" = +46 40 45 69 40
  return p;
}
export function packHours(oh, now) {
  if (!oh) return "";
  const r = parseOH(oh, now);
  return r ? packW(r.w).join("|") : "";
}
export function trimRow(row) {
  const r = row.slice();
  while (r.length && (r[r.length - 1] === "" || r[r.length - 1] == null)) r.pop();
  return r.length ? r : null;
}
// OSM tags → row (null = nothing worth a card line). withHours = false for bars (hours.json has them).
export function infoRow(t, now, withHours = true) {
  t = t || {};
  return trimRow([
    withHours ? packHours(t.opening_hours, now) : "",
    normCuisine(t.cuisine), flags(t),
    cleanUrl(t.website || t["contact:website"] || t.url),
    cleanPhone(t.phone || t["contact:phone"] || t["contact:mobile"]), "",
  ]);
}

// ---------- Overture gap filler ----------
// Name key: lower case, no accents on e/é, no generic words, letters + digits only.
const GENERIC = /\b(restaurang|restaurant|pizzeria|pizza|café|cafe|kafé|kafe|konditori|bar|pub|grill|sushi|thai|kebab|och|and|the|&)\b/g;
export function nameKey(n) {
  return String(n || "").toLowerCase().normalize("NFC").replace(/[éè]/g, "e").replace(GENERIC, " ").replace(/[^a-z0-9åäöü]+/g, "");
}
function metres(a, b) {
  const R = 6371e3, r = Math.PI / 180;
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r), y = (b[0] - a[0]) * r;
  return R * Math.hypot(x, y);
}
export function sameName(a, b) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  if (x === y) return true;
  const s = x.length <= y.length ? x : y, l = s === x ? y : x;
  return s.length >= 4 && l.includes(s);
}
// Grid index of Overture food rows [name, lat, lng, cat, web, tel].
export function ovIndex(rows) {
  const g = new Map();
  for (const r of rows || []) {
    if (!Array.isArray(r) || typeof r[1] !== "number" || typeof r[2] !== "number") continue;
    const k = Math.floor(r[1] / 0.005) + "_" + Math.floor(r[2] / 0.01);
    (g.get(k) || g.set(k, []).get(k)).push(r);
  }
  return g;
}
// Best Overture match for an OSM place: same name (see sameName) within maxM metres, nearest first.
export function ovMatch(idx, name, lat, lng, maxM = 60) {
  if (!idx) return null;
  const gy = Math.floor(lat / 0.005), gx = Math.floor(lng / 0.01);
  let best = null, bd = maxM;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    for (const r of idx.get(gy + dy + "_" + (gx + dx)) || []) {
      const d = metres([lat, lng], [r[1], r[2]]);
      if (d <= bd && sameName(name, r[0])) { bd = d; best = r; }
    }
  }
  return best;
}
// Fill empty cuisine / website / phone of a row from an Overture match; s gets the letters of the filled fields.
export function fillFromOverture(row, ov) {
  const r = [0, 1, 2, 3, 4, 5].map((i) => (row && row[i]) || "");
  if (!ov) return trimRow(r);
  let s = r[5];
  if (!r[1]) { const c = ovCuisine(ov[3]); if (c) { r[1] = c; s += "c"; } }
  if (!r[3]) { const u = cleanUrl(ov[4]); if (u && !/facebook\.com|instagram\.com/i.test(u)) { r[3] = u; s += "u"; } }
  if (!r[4]) { const p = cleanPhone(ov[5]); if (p) { r[4] = p; s += "p"; } }
  r[5] = s;
  return trimRow(r);
}

// ---------- tiles (same tree format as docs/places/, scripts/places-tiles.mjs) ----------
// entries = [[id, lat, lng, row], …] → { index, files: Map(key → { id: row }) }
export function infoTiles(entries, { max = 500, maxDepth = 6, baseLat = 0.5, baseLng = 1 } = {}) {
  const files = new Map();
  function build(rows, key, s, w, h, wd, depth) {
    if (!rows.length) return 0;
    if (rows.length <= max || depth >= maxDepth) {
      const o = {};
      rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).forEach((e) => { o[e[0]] = e[3]; });
      files.set(key, o);
      return 1;
    }
    const mh = s + h / 2, mw = w + wd / 2, kids = [[], [], [], []];
    for (const p of rows) kids[(p[1] >= mh ? 2 : 0) + (p[2] >= mw ? 1 : 0)].push(p);
    return kids.map((k, i) => build(k, key + "-" + i, i >= 2 ? mh : s, i % 2 ? mw : w, h / 2, wd / 2, depth + 1));
  }
  const base = new Map();
  for (const e of entries) {
    if (!e || typeof e[1] !== "number" || typeof e[2] !== "number" || !e[3]) continue;
    const k = Math.floor(e[1] / baseLat) + "_" + Math.floor(e[2] / baseLng);
    (base.get(k) || base.set(k, []).get(k)).push(e);
  }
  const t = {};
  let n = 0;
  for (const [k, rows] of [...base.entries()].sort()) {
    const [by, bx] = k.split("_").map(Number);
    n += rows.length;
    t[k] = build(rows, k, by * baseLat, bx * baseLng, baseLat, baseLng, 0);
  }
  return { index: { v: 1, b: [baseLat, baseLng], n, t }, files };
}

// ---------- Systembolaget: OSM stores + Overture (PinMeTo = Systembolaget's own location feed) ----------
// osm = rows [name, lat, lng, week, guess, addr]; ov = Overture sb rows [name, lat, lng, address, datasets].
// Adds a PinMeTo store when no OSM store is within maxM metres (normal week, guess = 1). When the feed looks complete
// (>= officialMin rows; Systembolaget had 452 stores in 2025) it is the truth: an OSM store with no feed store within maxM is a
// closed / moved store and is left out (returned in `dropped`). Source column [6]: "osm" | "ovr".
export function titleTown(a) {
  return String(a || "").replace(/,\s*([^,]+)$/, (m, town) => ", " + town.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (x, p, c) => p + c.toUpperCase()));
}
export function mergeSystembolaget(osm, ov, week, maxM = 200, officialMin = 400) {
  const feed = (ov || []).filter((o) => Array.isArray(o) && typeof o[1] === "number" && typeof o[2] === "number" && /PinMeTo/.test(String(o[4] || "")));
  const official = feed.length >= officialMin;
  const dropped = [];
  const out = [];
  for (const r of osm || []) {
    if (official && !feed.some((o) => metres([r[1], r[2]], [o[1], o[2]]) < maxM)) { dropped.push(r); continue; }
    const x = r.slice(0, 6); while (x.length < 6) x.push(""); x.push("osm"); out.push(x);
  }
  const kept = out.map((r) => [r[1], r[2]]);
  for (const o of feed) {
    if (kept.some((k) => metres(k, [o[1], o[2]]) < maxM)) continue;
    kept.push([o[1], o[2]]);
    out.push([String(o[0] || "Systembolaget").slice(0, 60), r5(o[1]), r5(o[2]), week, 1, titleTown(o[3]).slice(0, 80), "ovr"]);
  }
  out.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
  out.dropped = dropped;
  return out;
}
