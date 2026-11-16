// Auto hemma rule (I-127, owner 16 Nov 2026: "in Stockholm you can live 100 m from the bar ... more accuracy"):
// homeStep() in docs/js/autohome.js, loaded alone (it is pure). The rule is written out in the header of that file.
import test from "node:test";
import assert from "node:assert/strict";
import { findFunction } from "./load.mjs";

const homeStep = new Function(findFunction("homeStep").src + "; return homeStep;")();
const M = 1 / 111200;                         // 1 m of latitude in degrees
const HOME = { lat: 59.3150, lng: 18.0720, r: 100, ar: 100 };
const at = (dN, acc, t) => ({ lat: HOME.lat + dN * M, lng: HOME.lng, acc, t });
// feed readings through the rule like autohome.js onFix does (run + lastBar carry over)
function walk(fixes, o = {}) {
  let run = null, lastBar = o.lastBar || null, out = null;
  for (const f of fixes) { out = homeStep({ fix: f, home: o.home || HOME, ci: o.ci || null, bars: o.bars ? o.bars(f) : [], lastBar, run }); run = out.run; lastBar = out.lastBar; if (out.act) break; }
  return out;
}

test("autohome: 2 good readings inside the zone, 2 min apart → home", () => {
  assert.equal(walk([at(10, 15, 0), at(5, 12, 120e3)]).why, "act");
});
test("autohome: under 2 min, or 1 reading → not yet", () => {
  assert.equal(walk([at(10, 15, 0), at(5, 12, 100e3)]).why, "dwell");
  assert.equal(walk([at(10, 15, 0)]).why, "first");
});
test("autohome: checked in at a bar 60 m from home → never home (the bar wins)", () => {
  const bar = { lat: HOME.lat + 60 * M, lng: HOME.lng };
  const o = walk([at(60, 10, 0), at(60, 10, 3 * 60e3), at(60, 10, 11 * 60e3)], { ci: bar });
  assert.equal(o.act, undefined); assert.equal(o.why, "bar");
});
test("autohome: a known bar within 40 m of the reading (no check-in) → not home", () => {
  const bars = () => [{ lat: HOME.lat + 60 * M, lng: HOME.lng }];
  assert.equal(walk([at(45, 10, 0), at(45, 10, 5 * 60e3)], { bars }).why, "bar");
});
test("autohome: moved away from my last bar: still in its 40 m + accuracy → not home; clearly out → home", () => {
  const lastBar = { lat: HOME.lat + 60 * M, lng: HOME.lng };
  assert.equal(walk([at(15, 20, 0), at(15, 20, 3 * 60e3)], { lastBar }).why, "near_bar");   // 45 m from the bar, 40 + 20 = 60
  assert.equal(walk([at(-20, 10, 0), at(-20, 10, 3 * 60e3)], { lastBar }).why, "act");        // 80 m from the bar
});
test("autohome: accuracy must beat the radius and 50 m; a bad reading neither counts nor resets", () => {
  const small = { ...HOME, ar: 25 };
  assert.equal(walk([at(0, 30, 0), at(0, 30, 11 * 60e3)], { home: small }).why, "accuracy");
  assert.equal(walk([at(0, 60, 0), at(0, 60, 11 * 60e3)]).why, "accuracy");
  assert.equal(walk([at(0, 10, 0), at(0, 80, 60e3), at(0, 10, 130e3)]).why, "act");
});
test("autohome: outside the zone (no slack) resets; old saves without ar use r; the zone is capped at 200 m", () => {
  assert.equal(walk([at(10, 10, 0), at(120, 10, 60e3), at(10, 10, 130e3)]).why, "first");
  assert.equal(walk([at(90, 10, 0), at(90, 10, 3 * 60e3)], { home: { lat: HOME.lat, lng: HOME.lng, r: 100 } }).why, "act");
  assert.equal(walk([at(250, 10, 0), at(250, 10, 3 * 60e3)], { home: { ...HOME, ar: 1000, r: 1000 } }).why, "away");
});
