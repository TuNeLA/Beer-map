// Place card data (lane placesdata): scripts/placeinfo.mjs transforms (OSM tags → compact row, Overture gap filler, tiles,
// Systembolaget merge) and the client side of docs/js/placecard.js (price level, hours text, cuisine label, tile lookup).
import test from "node:test";
import assert from "node:assert/strict";
import {
  normCuisine, ovCuisine, flags, cleanUrl, cleanPhone, infoRow, nameKey, sameName, ovIndex, ovMatch, fillFromOverture,
  infoTiles, mergeSystembolaget, placeId, titleTown,
} from "../../scripts/placeinfo.mjs";
import { loadScript } from "./load.mjs";

const NOW = new Date("2026-11-13T12:00:00Z");

test("placeinfo: cuisine is normalised, de-duplicated and capped at 4", () => {
  assert.equal(normCuisine("Pizza; kebab;pizza"), "pizza;kebab");
  assert.equal(normCuisine("coffee_shop;hamburger;sallad;svensk;thai"), "coffee;burger;salad;swedish");
  assert.equal(normCuisine("<script>;x".repeat(1)), "x");
  assert.equal(normCuisine(""), "");
});

test("placeinfo: Overture category → cuisine (generic categories give none)", () => {
  assert.equal(ovCuisine("pizza_restaurant"), "pizza");
  assert.equal(ovCuisine("scandinavian_restaurant"), "regional");
  assert.equal(ovCuisine("nepalese_restaurant"), "nepalese");
  assert.equal(ovCuisine("restaurant"), "");
  assert.equal(ovCuisine("bar"), "");
  assert.equal(ovCuisine("fast_food_restaurant"), "");
});

test("placeinfo: flags from OSM tags", () => {
  assert.equal(flags({ takeaway: "yes", outdoor_seating: "yes", "diet:vegan": "yes", wheelchair: "limited" }), "tonl");
  assert.equal(flags({ takeaway: "only", "diet:vegetarian": "only", "diet:gluten_free": "yes", wheelchair: "no", delivery: "yes" }), "TdVgx");
  assert.equal(flags({ amenity: "biergarten", "diet:halal": "yes", wheelchair: "yes" }), "ohw");
  assert.equal(flags({ takeaway: "no", outdoor_seating: "no" }), "");
});

test("placeinfo: website and phone cleaning", () => {
  assert.equal(cleanUrl("https://www.pizzeria.se/"), "www.pizzeria.se");
  assert.equal(cleanUrl("http://old.se"), "http://old.se");
  assert.equal(cleanUrl("pizza.se/meny"), "pizza.se/meny");
  assert.equal(cleanUrl("javascript:alert(1)"), "");
  assert.equal(cleanUrl("not a url"), "");
  assert.equal(cleanPhone("+46 240-123 45; +46 70 111 22 33"), "+46 240-123 45");
  assert.equal(cleanPhone("4640456940"), "+4640456940");
  assert.equal(cleanPhone("123"), "");
});

test("placeinfo: infoRow packs hours as 7 days joined by | and trims empty fields", () => {
  const r = infoRow({ opening_hours: "Mo-Fr 11:00-22:00; Sa 12:00-01:00; Su off", cuisine: "pizza", website: "https://a.se" }, NOW);
  assert.deepEqual(r, ["660-1320|660-1320|660-1320|660-1320|660-1320|720-1500|", "pizza", "", "a.se"]);
  assert.equal(infoRow({ name: "Nothing" }, NOW), null);
  // bars: no hours (hours.json has them)
  assert.deepEqual(infoRow({ opening_hours: "18:00-02:00", phone: "+46 8 123 456" }, NOW, false), ["", "", "", "", "+46 8 123 456"]);
});

