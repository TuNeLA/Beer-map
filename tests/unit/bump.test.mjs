// Skåla med telefonen (lane bump, docs/js/bump.js): shake + knock detectors on synthetic motion samples (60 Hz, m/s²).
// The samples copy real shapes: rest = gravity + noise, shake = 4 Hz swings, walk = 2 Hz steps, knock = a calm approach,
// one 2-sample spike and a short ring, drop = free fall then a hit. Tune CFG on real phones with ?bumpdebug=1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../../docs/js/bump.js", import.meta.url), "utf8");
const win = { PN: {} };
vm.runInNewContext(src, { window: win });
const { makeMotion, CFG } = win.PN.bump;

const DT = 1000 / 60, G = 9.81;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);   // deterministic noise
function gen() {
  const s = []; let t = 0;
  const api = {
    rest(ms, noise = 0.3) { for (let e = 0; e < ms; e += DT, t += DT) s.push([t, rnd() * noise, rnd() * noise, G + rnd() * noise]); return api; },
    shake(ms, amp = 22, hz = 4) { for (let e = 0; e < ms; e += DT, t += DT) s.push([t, amp * Math.sin(2 * Math.PI * hz * e / 1000) + rnd(), rnd(), G + rnd()]); return api; },
    walk(ms) { for (let e = 0; e < ms; e += DT, t += DT) { const ph = (e / 500) % 1; s.push([t, rnd(), 1.5 * Math.sin(2 * Math.PI * e / 1000), G + (ph < 0.12 ? 6 : 0) + rnd()]); } return api; },
    // the hands bring the phones together (gentle push), then the hit, then a short ring
    knock(peak = 32) {
      for (let e = 0; e < 300; e += DT, t += DT) s.push([t, rnd() * 0.3, 3 * Math.sin(Math.PI * e / 300), G + rnd() * 0.3]);
      for (const v of [-peak, peak * 0.6, -4, 2]) { s.push([t, rnd(), v, G]); t += DT; }
      return api;
    },
    drop() {
      for (let e = 0; e < 260; e += DT, t += DT) s.push([t, rnd() * 0.2, rnd() * 0.2, rnd() * 0.5]);   // free fall: |a incl. g| ≈ 0
      for (const v of [45, -10, 3]) { s.push([t, rnd(), rnd(), G + v]); t += DT; }
      return api;
    },
    samples: () => s,
  };
  return api;
}
function run(samples, m = makeMotion(), lin = false) {
  const ev = [];
  for (const [t, x, y, z] of samples) for (const e of m.feed(t, x, y, lin ? z - G : z, lin)) ev.push(e);
  return { ev, m, n: (type) => ev.filter((e) => e.type === type).length };
}
const fillUp = (g) => g.rest(500).shake(2500).rest(1000);

test("rest: no peak, no ready, no knock", () => {
  const r = run(gen().rest(3000).samples());
  assert.equal(r.ev.length, 0);
  assert.equal(r.m.phase(), "fill");
});
test("shake 2.5 s: the glass fills, then READY once after 700 ms still; the shake is never a knock", () => {
  const r = run(fillUp(gen()).samples());
  assert.ok(r.n("peak") >= CFG.fillPeaks, "peaks " + r.n("peak"));
  assert.equal(r.n("ready"), 1);
  assert.equal(r.n("knock"), 0);
  assert.equal(r.m.fill(), 1);
  assert.equal(r.m.phase(), "ready");
});
test("a short shake fills only part of the glass", () => {
  const r = run(gen().rest(300).shake(600).rest(800).samples());
  assert.ok(r.m.fill() > 0 && r.m.fill() < 1, "fill " + r.m.fill());
  assert.equal(r.n("ready"), 0);
});
test("walking with the phone: no fill", () => {
  const r = run(gen().walk(5000).samples());
  assert.equal(r.n("peak"), 0);
});
test("READY + knock: exactly one knock, at the spike", () => {
  const g = fillUp(gen()); const before = g.samples().length; g.knock().rest(600);
  const spikeT = g.samples()[before + Math.round(300 / DT)][0];
  const r = run(g.samples());
  assert.equal(r.n("knock"), 1);
  const k = r.ev.find((e) => e.type === "knock");
  assert.ok(Math.abs(k.t - spikeT) <= DT * 2, "knock t " + k.t + " vs " + spikeT);
  assert.ok(k.peak >= CFG.knockPeak);
  assert.equal(r.m.phase(), "sent");
});
test("knock before the glass is full: nothing", () => {
  const r = run(gen().rest(500).knock().rest(600).samples());
  assert.equal(r.n("knock"), 0);
});
test("still shaking after READY: no knock", () => {
  const r = run(fillUp(gen()).shake(1500, 30).rest(300).samples());
  assert.equal(r.n("knock"), 0);
});
test("a soft tap (12 m/s²) is not a knock", () => {
  const r = run(fillUp(gen()).knock(12).rest(600).samples());
  assert.equal(r.n("knock"), 0);
});
test("a dropped phone (free fall, then a hit) is not a knock", () => {
  const r = run(fillUp(gen()).rest(500).drop().rest(600).samples());
  assert.equal(r.n("knock"), 0);
});
test("after a miss: rearm → the next knock counts; reset → fill again", () => {
  const g = fillUp(gen()).knock().rest(1200);
  const m = makeMotion(); let r = run(g.samples(), m);
  assert.equal(r.n("knock"), 1);
  m.rearm(); assert.equal(m.phase(), "ready");
  const t0 = g.samples().at(-1)[0];
  const more = gen().knock().rest(600).samples().map(([t, x, y, z]) => [t + t0 + DT, x, y, z]);
  r = run(more, m); assert.equal(r.n("knock"), 1);
  m.reset(); assert.equal(m.phase(), "fill"); assert.equal(m.fill(), 0);
});
test("event.acceleration (no gravity) works the same", () => {
  const r = run(fillUp(gen()).knock().rest(600).samples(), makeMotion(), true);
  assert.equal(r.n("ready"), 1);
  assert.equal(r.n("knock"), 1);
});
test("null samples (desktop Chromium) are skipped", () => {
  const m = makeMotion();
  assert.equal(m.feed(0, null, null, null).length, 0);
  assert.equal(m.feed(16, NaN, 1, 1).length, 0);
  assert.equal(m.fill(), 0);
});
