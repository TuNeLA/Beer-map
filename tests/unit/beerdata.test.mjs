// lane beerlist (24 Nov): the beer library data has no rows of the classes that showed "A ship full of IPA · 0,0 %".
// The audit (scripts/beer/checks.mjs) runs on the SHIPPED docs/data/beer/*.json: 0 % on a beer that is not alcohol-free,
// an alcohol-free mark with no evidence, impossible ABV, an ABV far outside the style, unknown style, the same beer twice,
// broken photo links, aliases to nothing, things that are not a drink. Old data: 68 problems -> this test fails.
// And the app's second lock: js/beerlib.js abvText() never writes a number that does not fit the mark.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { audit, afOk, sameBeer, flagshipStyle } from "../../scripts/beer/checks.mjs";

const DOCS = new URL("../../docs/", import.meta.url);
const beers = JSON.parse(fs.readFileSync(new URL("data/beer/beers.json", DOCS), "utf8"));
const styles = JSON.parse(fs.readFileSync(new URL("data/beer/styles.json", DOCS), "utf8"));
const img = new Set(fs.readdirSync(new URL("data/beer/img/", DOCS)));
const rows = beers.rows.map((r) => Object.fromEntries(beers.cols.map((c, i) => [c, r[i]])));
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
for (const [a, k] of Object.entries(beers.alias || {})) if (byId[k] && !byId[a]) byId[a] = byId[k];   // like js/beerlib.js load()

test("the shipped beer data passes every check (0 problems)", () => {
  const p = audit(beers, styles, img);
  assert.deepEqual(p.slice(0, 20), [], p.length + " problems");
});

test("A ship full of IPA (the owner's case): it IS the alcohol-free bottle and the line now says so", () => {
  // the photo of 7310401034799 says "ALCOHOL FREE 33cl, 0.0%"; the normal can is 7310401039992 "Ship Full Of IPA"
  const r = byId["7310401034799"], can = byId["7310401039992"];
  assert.ok(r && can && r.id !== can.id, "two rows, never merged across the alcohol-free mark");
  assert.equal(r.af, 1);
  assert.equal(can.af, 0);
  assert.equal(can.abv, null);
  const af = byId["7310402049013"];   // "A Ship Full of IPA Alcohol Free" (can) keeps its mark
  assert.equal(af.af, 1);
  assert.equal(af.style, "alkoholfri");
});

test("alcohol-free needs evidence and no contradiction", () => {
  assert.equal(afOk({ name: "A ship full of IPA", brewery: "Brutal Brewing", abv: 0, af: true, cat: true }), true, "the source's category");
  assert.equal(afOk({ name: "Donker", brewery: "Kasteel", abv: 0, af: true }), false, "an exact 0 alone is the empty form default");
  assert.equal(afOk({ name: "500 Imperial India Pale Ale", brewery: "", abv: 0.1, af: true, cat: true }), false, "a strong name");
  assert.equal(afOk({ name: "Triple", brewery: "St Feuillien", abv: 0.26, af: true }), false);
  assert.equal(afOk({ name: "Donker", brewery: "Kasteel", abv: 0, af: true, cat: true, strongStyle: true }), false, "a strong style");
  assert.equal(afOk({ name: "1664 fruits rouges", brewery: "1664", abv: 4.5, af: true, cat: true }), false, "more than 0,5 %");
  assert.equal(afOk({ name: "A Ship Full of IPA Alcohol Free", brewery: "Brutal Brewing", abv: null, af: true }), true);
  assert.equal(afOk({ name: "Bavaria IPA 0%", brewery: "", abv: 0, af: true }), true);
  assert.equal(afOk({ name: "Pilsner 0,0", brewery: "", abv: null, af: true }), true);
  assert.equal(afOk({ name: "Erikois IPA Alkoholiton", brewery: "", abv: null, af: true }), true);
  assert.equal(afOk({ name: "Juleøl", brewery: "Munkholm", abv: null, af: true }), true);
  assert.equal(afOk({ name: "Special Effects Hoppy Lager", brewery: "Brooklyn", abv: 0.4, af: true }), true);
  assert.equal(afOk({ name: "Grevens Cider Pære Uten Tilsatt Sukker", brewery: "", abv: null, af: true }), false);
  assert.equal(afOk({ name: "Pilsner 0,0", brewery: "", abv: null, af: false }), true, "the name wins over the source");
});

