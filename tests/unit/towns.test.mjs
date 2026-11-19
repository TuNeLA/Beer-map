// E7 (data-sources.md item 10): town names come from our own list (js/towns.js + js/towns-data.js, SCB tätorter, CC0),
// not from Nominatim. These tests run the REAL files in a vm sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { DOCS } from "./load.mjs";

function towns() {
  const w = { document: { querySelectorAll: () => [] } }; w.window = w;
  const ctx = vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.join(DOCS, "js/towns-data.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(DOCS, "js/towns.js"), "utf8"), ctx);
  return w.TOWNS;
}

test("towns: the data file has every tätort (≥ 1 900 rows, SCB CC0) and Ludvika with its demonym", () => {
  const T = towns(), all = T.list();
  assert.ok(all.length >= 1900, "rows " + all.length);
  const lud = all.find((t) => t.name === "Ludvika");
  assert.ok(lud && lud.kommun === "Ludvika" && lud.dem === "Ludvikabo" && lud.pop > 10000);
  assert.match(T.src(), /SCB/);
});
test("towns: nearest() on the phone: Ludvika centre, Grängesberg, Södermalm = Stockholm (the city, not a village)", () => {
  const T = towns();
  assert.equal(T.nearest(60.1496, 15.1878).name, "Ludvika");
  assert.equal(T.nearest(60.0840, 15.0150).name, "Grängesberg");
  assert.equal(T.nearest(59.3150, 18.0720).name, "Stockholm");
  assert.equal(T.nearest(59.3150, 18.0720).inside, true);
  assert.equal(T.nearest(10, 10), null);                   // far from Sweden → nothing
});
test("towns: areaNow(): a town name in or near a tätort, '<kommun> kommun' in the forest", () => {
  const T = towns();
  assert.equal(T.areaNow(60.1496, 15.1878), "Ludvika");
  const forest = T.areaNow(60.36, 15.47);                  // forest north-east of Ludvika, > 3 km from any tätort
  assert.match(forest, / kommun$/);
});
test("towns: near() gives the n nearest, closest first", () => {
  const n = towns().near(60.1496, 15.1878, 3);
  assert.equal(n.length, 3); assert.equal(n[0].name, "Ludvika"); assert.ok(n[0].d <= n[1].d && n[1].d <= n[2].d);
});
test("E7: no Nominatim REVERSE call from the client code (town names come from js/towns.js)", () => {
  const files = fs.readdirSync(path.join(DOCS, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f).concat(["app.js"]);
  const bad = files.filter((f) => /nominatim\.openstreetmap\.org\/reverse/.test(fs.readFileSync(path.join(DOCS, f), "utf8")));
  assert.deepEqual(bad, []);
});
