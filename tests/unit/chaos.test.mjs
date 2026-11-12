// Kaos i stan: CHAOS.compute (js/chaos.js). Counts only, never names.
import test from "node:test";
import assert from "node:assert/strict";
import { loadScript } from "./load.mjs";

const U = loadScript("js/util.js").U;
const C = { lat: 60.1496, lng: 15.1878 };   // Ludvika
const beer = (n, o) => Object.assign({ lat: C.lat + (n % 5) * 0.0001, lng: C.lng + Math.floor(n / 5) * 0.0001, beer_count: 1 }, o || {});
const many = (n, o) => Array.from({ length: n }, (_, i) => beer(i, o));
function chaos(extra) { return loadScript("js/chaos.js", Object.assign({ U }, extra || {})).CHAOS; }

test("chaos: empty / null input is calm", () => {
  const r = chaos().compute(null, C);
  assert.deepEqual([r.on, r.out, r.hot, r.target], [false, 0, 0, null]);
});
test("chaos: 9 people out = off, 10 = on", () => {
  assert.equal(chaos().compute(many(9), C).on, false);
  assert.equal(chaos().compute(many(10), C).on, true);
});
test("chaos: 3 people with 5+ drinks = on even when few are out", () => {
  const hot = (n) => many(n, { beer_count: 5 });
  assert.equal(chaos().compute(hot(2), C).on, false);
  const r = chaos().compute(hot(3), C);
  assert.equal(r.on, true); assert.equal(r.hot, 3); assert.equal(r.out, 3);
});
test("chaos: beer_count 4 is not hot", () => {
  assert.equal(chaos().compute(many(5, { beer_count: 4 }), C).hot, 0);
});
test("chaos: people farther than 5 km do not count", () => {
  const far = many(12, { lat: C.lat + 0.1 });   // ~11 km
  assert.equal(chaos().compute(far, C).out, 0);
  assert.equal(chaos().compute(many(12).concat(far), C).out, 12);
});
test("chaos: no busy bar -> target = mean of the densest 300 m group, zoom 15", () => {
  const r = chaos().compute(many(10), C);
  assert.equal(r.on, true); assert.equal(r.bar, null);
  assert.equal(r.target.zoom, 15);
  assert.ok(Math.abs(r.target.lat - C.lat) < 0.001 && Math.abs(r.target.lng - C.lng) < 0.001);
});
test("chaos: only lone people far apart -> target = the centre at zoom 13", () => {
  // 10 people, each ~450 m from the next (all inside 5 km): no group of 2 within 300 m
  const lone = Array.from({ length: 10 }, (_, i) => ({ lat: C.lat + i * 0.004, lng: C.lng, beer_count: 1 }));
  const r = chaos().compute(lone, C);
  assert.equal(r.on, true);
  assert.equal(JSON.stringify(r.target), JSON.stringify({ lat: C.lat, lng: C.lng, zoom: 13 }));   // (JSON: the vm has its own Object)
});
test("chaos: city name comes from CITIES.nearest, busiest bar needs 2+ people", () => {
  const bars = { assign: (near) => ({ perBar: { a: { beers: near.slice(0, 1), bar: { name: "Ensam" } }, b: { beers: near.slice(0, 4), bar: { name: "Pitchers" } } } }) };
  const r = chaos({ CITIES: { nearest: () => ({ name: "Ludvika" }) }, BARS: bars }).compute(many(10), C);
  assert.equal(r.city, "Ludvika");
  assert.ok(r.bar, "a bar is picked");
  assert.equal(JSON.stringify(r.bar).includes("Pitchers"), true);
  assert.equal(JSON.stringify(r.bar).includes("Ensam"), false);
});
test("chaos: RADIUS_M is exported", () => { assert.equal(chaos().RADIUS_M, 5000); });
