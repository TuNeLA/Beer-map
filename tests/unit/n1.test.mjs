// U.n1: a lone "1" before a Swedish plural noun becomes the singular (js/util.js, fixJ T-22)
import test from "node:test";
import assert from "node:assert/strict";
import { loadScript } from "./load.mjs";

const U = loadScript("js/util.js").U;

test("n1: 1 + plural noun -> singular", () => {
  assert.equal(U.n1("1 prickar"), "1 prick");
  assert.equal(U.n1("Du har 1 drycker"), "Du har 1 dryck");
  assert.equal(U.n1("1 skål utdelade"), "1 skål utdelad");
  assert.equal(U.n1("1 öl loggade"), "1 öl loggad");
  assert.equal(U.n1("1 krogar"), "1 krog");
});
test("n1: not a lone 1 -> no change", () => {
  for (const s of ["21 prickar", "11 prickar", "1,5 timmar", "0.1 timmar", "3 prickar", "1:1 prickar"]) assert.equal(U.n1(s), s);
});
test("n1: other words and the end of a word are not touched", () => {
  assert.equal(U.n1("1 prickarna"), "1 prickarna");
  assert.equal(U.n1("1 bil"), "1 bil");
  assert.equal(U.n1(""), "");
});
test("n1: null / undefined / number pass through", () => {
  assert.equal(U.n1(null), null);
  assert.equal(U.n1(undefined), undefined);
  assert.equal(U.n1(5), "5");
});
test("n1: more than one match in one text", () => {
  assert.equal(U.n1("1 kompisar och 1 grupper, 2 grupper"), "1 kompis och 1 grupp, 2 grupper");
});
test("pl: one / many", () => {
  assert.equal(U.pl(1, "öl", "öl"), "1 öl");
  assert.equal(U.pl(2, "prick", "prickar"), "2 prickar");
  assert.equal(U.pl(1, "prick", "prickar"), "1 prick");
  assert.equal(U.pl(0, "prick", "prickar"), "0 prickar");
});