test("placeinfo: Overture fills only empty fields and records the source letters", () => {
  const idx = ovIndex([["Pizzeria Roma", 60.14834, 15.18712, "pizza_restaurant", "https://roma.se", "0240-12345"],
    ["Other Place", 60.14834, 15.18712, "sushi_restaurant", "https://x.se", "0240-1"]]);
  const m = ovMatch(idx, "Roma", 60.1484, 15.1872);
  assert.equal(m[0], "Pizzeria Roma");
  assert.equal(ovMatch(idx, "Roma", 60.16, 15.1872), null, "too far away");
  assert.equal(ovMatch(idx, "Kebabkungen", 60.1484, 15.1872), null, "other name");
  assert.deepEqual(fillFromOverture(["", "", "t", "", "", ""], m), ["", "pizza", "t", "roma.se", "0240-12345", "cup"]);
  assert.deepEqual(fillFromOverture(["", "kebab", "", "osm.se", "", ""], m), ["", "kebab", "", "osm.se", "0240-12345", "p"]);
  assert.deepEqual(fillFromOverture(null, ["X", 1, 1, "restaurant", "https://facebook.com/x", ""]), null, "facebook link and generic category are not used");
  assert.ok(sameName("Café Ludvika", "Ludvika Kafé") === false || nameKey("Café Ludvika") === "ludvika");
  assert.ok(sameName("Restaurang Ankaret", "Ankaret"));
});

test("placeinfo: tiles split big areas and keep every id", () => {
  const entries = [];
  for (let i = 0; i < 1200; i++) { const la = 59.2 + (i % 40) * 4e-3, lo = 18.0 + Math.floor(i / 40) * 6e-3; entries.push([placeId(la, lo), la, lo, ["", "pizza"]]); }
  entries.push(["n1", 60.1, 15.2, ["", "", "o"]]);
  const { index, files } = infoTiles(entries, { max: 500 });
  assert.equal(index.n, 1201);
  let n = 0; for (const o of files.values()) { n += Object.keys(o).length; assert.ok(Object.keys(o).length <= 500); }
  assert.equal(n, 1201);
  assert.ok(Array.isArray(index.t["118_18"]), "Stockholm tile is split");
  assert.equal(index.t["120_15"], 1);
  // the client walks the same tree to the same leaf
  const PC = loadScript("js/placecard.js", { U: loadScript("js/util.js").U, I18N: { lang: "sv" }, PN: {} }).PN.placecard;
  for (const e of [entries[0], entries[700], entries[1199], entries[1200]]) {
    const k = PC._leafKey(e[1], e[2], index);
    assert.ok(files.get(k) && files.get(k)[e[0]], "leaf " + k + " holds " + e[0]);
  }
  assert.equal(PC._leafKey(40, 10, index), null, "outside every tile");
});

test("placeinfo: Systembolaget merge adds feed stores OSM lacks; a complete feed drops closed OSM stores", () => {
  const W = ["600-1140", "600-1140", "600-1140", "600-1140", "600-1140", "600-900", ""];
  const osm = [["Systembolaget Ludvika", 60.14834, 15.18712, W, 0, "Storgatan 1, Ludvika"], ["Systembolaget", 61, 16, W, 1, ""]];
  const ov = [["Systembolaget", 60.1484, 15.1872, "Storgatan 1, LUDVIKA", "PinMeTo"], ["Systembolaget", 62, 17, "Torget 2, SVEG", "PinMeTo"],
    ["Systembolaget", 63, 18, "X 1, Y", "Foursquare"]];
  const small = mergeSystembolaget(osm, ov, W);
  assert.deepEqual(small.map((r) => r[6]), ["osm", "osm", "ovr"], "a small feed only adds");
  assert.deepEqual(small[2], ["Systembolaget", 62, 17, W, 1, "Torget 2, Sveg", "ovr"]);
  const full = mergeSystembolaget(osm, ov, W, 200, 2);
  assert.equal(full.length, 2);
  assert.equal(full.dropped.length, 1, "OSM store with no feed store near = closed / moved");
  assert.equal(titleTown("Kyrkogatan 19, MORA"), "Kyrkogatan 19, Mora");
  assert.equal(titleTown("Gastkullevägen 1 A, JÄRPEN"), "Gastkullevägen 1 A, Järpen");
});

// ---------- client: docs/js/placecard.js ----------
const U = loadScript("js/util.js").U;
const OPPET = loadScript("js/oppet.js", { U, I18N: { lang: "sv", t: (k) => k } }).OPPET;
function card(lang) { return loadScript("js/placecard.js", { U, I18N: { lang }, OPPET, PN: {} }).PN.placecard; }

