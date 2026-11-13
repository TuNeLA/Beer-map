// Skåla med telefonen (lane bump, docs/js/bump.js): shake / knock / tilt-to-drink on synthetic motion samples (60 Hz, m/s²).
// The samples copy real shapes: rest = gravity + noise, shake = 4 Hz swings, walk = 2 Hz steps (hand and pocket), knock = a calm
// approach + one 2-sample hit + a short ring, drop = free fall then a hit, tilt = the phone turning like a glass (Android signs;
// iPhone = the same values with the opposite sign). Tune CFG on real phones with ?bumpdebug=1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../../docs/js/bump.js", import.meta.url), "utf8");
const win = { PN: {} };
vm.runInNewContext(src, { window: win, document: { addEventListener() {} }, location: { search: "" } });
const { makeMotion, makeDrain, CFG } = win.PN.bump;

const DT = 1000 / 60, G = 9.81, D2R = Math.PI / 180;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);   // deterministic noise
function gen() {
  const s = []; let t = 0;
  const push = (x, y, z) => { s.push([t, x, y, z]); t += DT; };
  const api = {
    rest(ms, noise = 0.3) { for (let e = 0; e < ms; e += DT) push(rnd() * noise, rnd() * noise, G + rnd() * noise); return api; },
    shake(ms, amp = 22, hz = 4) { for (let e = 0; e < ms; e += DT) push(amp * Math.sin(2 * Math.PI * hz * e / 1000) + rnd(), rnd(), G + rnd()); return api; },
    walk(ms) { for (let e = 0; e < ms; e += DT) { const ph = (e / 500) % 1; push(rnd(), 1.5 * Math.sin(2 * Math.PI * e / 1000), G + (ph < 0.12 ? 6 : 0) + rnd()); } return api; },
    // phone in a trouser pocket: heel strike 1.9 Hz (2-sample spike up to 16 m/s²), thigh swing, upside-down-ish and noisy
    pocket(ms) {
      for (let e = 0; e < ms; e += DT) {
        const ph = (e * 1.9 / 1000) % 1, heel = ph < 0.035 ? 16 : ph < 0.07 ? -7 : 0;
        push(5 * Math.sin(2 * Math.PI * 1.9 * e / 1000) + rnd() * 2, -G + heel + 3 * Math.sin(2 * Math.PI * 3.8 * e / 1000) + rnd() * 2, 2 * Math.cos(2 * Math.PI * 1.9 * e / 1000) + rnd() * 2);
      }
      return api;
    },
    knock(peak = 32) {
      for (let e = 0; e < 300; e += DT) push(rnd() * 0.3, 3 * Math.sin(Math.PI * e / 300), G + rnd() * 0.3);
      for (const v of [-peak, peak * 0.6, -4, 2]) push(rnd(), v, G);
      return api;
    },
    drop() {
      for (let e = 0; e < 260; e += DT) push(rnd() * 0.2, rnd() * 0.2, rnd() * 0.5);   // free fall: |a incl. g| ≈ 0
      for (const v of [45, -10, 3]) push(rnd(), rnd(), G + v);
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

/* ---------- shake → open → fill → ready → knock ---------- */
test("rest: nothing opens", () => {
  const r = run(gen().rest(3000).samples());
  assert.equal(r.ev.length, 0);
  assert.equal(r.m.phase(), "idle");
});
test("shake 2.5 s: the glass opens by itself once, fills, then READY once after 700 ms still; never a knock", () => {
  const r = run(fillUp(gen()).samples());
  assert.equal(r.n("open"), 1);
  assert.ok(r.n("peak") >= 2, "peaks " + r.n("peak"));
  assert.equal(r.n("ready"), 1);
  assert.equal(r.n("knock"), 0);
  assert.equal(r.m.fill(), 1);
  assert.equal(r.m.phase(), "ready");
});
test("a short jolt (0.4 s) does not open the glass", () => {
  const r = run(gen().rest(300).shake(400).rest(800).samples());
  assert.equal(r.n("open"), 0);
});
test("walking with the phone in the hand: nothing opens", () => {
  assert.equal(run(gen().walk(8000).samples()).n("open"), 0);
});
test("phone in a pocket while walking (10 s, strong heel strikes): nothing opens", () => {
  const r = run(gen().pocket(10000).samples());
  assert.equal(r.n("open"), 0);
  assert.equal(r.m.phase(), "idle");
});
test("pocket sample is strong: its heel strikes do reach the peak level (the rhythm guard is what stops it)", () => {
  const m = makeMotion({ openPeaks: 2 });
  assert.ok(run(gen().pocket(4000).samples(), m).n("open") >= 1);
});
test("a dropped phone (idle): nothing opens", () => {
  assert.equal(run(gen().rest(500).drop().rest(800).samples()).n("open"), 0);
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
test("knock without a shake: nothing (the glass never opened)", () => {
  const r = run(gen().rest(500).knock().rest(600).samples());
  assert.equal(r.n("knock") + r.n("open"), 0);
});
test("still shaking after READY: no knock", () => {
  assert.equal(run(fillUp(gen()).shake(1500, 30).rest(300).samples()).n("knock"), 0);
});
test("a soft tap (12 m/s²) is not a knock", () => {
  assert.equal(run(fillUp(gen()).knock(12).rest(600).samples()).n("knock"), 0);
});
test("a dropped phone after READY (free fall, then a hit) is not a knock", () => {
  assert.equal(run(fillUp(gen()).rest(500).drop().rest(600).samples()).n("knock"), 0);
});
test("after a miss: rearm → the next knock counts; reset → idle", () => {
  const g = fillUp(gen()).knock().rest(1200);
  const m = makeMotion(); let r = run(g.samples(), m);
  assert.equal(r.n("knock"), 1);
  m.rearm(); assert.equal(m.phase(), "ready");
  const t0 = g.samples().at(-1)[0];
  r = run(gen().knock().rest(600).samples().map(([t, x, y, z]) => [t + t0 + DT, x, y, z]), m);
  assert.equal(r.n("knock"), 1);
  m.reset(); assert.equal(m.phase(), "idle"); assert.equal(m.fill(), 0);
});
test("event.acceleration (no gravity) works the same", () => {
  const r = run(fillUp(gen()).knock().rest(600).samples(), makeMotion(), true);
  assert.equal(r.n("open"), 1);
  assert.equal(r.n("knock"), 1);
});
test("null samples (desktop Chromium) are skipped", () => {
  const m = makeMotion();
  assert.equal(m.feed(0, null, null, null).length, 0);
  assert.equal(m.feed(16, NaN, 1, 1).length, 0);
  assert.equal(m.fill(), 0);
});

/* ---------- tilt to drink ---------- */
// "Up" (the reaction to gravity) in phone axes for a phone turned `pitch` deg (top towards the face) and `roll` deg (sideways).
function upVec(pitch, roll = 0) {
  const p = pitch * D2R, r = roll * D2R;
  return [G * Math.sin(r) * Math.cos(p), G * Math.cos(r) * Math.cos(p), G * Math.sin(p)];
}
function tiltGen() {
  const s = []; let t = 0, cur = [0, 0];
  const push = (pitch, roll, sign) => { const v = upVec(pitch, roll); s.push([t, sign * (v[0] + rnd() * 0.2), sign * (v[1] + rnd() * 0.2), sign * (v[2] + rnd() * 0.2)]); t += DT; };
  const api = {
    sign: 1,
    hold(ms) { for (let e = 0; e < ms; e += DT) push(cur[0], cur[1], api.sign); return api; },
    turn(pitch, roll, ms) { const [p0, r0] = cur; for (let e = 0; e < ms; e += DT) { const f = e / ms; push(p0 + (pitch - p0) * f, r0 + (roll - r0) * f, api.sign); } cur = [pitch, roll]; return api; },
    shake(ms) { for (let e = 0; e < ms; e += DT) { const v = upVec(0, 0); s.push([t, api.sign * (v[0] + 20 * Math.sin(2 * Math.PI * 4 * e / 1000)), api.sign * v[1], api.sign * v[2]]); t += DT; } return api; },
    samples: () => s,
  };
  return api;
}
function drainRun(samples, d = makeDrain()) {
  let empties = 0, last = null, minL = 1, rises = 0, prev = 1;
  for (const [t, x, y, z] of samples) { last = d.feed(t, x, y, z); if (last.empty) empties++; if (last.level > prev + 1e-9) rises++; prev = last.level; minL = Math.min(minL, last.level); }
  return { empties, last, minL, rises };
}
test("drink: upright 3 s = the glass stays full", () => {
  const r = drainRun(tiltGen().hold(3000).samples());
  assert.equal(r.empties, 0); assert.ok(r.last.level > 0.99, "level " + r.last.level);
});
test("drink: 45° (the normal way to look at a phone) = nothing runs out", () => {
  const r = drainRun(tiltGen().hold(300).turn(45, 0, 400).hold(3000).samples());
  assert.equal(r.empties, 0); assert.ok(r.last.level > 0.99, "level " + r.last.level);
});
test("drink: 75° = a little runs out, then it stays (not empty)", () => {
  const r = drainRun(tiltGen().hold(300).turn(75, 0, 400).hold(3000).samples());
  const want = makeDrain().cap(75);
  assert.ok(want > 0.6 && want < 0.9, "cap " + want);
  assert.equal(r.empties, 0);
  assert.ok(Math.abs(r.last.level - want) < 0.04, r.last.level + " vs " + want);
});
test("drink: laid flat on the table (90°) = half stays, no finish", () => {
  const r = drainRun(tiltGen().hold(300).turn(90, 0, 600).hold(5000).samples());
  assert.equal(r.empties, 0);
  assert.ok(r.last.level > 0.4 && r.last.level < 0.6, "level " + r.last.level);
});
test("drink: tipped towards the mouth (130°) = empty once, in about 1–3 s", () => {
  const g = tiltGen().hold(300).turn(130, 0, 1200), n0 = g.samples().length; g.hold(3000);
  const d = makeDrain(); let at = null;
  g.samples().forEach(([t, x, y, z], i) => { if (d.feed(t, x, y, z).empty) at = i; });
  assert.ok(at !== null, "never empty");
  const ms = (at - n0) * DT + 1200;
  assert.ok(ms > 800 && ms < 3500, "took " + ms + " ms");
  assert.equal(drainRun(g.samples()).empties, 1);
});
test("drink: sip, back upright, sip again = the level only goes down, empty at the end", () => {
  const r = drainRun(tiltGen().hold(200).turn(70, 0, 400).hold(800).turn(0, 0, 400).hold(800).turn(125, 0, 800).hold(2500).samples());
  assert.equal(r.rises, 0); assert.equal(r.empties, 1); assert.equal(r.last.level, 0);
});
test("drink: tipped to the side (120° roll) also pours out; the surface roll stays within ±75°", () => {
  const g = tiltGen().hold(200).turn(0, 50, 500), d = makeDrain(); let maxRoll = 0, em = 0;
  g.hold(400); g.turn(0, 120, 600).hold(2500);
  for (const [t, x, y, z] of g.samples()) { const o = d.feed(t, x, y, z); maxRoll = Math.max(maxRoll, Math.abs(o.roll)); if (o.empty) em++; }
  assert.equal(em, 1); assert.ok(maxRoll <= 75, "roll " + maxRoll);
});
test("drink: shaking upright does not drink", () => {
  const r = drainRun(tiltGen().hold(300).shake(3000).samples());
  assert.equal(r.empties, 0); assert.ok(r.minL > 0.9, "level " + r.minL);
});
test("drink: iPhone signs (opposite) work with ios: true, and would look upside down without it", () => {
  const g = tiltGen(); g.sign = -1; g.hold(300).turn(130, 0, 1200).hold(3000);
  assert.equal(drainRun(g.samples(), makeDrain({ ios: true })).empties, 1);
  const up = tiltGen(); up.sign = -1; up.hold(2000);
  assert.equal(drainRun(up.samples(), makeDrain({ ios: true })).last.level > 0.99, true);
  assert.equal(drainRun(up.samples(), makeDrain()).empties, 1);
});
