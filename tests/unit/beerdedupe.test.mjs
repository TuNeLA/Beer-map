// lane fixC (polish sweep 24 Nov, P-11): the beer list had the same beer many times under its name in other languages and packs
// (Heineken x 12: "Heineken", "Beer Heineken", "Heineken Bier", "Birra Heineken", "Heineken st 330" ...). scripts/beer/checks.mjs
// coreKey() drops the word "beer" in any language, pack words and pack sizes, and the word order; sameBeer() uses it. The build
// keeps one row (the cleanest name) and the other ids become aliases, so old favourites, chat tips and the scanner still work.
// Old checks: coreKey does not exist (import fails) and the shipped data has 221 duplicates (beerdata.test.mjs fails).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { coreKey, sameBeer } from "../../scripts/beer/checks.mjs";

const beers = JSON.parse(fs.readFileSync(new URL("../../docs/data/beer/beers.json", import.meta.url), "utf8"));
const rows = beers.rows.map((r) => Object.fromEntries(beers.cols.map((c, i) => [c, r[i]])));
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
const find = (id) => byId[id] || byId[beers.alias[id]] || null;   // like js/beerlib.js load()

test("coreKey: beer words, packs and word order out; numbers that name a beer stay", () => {
  for (const n of ["Heineken", "Beer Heineken", "Heineken Bier", "Birra Heineken", "Heineken Cerveza", "Heineken st 330", "Heineken x6", "Cerveja Heineken Lata"])
    assert.equal(coreKey(n), "heineken", n);
  assert.equal(coreKey("Carlsberg Pilsner 0,33lx10"), coreKey("Carlsberg Pilsner"));
  assert.equal(coreKey("Amstel Lager Beer 4 x Cans"), coreKey("Amstel Lager"));
  assert.notEqual(coreKey("Karhu 4,6"), coreKey("Karhu 5,3"));
  assert.notEqual(coreKey("5 luppoli"), coreKey("9 luppoli"));
  assert.notEqual(coreKey("Heineken 0"), coreKey("Heineken"));
  assert.notEqual(coreKey("Amstel Radler 2.0"), coreKey("Amstel Radler"));
  assert.notEqual(coreKey("Carlsberg Premium Bier"), coreKey("Carlsberg"), "'premium' is kept: a real product word for some brands");
  assert.equal(coreKey("Bière"), "", "only beer words = no core: never matches");
});

test("sameBeer with the core: same brand, any language; never across the alcohol-free mark or another brewery", () => {
  assert.equal(sameBeer({ name: "Heineken Bier", brewery: "Heineken" }, { name: "Beer Heineken", brewery: "Heineken" }), true);
  assert.equal(sameBeer({ name: "Corona Cerveza", brewery: "Corona" }, { name: "Bière corona", brewery: "AB InBev" }), true, "the brand is in the name");
  assert.equal(sameBeer({ name: "Heineken 0.0", brewery: "Heineken", af: 1 }, { name: "Heineken 0", brewery: "Heineken", af: 0 }), false);
  assert.equal(sameBeer({ name: "Juicy IPA Bier", brewery: "Ringnes as" }, { name: "Juicy IPA", brewery: "Carlsberg A/S" }), false);
  assert.equal(sameBeer({ name: "Bière", brewery: "Leffe" }, { name: "Birra", brewery: "Leffe" }), false);
});

test("the shipped data: the plain Heineken is one row named 'Heineken'; the old ids still find it", () => {
  const hk = rows.filter((r) => coreKey(r.name) === "heineken" && !r.af);
  assert.equal(hk.length, 1, hk.map((r) => r.name).join(", "));
  assert.equal(hk[0].name, "Heineken");
  for (const id of ["5035766063254", "8006890454208", "3830001714654", "5942105009081"])   // Beer Heineken, Birra Heineken, Heineken Bier, Heineken st 330
    assert.equal(find(id) && find(id).id, hk[0].id, id);
});

test("every alias points to a real row (nothing old is lost)", () => {
  for (const [a, k] of Object.entries(beers.alias)) assert.ok(byId[k], a + " -> " + k);
});
