// hitta2 (I-92): the calm compass helpers in js/hitta.js (HITTA.calm): heading, smoothing, unwrap, position filter, near.
import test from "node:test";
import assert from "node:assert/strict";
import { loadScript } from "./load.mjs";

const C = () => loadScript("js/hitta.js").HITTA.calm;
const cd = (a, b) => { const d = ((b - a) % 360 + 540) % 360 - 180; return Math.abs(d); };

test("hitta2: unwrap never goes the long way round", () => {
  const c = C();
  assert.equal(c.unwrap(359, 1), 361);
  assert.equal(c.unwrap(-179, 179), -181);
  assert.equal(c.unwrap(null, 42), 42);
  let r = null; for (const t of [350, 10, 355, 5, -170, 190]) { const n = c.unwrap(r, t); if (r != null) assert.ok(Math.abs(n - r) <= 180, t + ": " + n + " from " + r); r = n; }
});

test("hitta2: heading = 360 - alpha flat, tilt-compensated upright, + screen angle; bad iOS accuracy", () => {
  const c = C();
  const h = (o, so) => c.heading(Object.assign({ type: "deviceorientationabsolute", absolute: true }, o), so);
  assert.ok(cd(h({ alpha: 90, beta: 0, gamma: 0 }).h, 270) < 0.5);
  assert.ok(cd(h({ alpha: 90, beta: 80, gamma: 0 }).h, 270) < 0.5, "upright, no roll: same heading");
  assert.ok(cd(h({ alpha: 90, beta: 0, gamma: 0 }, 90).h, 0) < 0.5, "landscape adds the screen angle");
  // upright with a roll: the back camera direction rules, top edge alone would be off
  const up = h({ alpha: 0, beta: 89, gamma: 30 }).h;
  assert.ok(cd(up, 330) < 3, "upright + roll 30: back camera heading " + up);
  assert.equal(c.heading({ webkitCompassHeading: 12, webkitCompassAccuracy: -1 }), null);
  assert.equal(c.heading({ webkitCompassHeading: 12, webkitCompassAccuracy: 10 }).h, 12);
  assert.equal(c.heading({ type: "deviceorientation", absolute: false, alpha: 10 }), null, "relative alpha is no compass");
});

test("hitta2: the filter is stable around 359/1, drops one outlier, follows a real turn", () => {
  const c = C(), f = c.headingFilter();
  let t = 1000, last = null, maxStep = 0;
  for (let i = 0; i < 200; i++) {
    t += 16; const noise = (i % 2 ? 1 : -1) * (5 + (i * 7) % 15);
    const v = f.push({ h: (360 + noise) % 360 }, t);
    if (last != null) maxStep = Math.max(maxStep, cd(last, v)); last = v;
  }
  assert.ok(maxStep < 5, "step " + maxStep);
  assert.ok(cd(last, 0) < 8, "near 0: " + last);
  assert.equal(f.noisy(t), false, "±12° noise is no calibrate hint");
  const before = f.value(); f.push({ h: 120 }, t += 16); assert.ok(cd(f.value(), before) < 1, "one outlier dropped");
  for (let i = 0; i < 60; i++) f.push({ h: 90 }, t += 16);
  assert.ok(cd(f.value(), 90) < 10, "a real turn is followed: " + f.value());
  const g = c.headingFilter(); let n = 1e5;
  for (let i = 0; i < 40; i++) g.push({ h: (i * 47) % 360 }, n += 50);
  assert.equal(g.noisy(n), true, "random heading = calibrate hint");
});

test("hitta2: position filter ignores a coarse fix while a good one is fresh, and averages", () => {
  const c = C(), p = c.posFilter();
  p.push({ lat: 60, lng: 15, acc: 10 }, 1000);
  const v = p.push({ lat: 60.01, lng: 15.01, acc: 200 }, 2000);
  assert.equal(v.lat, 60, "coarse fix ignored");
  p.push({ lat: 60.0001, lng: 15, acc: 10 }, 3000);
  assert.ok(Math.abs(p.value().lat - 60.00005) < 1e-9);
  const q = c.posFilter(); q.push({ lat: 60, lng: 15, acc: 10 }, 0);
  assert.equal(q.push({ lat: 61, lng: 15, acc: 200 }, 40000).lat, 61, "a coarse fix is used when nothing better is < 30 s old");
});

test("hitta2: near under 20 m or under the GPS error (max 50), hysteresis", () => {
  const c = C();
  assert.equal(c.near(12, 5, 5, false), true);
  assert.equal(c.near(25, 5, 5, false), false);
  assert.equal(c.near(25, 5, 5, true), true, "hysteresis: stay near to 26 m");
  assert.equal(c.near(35, 30, 30, false), true, "inside the combined GPS error");
  assert.equal(c.near(60, 80, 80, false), false, "cap 50 m");
  assert.equal(c.ago(130, true), "för 2 min sedan");
});
