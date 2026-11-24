// lane barcard (I-133 option A, owner 24 Nov: A34 defaults = yes): docs/js/barcard.js logic + docs/barcard.css tokens + the
// new "olhall" kind in docs/js/mapart.js (PNVTYPE). Old code: barcard.js / barcard.css do not exist and "Varbergs Ölhall" is olbar
// -> every test here fails on the old code.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const DOCS = new URL("../../docs/", import.meta.url);
const art = {};
vm.runInNewContext(fs.readFileSync(new URL("js/mapart.js", DOCS), "utf8"), art);
function load(lang) {
  const win = { PNVTYPE: art.PNVTYPE, PNPINS: art.PNPINS, PNGLYPHS: art.PNGLYPHS, I18N: { lang: lang || "sv" },
    OLNU_CONFIG: { SUPABASE_URL: "https://proj.supabase.co" }, PNDS: { barSheet: (h) => h } };
  vm.runInNewContext(fs.readFileSync(new URL("js/barcard.js", DOCS), "utf8"),
    { window: win, document: { addEventListener() {} }, setInterval, clearInterval });
  return win.PN.barcard;
}
const B = load();
const css = fs.readFileSync(new URL("barcard.css", DOCS), "utf8");
const THEMES = ["pub", "bar", "cocktail", "sportbar", "nattklubb", "olbar", "restbar", "hotellbar", "olhall"];

test("A34 q4: beer halls are their own kind 'olhall' (map glyph = beer garden), breweries stay olbar", () => {
  const V = art.PNVTYPE;
  for (const n of ["Varbergs Ölhall", "Ölhallen 7:an", "Printz Ölhall", "Carlstad ölhall", "Stora Bierhalle", "The Beer Hall"]) assert.equal(V.classify({ amenity: "pub" }, n), "olhall", n);
  for (const n of ["Ludvika Bryggeri", "BrewDog Stockholm", "Ölbaren"]) assert.equal(V.classify({ amenity: "pub" }, n), "olbar", n);
  assert.ok(V.ORDER.includes("olhall") && V.ORDER.indexOf("olhall") < V.ORDER.indexOf("olbar"));
  assert.equal(V.LABEL.olhall, "Ölhall");
  assert.equal(art.PNTOKENS.typeMap.olhall, "biergarten");
});

test("15 venue kinds -> 9 themes; arenas, places and restaurants keep the plain header", () => {
  const want = { pub: "pub", nation: "pub", bar: "bar", cocktail: "cocktail", vinbar: "cocktail", sportbar: "sportbar", spelbar: "sportbar",
    nattklubb: "nattklubb", karaoke: "nattklubb", livescen: "nattklubb", olbar: "olbar", restbar: "restbar", hotellbar: "hotellbar", oltradgard: "olhall", olhall: "olhall" };
  for (const k of art.PNVTYPE.ORDER) assert.equal(B.theme({ id: "x", name: "X", vt: k }).theme, want[k], k);
  assert.equal(new Set(Object.values(want)).size, 9);
  assert.equal(B.theme({ id: "a", name: "Tunet", arena: 1 }), null);
  assert.equal(B.theme({ id: "p", name: "Pizzeria", place: 1 }), null);
  assert.equal(B.theme({ id: "r", name: "Blackstone", vt: "restaurant" }), null);
  assert.equal(B.theme({ id: "u", name: "Okänd", type: "bar" }).theme, "bar");
  // an old bars.json row (vt olbar) with a beer-hall name: the card says Ölhall already
  const t = B.theme({ id: "n932352673", name: "Varbergs Ölhall", type: "pub", vt: "olbar" });
  assert.equal(t.k, "olhall"); assert.equal(t.label, "Ölhall");
});

test("labels: sv from PNVTYPE, en for every kind", () => {
  const en = load("en");
  for (const k of art.PNVTYPE.ORDER) {
    const s = B.theme({ id: "x", name: "X", vt: k }).label, e = en.theme({ id: "x", name: "X", vt: k }).label;
    assert.equal(s, art.PNVTYPE.LABEL[k], k); assert.ok(e && !/[åäö]/i.test(e), k + " en " + e);
  }
});

test("A34 q2: crest initials from the name (stop words skipped)", () => {
  const want = [["La Parma Pub & Restaurang", "LP"], ["Tre tunnor", "TT"], ["Stora ölhallen", "SÖ"], ["Lobbybaren på Hotell Fyrklövern", "LF"],
    ["Lyktgubben", "L"], ["Pub", "P"], ["The Bishops Arms", "BA"], ["9:ans Ölhall", "9Ö"], ["", "?"]];
  for (const [n, i] of want) assert.equal(B.initials(n), i, n);
});