test("the same beer: same name + the brand in the name or the same brewery", () => {
  assert.equal(sameBeer({ name: "Heineken", brewery: "Heineken" }, { name: "Heineken", brewery: "Hansa borg as" }), true);
  assert.equal(sameBeer({ name: "Corona Extra", brewery: "" }, { name: "Corona extra", brewery: "AB InBev" }), false);
  assert.equal(sameBeer({ name: "Corona Extra", brewery: "Corona" }, { name: "Corona extra", brewery: "AB InBev" }), true);
  assert.equal(sameBeer({ name: "Juicy IPA", brewery: "Ringnes as" }, { name: "Juicy IPA", brewery: "Carlsberg A/S" }), false);
  assert.equal(sameBeer({ name: "Jule øl", brewery: "Aass" }, { name: "Jule øl", brewery: "Tuborg" }), false);
  assert.equal(sameBeer({ name: "Ship Full of IPA", brewery: "Brutal Brewing", af: 1 }, { name: "Ship Full Of IPA", brewery: "Brutal Brewing", af: 0 }), false);
  assert.equal(sameBeer({ name: "A ship full of IPA", brewery: "Brutal Brewing" }, { name: "Ship Full Of IPA", brewery: "Brutal Brewing" }), false);
});

test("a name that is only a big brand gets the flagship style; any other word = no guess", () => {
  assert.equal(flagshipStyle("Heineken Bier"), "ljus-lager");
  assert.equal(flagshipStyle("Staropramen st 330"), "ljus-lager");
  assert.equal(flagshipStyle("Heineken 0"), null);
  assert.equal(flagshipStyle("Erdinger Dunkel"), null);
  assert.equal(flagshipStyle("Amstel Radler"), null);
});

test("no row: 0 % on a beer that is not alcohol-free; no ABV outside 0–16 %; no vinegar", () => {
  for (const r of rows) {
    if (r.abv != null) assert.ok(r.af ? r.abv <= 0.5 : r.abv >= 0.6 && r.abv <= 16, r.id + " " + r.name + " " + r.abv);
    assert.ok(!/eddike|vinegar/i.test(r.name), r.name);
  }
});

test("abvText (js/beerlib.js): never a number that does not fit the mark", () => {
  const win = {};
  vm.runInNewContext(fs.readFileSync(new URL("js/beerlib.js", DOCS), "utf8"), { window: win, document: {} });
  const t = win.BEERLIB.h.abvText;
  assert.equal(t({ abv: 0, af: 0 }), "", "0 % on a normal beer");
  assert.equal(t({ abv: 0.3, af: 0 }), "", "0,3 % on a normal beer");
  assert.equal(t({ abv: 99, af: 0 }), "", "impossible");
  assert.equal(t({ abv: 6.5, af: 1 }), "Alkoholfri", "alcohol-free with a strong number: only the word");
  assert.equal(t({ abv: 0, af: 1 }), "Alkoholfri 0,0\u00a0%", "the owner's case: the word is always there");
  assert.equal(t({ abv: 5.2, af: 0 }), "5,2 %");
  assert.equal(t({ abv: null, af: 1 }), "Alkoholfri");
});

test("the owner's case in the app: the alcohol-free bottle says 'Alkoholfri 0,0 %', the normal can shows no number", () => {
  const win = {};
  vm.runInNewContext(fs.readFileSync(new URL("js/beerlib.js", DOCS), "utf8"), { window: win, document: {} });
  assert.equal(win.BEERLIB.h.abvText(byId["7310401034799"]), "Alkoholfri 0,0\u00a0%");
  assert.equal(win.BEERLIB.h.abvText(byId["7310401039992"]), "");
});
