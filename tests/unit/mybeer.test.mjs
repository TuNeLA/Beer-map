// lane mybeer (I-146 / I-147): docs/js/mybeer-look.js on the REAL beer data (docs/data/beer/beers.json + styles.json).
// The short name for the ÖL! button (hand list + rule), the text contrast on every beer colour, the drawn bottle / can (no marks),
// and that stored looks are cleaned. Old code: the file does not exist -> every test fails.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const DOCS = new URL("../../docs/", import.meta.url);
const win = {};
vm.runInNewContext(fs.readFileSync(new URL("js/mybeer-look.js", DOCS), "utf8"), { window: win });
const M = win.MYBEER_LOOK;
const raw = JSON.parse(fs.readFileSync(new URL("data/beer/beers.json", DOCS), "utf8"));
const styles = JSON.parse(fs.readFileSync(new URL("data/beer/styles.json", DOCS), "utf8")).styles;
const rows = raw.rows.map((r) => Object.fromEntries(raw.cols.map((c, i) => [c, r[i]])));
const HEX = /^#[0-9A-F]{6}$/;

test("short names: the owner's examples and the design lane's misses", () => {
  const want = [
    ["1664 Blanc Wheat Beer", "1664 Blanc", "BLANC"], ["Kronenbourg 1664", "", "1664"], ["Guinness Original", "Guinness", "GUINNESS"],
    ["Brewdog Punk IPA", "Brewdog", "PUNK"], ["Corona Extra", "Corona", "CORONA"], ["Pilsner Urquell", "", "URQUELL"], ["Leffe Blonde", "Leffe", "LEFFE"],
    // the misses of the plain rule (d-beerpin DONE research 5): the hand list fixes them
    ["Mariestads Export", "Mariestads", "MARIESTAD"], ["Norrlands Guld", "Norrlands Guld", "NORRLANDS"], ["Staropramen", "Staropramen", "STARO"],
    ["Carlsberg Danish Organic Pilsner", "Carlsberg", "CARLSBERG"], ["Brooklyn east IPA", "Brooklyn Brewery", "EAST IPA"],
    ["Pripps BLa", "Pripps Blå", "PRIPPS"], ["Falcon Export Ljus Lager", "Falcon Export Ljus Lager", "FALCON"], ["Green Pilsner", "Tuborg", "TUBORG"],
    ["Heineken lager beer", "Heineken", "HEINEKEN"],
    // the rule (not in the hand list)
    ["Lucky bait", "Spendrups", "LUCKY"], ["Ab Pils", "", "PILS"],
  ];
  for (const [n, b, s] of want) assert.equal(M.shortName(n, b, s === "PILS" ? "tysk-pilsner" : ""), s, n);
});

test("short names on all 1 489 beers: never longer than allowed, never cut with an ellipsis, never junk", () => {
  let empty = 0;
  for (const r of rows) {
    const s = M.shortName(r.name, r.brewery, r.style);
    if (!s) { empty++; continue; }
    const hand = M.hand(r.name, r.brewery);
    assert.ok(s.length <= (hand ? M.MAXH : M.MAX), r.name + " -> " + s);
    assert.ok(!/…|\.\.\./.test(s), r.name + " -> " + s);
    assert.ok(M.okName(s), r.name + " -> " + s);
    assert.equal(s, s.toUpperCase(), r.name);
    assert.ok(s.length >= 3 || hand || /^(IPA|APA|WIT)$/.test(s), r.name + " -> " + s);
  }
  // "" = the button keeps the normal ÖL! (never a guessed name); few beers
  assert.ok(empty < rows.length * 0.05, "empty " + empty);
});

test("hand list: valid rows, unique names, every row matches a real beer or a known brand", () => {
  const names = new Set();
  for (const h of M.HAND) {
    assert.equal(typeof h[0].test, "function");
    assert.ok(M.okName(h[1]) && h[1].length <= M.MAXH, h[1]);
    assert.ok(!names.has(h[1]), "twice: " + h[1]); names.add(h[1]);
    assert.ok(h[2] === "b" || h[2] === "c", h[1]);
    assert.ok(HEX.test(h[3]) && HEX.test(h[4]) && HEX.test(h[5]), h[1]);
  }
  assert.ok(M.HAND.length >= 55, "about 60 common beers in Sweden: " + M.HAND.length);
  const hit = M.HAND.filter((h) => rows.some((r) => h[0].test(M.norm(r.name)) || (h[6] && h[0].test(M.norm(r.brewery)))));
  assert.ok(hit.length >= 45, "rows that match the shipped data: " + hit.length);
  // a special beer before its brand
  assert.equal(M.look({ name: "1664 Blanc Wheat Beer" }).sn, "BLANC");
  assert.equal(M.look({ name: "Kronenbourg 1664" }).sn, "1664");
  assert.equal(M.look({ name: "Carlsberg hof" }).sn, "HOF");
});

test("contrast: the label ink passes 4.5:1 on every style colour, every hand colour and every kind colour", () => {
  const all = new Set([...styles.map((s) => s.hex), "#C35900", ...M.HAND.map((h) => h[5]), ...Object.values(M.KIND_LIQ)]);
  for (const c of all) {
    const k = M.inkFor(c);
    assert.ok(k.ink === M.INK_D || k.ink === M.INK_L, c);
    assert.ok(M.ratio(k.ink, k.fill) >= 4.5 && M.ratio(k.ink, k.hi) >= 4.5, c + " " + JSON.stringify(k));
  }
  // the ink with the higher contrast: dark on pale, foam on dark
  assert.equal(M.inkFor("#FFCA5A").ink, M.INK_D);
  assert.equal(M.inkFor("#300A06").ink, M.INK_L);
  assert.equal(M.inkFor("#C35900").moved, true);   // amber ale: the fill moves until it passes
});

test("look: a beer that is not in the hand list = a bottle in its own beer colour with a foam band; no style = the kind's colour", () => {
  const b = rows.find((r) => r.style === "ipa" && !M.hand(r.name, r.brewery));
  const ipa = styles.find((s) => s.id === "ipa").hex;
  const lk = M.look(b, ipa, "ipa");
  assert.deepEqual([lk.pk, lk.c1, lk.c2, lk.liq], ["b", ipa, M.FOAM, ipa]);
  assert.equal(M.look({ name: "Okänd öl" }, null, "stout").liq, M.KIND_LIQ.stout);
  assert.equal(M.look({ name: "Okänd öl" }, null, "").liq, M.KIND_LIQ.lager);
});

test("the drawn bottle / can: colours only, no picture, no text, no marks; a bad stored look draws nothing", () => {
  for (const id of ["5740700980176", "7310401006925"]) {
    const r = rows.find((x) => x.id === id);
    const s = M.svg(M.look(r));
    assert.ok(s.startsWith("<svg") && !/<text|<image|href=|<foreignObject|<script/i.test(s), s);
  }
  assert.ok(/mb-can/.test(M.svg(M.look({ name: "Norrlands Guld" }))));
  assert.ok(/mb-bottle/.test(M.svg(M.look({ name: "Leffe Blonde" }))));
  assert.equal(M.svg({ pk: "b", c1: '#123456" onload="x', c2: "#FFFFFF", liq: "#FFFFFF", sn: "X" }), "");
  assert.equal(M.clean({ pk: "z", c1: "#123456", c2: "#FFFFFF", liq: "#FFFFFF" }), null);
  assert.equal(M.clean({ pk: "b", c1: "#123456", c2: "#FFFFFF", liq: "#FFFFFF", sn: "<b>" }).sn, "");
});