test("placecard: price level = this bar vs the town median, needs 5 priced bars", () => {
  const P = card("sv");
  const town = [70, 72, 75, 78, 80, 85];
  assert.equal(P.median(town), 76.5);
  assert.equal(P.priceLevel(65, town).sym, "$");
  assert.equal(P.priceLevel(76, town).sym, "$$");
  assert.equal(P.priceLevel(89, town).sym, "$$$");
  assert.equal(P.priceLevel(85, town).lvl, 3, "85 / 76.5 = 1.11");
  assert.equal(P.priceLevel(70, [70, 72, 75, 80]), null, "only 4 priced bars");
  assert.equal(P.priceLevel(0, town), null);
});

test("placecard: hours text 'Öppet nu · stänger 22:00' / 'Stängt · öppnar 11:00' (Stockholm time)", () => {
  const P = card("sv");
  const w = "660-1320|660-1320|660-1320|660-1320|660-1320|720-1500|".split("|");
  const at = (iso) => P.hoursText(OPPET.status(w, Date.parse(iso)));
  assert.equal(at("2026-11-13T12:00:00Z").t, "Öppet nu · stänger 22:00");          // Fri 13:00 CET
  assert.equal(at("2026-11-13T08:00:00Z").t, "Stängt · öppnar 11:00");              // Fri 09:00
  assert.equal(at("2026-11-13T20:45:00Z").cls, "oh-soon");                          // Fri 21:45
  assert.equal(at("2026-11-14T23:30:00Z").t, "Öppet nu · stänger 01:00");          // Sat 00:30 → Sun 00:30, Sat part ends 01:00
  assert.equal(at("2026-11-15T12:00:00Z").t, "Stängt · öppnar i morgon 11:00");    // Sun 13:00, opens Mon 11:00 (> 12 h)
  assert.equal(card("en").hoursText(OPPET.status(w, Date.parse("2026-11-13T12:00:00Z"))).t, "Open now · closes 22:00");
  assert.equal(P.hoursText(null), null);
});

test("placecard: Swedish cuisine label", () => {
  const P = card("sv");
  assert.equal(P.cuisineLabel("pizza;kebab"), "Pizza · Kebab");
  assert.equal(P.cuisineLabel("thai;sushi;burger;pizza"), "Thai · Sushi · Hamburgare", "max 3");
  assert.equal(P.cuisineLabel("regional"), "Husman");
  assert.equal(P.cuisineLabel("smorgas_bord"), "Smorgas bord");
  assert.equal(card("en").cuisineLabel("burger"), "Burgers");
  assert.equal(P.cuisineLabel(""), "");
});

test("placecard: lines escape data and show the OSM source", () => {
  const P = card("sv");
  const i = P.rowObj(["", "pizza", "tov", "evil.se/\"><img", "+46 240 1", "u"]);
  const place = { id: "pl_1_2", lat: 60, lng: 15, type: "restaurant", place: true };
  const more = P.moreHTML(place, i);
  assert.ok(!/<img/.test(more), "escaped");
  assert.ok(/>Avhämtning</.test(more) && />Uteservering</.test(more) && />Vegetariskt</.test(more));
  assert.ok(!/>Uteservering</.test(P.moreHTML(Object.assign({ outdoor: 1 }, place), i)), "ute.js shows outdoor bars already");
  assert.ok(/openstreetmap\.org\/copyright/.test(more) && /Overture Maps/.test(more));
  assert.ok(/href="tel:\+462401"/.test(more));
  assert.ok(/<span>Pizza<\/span>/.test(P.lineHTML(place, i, null)));
  assert.ok(/\$\$<\/span>/.test(P.lineHTML(place, i, P.priceLevel(76, [70, 72, 75, 78, 80]))));
  assert.ok(/hidden/.test(P.lineHTML(place, null, null)), "no data = hidden line");
  assert.equal(P.webHref("a.se"), "https://a.se");
  assert.equal(P.webHref("http://a.se"), "http://a.se");
});