test("A34 q3: the seeded shift is stable per bar, small, and differs between bars", () => {
  const a = B.seed("x-la-parma-ludvika", "pub"), b = B.seed("x-la-parma-ludvika", "pub");
  assert.deepEqual(a, b);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const s = B.seed("n" + (1000 + i * 7919), "pub");
    assert.ok([50, 80, 110].includes(s.slot) && Math.abs(s.dx) <= 14 && Math.abs(s.dy) <= 6 && Math.abs(s.rot) <= 2 && [1, -1].includes(s.flip), JSON.stringify(s));
    seen.add(JSON.stringify(s));
  }
  assert.ok(seen.size > 150, "200 bars, " + seen.size + " looks");
  const sp = B.seed("n42", "sportbar"); assert.equal(sp.rot, 0); assert.equal(sp.flip, 1);   // the pitch line stays straight
});

test("A34 q5 + q6: no brand data today = no photo, no chain look; photos only from our own bucket; chain needs valid colours", () => {
  B.setBrands(null);
  assert.equal(Object.keys(B.brandOf({ id: "x-la-parma-ludvika" })).length, 0);
  const own = "https://proj.supabase.co/storage/v1/object/public/bar-brand/x-la-parma-ludvika/1.jpg";
  B.setBrands({ chains: { c1: { name: "Kopparkannan", n: 14, acc: "#7FE0B8", band: "#0c2b22" }, c2: { name: "Bad", acc: "red", band: "#000000" } },
    bars: { a: { photo: own }, b: { photo: "https://maps.googleapis.com/maps/api/place/photo?x=1" }, c: { photo: "https://proj.supabase.co/storage/v1/object/public/bar_photos/1.jpg" },
      d: { chain: "c1" }, e: { chain: "c2" }, f: { photo: own + '" onerror="x' } } });
  assert.equal(B.brandOf({ id: "a" }).photo.u, own);
  assert.equal(B.brandOf({ id: "b" }).photo, undefined, "scraped photo");
  assert.equal(B.brandOf({ id: "c" }).photo, undefined, "guest photo bucket is not a brand photo");
  assert.equal(B.brandOf({ id: "f" }).photo, undefined, "quote in url");
  const d = B.theme({ id: "d", name: "Kopparkannan Ludvika", vt: "pub" });
  assert.equal(d.look, "chain"); assert.equal(d.chain.n, 14); assert.equal(d.theme, "pub");
  assert.equal(B.theme({ id: "e", name: "X", vt: "pub" }).look, "pub", "bad chain colour = no chain look");
  assert.equal(B.theme({ id: "zz", name: "Kopparkannan Falun", vt: "pub" }).look, "pub", "no permission = kind theme");
  B.setBrands(null);
});

// contrast (WCAG): the header is always dark; text tokens on every band, the accent (crest letters, glyph) on its band
const tok = Object.fromEntries([...css.matchAll(/--(bc-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, "0")).join("");

test("tokens: every theme + chain has an accent and a band; the accent is the map pin tint of that family", () => {
  for (const t of THEMES.concat("chain")) assert.ok(tok["bc-" + t + "-acc"] && tok["bc-" + t + "-band"], t);
  const tint = art.PNTOKENS.tint, cat = { pub: "pub", bar: "bar", cocktail: "cocktail", sportbar: "sportsbar", nattklubb: "nightclub", olbar: "olbar", restbar: "restbar", hotellbar: "hotellbar", olhall: "biergarten" };
  for (const t of THEMES) assert.equal(tok["bc-" + t + "-acc"].toLowerCase(), tint[cat[t]].toLowerCase(), t);
  for (const t of THEMES.concat("chain")) assert.ok(css.includes(".pn-bc--" + t + "{") && css.includes(".pn-bc--" + t + " .pn-bc-pat{"), t + " class + pattern");
});

test("contrast >= 4.5:1 for every text on every band (title, hours, chip text on its tint, crest letters)", () => {
  const bad = [];
  for (const t of THEMES.concat("chain")) {
    const band = tok["bc-" + t + "-band"], acc = tok["bc-" + t + "-acc"], chip = mix(acc, band, 0.16);
    const c = { title: cr(tok["bc-title"], band), hours: cr(tok["bc-text-2"], band), chip: cr(tok["bc-text"], chip), crest: cr(acc, mix(acc, band, 0.14)), glyph: cr(acc, chip) };
    for (const k in c) if (c[k] < 4.5) bad.push(t + " " + k + " " + c[k].toFixed(2));
    // the darkest point of the band gradient is the sheet colour: text there too
    if (cr(tok["bc-text-2"], tok["bc-sheet"]) < 4.5) bad.push("hours on sheet");
  }
  assert.deepEqual(bad, []);
});

test("store build + 18+: the header has no drinking text, no counts, no emoji; no light version (always dark)", () => {
  const src = fs.readFileSync(new URL("js/barcard.js", DOCS), "utf8");
  const strings = [...src.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((m) => m[1]).filter((s) => /[a-zåäö]{3}/i.test(s) && !/[<>{}=]/.test(s));
  for (const s of strings) assert.ok(!/(drick|supa|skål|fler öl|drink more|another round|cheers|🍺)/i.test(s), s);
  assert.ok(!/\p{Extended_Pictographic}/u.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no emoji in code");
  assert.ok(!/prefers-color-scheme|data-theme/.test(css), "no light variant");
  assert.ok(!/animation|transition/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "no motion");
});
