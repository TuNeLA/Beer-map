// Levande karta (js/alive.js, lane alive): the pure parts. Aggregate only: never a signal under K_MIN people.
import test from "node:test";
import assert from "node:assert/strict";
import { loadScript } from "./load.mjs";

// vm arrays have another realm's prototype: compare plain copies
const eq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const AL = () => loadScript("js/alive.js").ALIVE;
const LUD = { lat: 60.1496, lng: 15.1878 };
const at = (iso) => Date.parse(iso);
const bar = (id, pins, o) => Object.assign({ id, lat: LUD.lat + id.length * 1e-4, lng: LUD.lng, pins, cis: 0, sk: 0 }, o || {});
const mem = (o) => Object.assign({ now: at("2026-11-13T21:00:00Z"), prevSk: {}, rises: {}, events: [], feeds: {} }, o || {});

test("alive: sun is down in Ludvika on a November evening, up at noon", () => {
  const A = AL();
  assert.equal(A._isNight(at("2026-11-13T21:00:00Z"), LUD.lat, LUD.lng), true);     // 22:00 local
  assert.equal(A._isNight(at("2026-11-13T11:00:00Z"), LUD.lat, LUD.lng), false);    // 12:00 local
  assert.equal(A._isNight(at("2026-06-19T21:00:00Z"), LUD.lat, LUD.lng), false);    // midsommarafton 23:00: still light enough
  const noon = A._sunAlt(at("2026-06-21T11:20:00Z"), LUD.lat, LUD.lng);
  assert.ok(noon > 50 && noon < 55, "June noon altitude about 53°: " + noon);
});

test("alive: k rule — under 3 people there is no clink and no sparks, even with many skål taps", () => {
  const A = AL();
  const s = A._signals([bar("a", 2, { sk: 9 }), bar("bb", 1, { cis: 2, sk: 4 })], mem());
  eq(s, []);
});

test("alive: clink at a bar with skål taps and >= 3 people; sparks at >= 5 people without skål", () => {
  const A = AL();
  const s = A._signals([bar("a", 3, { sk: 2 }), bar("bb", 5), bar("ccc", 4)], mem());
  eq(s.map((x) => x.k + ":" + x.id), ["skal:a", "lively:bb"]);
});

test("alive: a NEW skål tap since the last poll clinks for 90 s, then stops", () => {
  const A = AL(), m = mem();
  A._signals([bar("a", 3, { sk: 0 })], m);                                   // first poll: remember 0
  let s = A._signals([bar("a", 3, { sk: 1 })], Object.assign(m, { now: m.now + 20e3 }));
  assert.equal(s[0] && s[0].k, "skal");
  s = A._signals([bar("a", 3, { sk: 1 })], Object.assign(m, { now: m.now + 100e3 }));
  eq(s, []);
});

test("alive: my group's Skåltimmen clinks at MY bar only", () => {
  const A = AL();
  const s = A._signals([], mem({ groupSkal: true, myBar: { id: "x", lat: 60.15, lng: 15.18 } }));
  eq(s.map((x) => [x.k, x.id, !!x.mine]), [["skal", "x", true]]);
  eq(A._signals([], mem({ groupSkal: false, myBar: { id: "x", lat: 60.15, lng: 15.18 } })), []);
});

test("alive: events pulse only when running or starting within 4 h, never pending ones", () => {
  const A = AL(), n = at("2026-11-13T19:00:00Z"), iso = (h) => new Date(n + h * 36e5).toISOString();
  const ev = [{ id: 1, starts_at: iso(1), lat: 60.15, lng: 15.18 }, { id: 2, starts_at: iso(5), lat: 60.15, lng: 15.18 },
    { id: 3, starts_at: iso(-1), ends_at: iso(1), lat: 60.15, lng: 15.18 }, { id: 4, starts_at: iso(-4), lat: 60.15, lng: 15.18 },
    { id: 5, starts_at: iso(0.5), pending: true, lat: 60.15, lng: 15.18 }, { id: 6, starts_at: iso(0.5), lat: null, lng: null }];
  eq(A._signals([], mem({ now: n, events: ev })).map((x) => x.id), ["e1", "e3"]);
});

test("alive: pick = one effect per bar (clink > event > lively), per-kind caps, total cap 12, nearest first", () => {
  const A = AL(), c = A._caps();
  assert.equal(c.cap, 12); assert.equal(c.kMin, 3);
  const many = (k, n) => Array.from({ length: n }, (_, i) => ({ k, id: k + i, lat: LUD.lat + i * 1e-3, lng: LUD.lng }));
  const out = A._pick([].concat(many("skal", 10), many("event", 10), many("lively", 10)), LUD, null, c.caps, c.cap);
  assert.equal(out.length, 12);
  eq(["skal", "event", "lively"].map((k) => out.filter((x) => x.k === k).length), [3, 5, 4]);
  eq(out.filter((x) => x.k === "skal").map((x) => x.id), ["skal0", "skal1", "skal2"]);
  const same = A._pick([{ k: "lively", id: "b", lat: 1, lng: 1 }, { k: "event", id: "b", lat: 1, lng: 1 }, { k: "skal", id: "b", lat: 1, lng: 1 }], LUD, null, c.caps, c.cap);
  eq(same.map((x) => x.k), ["skal"]);
});

test("alive: glow weight — closed by OSM hours = 0, unknown hours glow only in the evening", () => {
  const A = AL();
  assert.equal(A._glowW({}, at("2026-11-13T21:00:00Z")), 0.6);     // Fri 22:00
  assert.equal(A._glowW({}, at("2026-11-14T00:30:00Z")), 0.6);     // Sat 01:30 (Friday night): until 02
  assert.equal(A._glowW({}, at("2026-11-13T00:30:00Z")), 0);       // Fri 01:30 (Thursday night): until 01
  assert.equal(A._glowW({}, at("2026-11-11T02:30:00Z")), 0);       // Wed 03:30
  assert.equal(A._glowW({}, at("2026-11-13T09:00:00Z")), 0);       // Fri 10:00
});
