// lane srvsync (PLAN A7 / A8): the phone side of pn_sync (docs/js/app-net.js syncHave / syncTake / syncKeep) and the
// adaptive poll gap + draw key (docs/js/app-poll.js pollGap / drawKey). The server side has its own SQL test
// (supabase/tests/pnsync-0525.test.sql); serverEntry() below is the same rule in JS, so the two halves are tested together.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadFunctions } from "./load.mjs";

// JS copy of public.olnu_sync_entry (0525). Key order: jsonb sorts keys (shorter first, then bytes); hashes only need to
// be stable here, so sorted JSON is enough for this test.
const sortJ = (v) => Array.isArray(v) ? v.map(sortJ) : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = sortJ(v[k]); return o; }, {}) : v;
const md5 = (v) => crypto.createHash("md5").update(JSON.stringify(sortJ(v))).digest("hex");
function serverEntry(v, have) {
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length <= 40) {
    const hs = {}; Object.keys(v).forEach((k) => { hs[k] = md5(v[k]).slice(0, 12); });
    if (have && typeof have === "object" && !Array.isArray(have)) {
      if (JSON.stringify(sortJ(have)) === JSON.stringify(sortJ(hs))) return { s: 1 };
      const d = {}; Object.keys(v).forEach((k) => { if (have[k] !== hs[k]) d[k] = v[k]; });
      return { d, h: hs, p: 1 };
    }
    return { d: v, h: hs };
  }
  const h = md5(v === undefined ? null : v).slice(0, 16);
  if (typeof have === "string" && have === h) return { s: 1 };
  return { d: v, h };
}

function net() {
  const scope = { sCache: {}, sKeys: [], sByName: {}, SYNC_MAX: 3 };
  const f = loadFunctions(["syncBase", "syncHave", "syncTake", "syncKeep"], scope);
  return Object.assign(f, { scope });
}
// one round: the phone asks with what it has, the server answers, the phone keeps the result
function round(f, k, value, n) {
  const c = { k, n: n || k.split("|")[0] }, base = {}; base[k] = f.syncBase(c, f.scope.sCache, f.scope.sByName);
  const have = f.syncHave([c], base)[k];
  const it = serverEntry(value, have);
  const t = f.syncTake(it, base[k]);
  if (t.ok) f.syncKeep(k, t.v, t.h, c.n);
  return { it, t, bytes: JSON.stringify(it).length };
}

const poll = (pins, me) => ({ v: 1, server_time: "2026-11-19T22:00:00Z", bbox: [60.1, 15.1, 60.2, 15.3], pins, me, live_total: pins.length, checkins: [], rallies: [] });
const plain = (x) => JSON.parse(JSON.stringify(x));
const pins = (n) => Array.from({ length: n }, (_, i) => ({ id: 500 + i, lat: 60.15 + i / 1000, lng: 15.18, beer_count: 1 + (i % 5), precise: true }));

test("pn_sync: first answer in full, the phone keeps value + field hashes", () => {
  const f = net(), v = poll(pins(20), { beer_count: 2 });
  const r = round(f, "poll_v2|a", v);
  assert.equal(r.t.ok, true); assert.equal(r.t.how, "full");
  assert.deepEqual(r.t.v, v);
  assert.equal(typeof f.scope.sCache["poll_v2|a"].h.pins, "string");
});
test("pn_sync: nothing changed -> {s: 1}, the phone gives back its copy (and it is tiny on the wire)", () => {
  const f = net(), v = poll(pins(20), { beer_count: 2 });
  const a = round(f, "poll_v2|a", v), b = round(f, "poll_v2|a", JSON.parse(JSON.stringify(v)));
  assert.deepEqual(b.it, { s: 1 }); assert.equal(b.t.how, "same");
  assert.deepEqual(b.t.v, v);
  assert.ok(b.bytes * 50 < a.bytes, b.bytes + " vs " + a.bytes);
});
test("pn_sync: one field changed -> only that field on the wire, the phone builds the full new value", () => {
  const f = net(), v = poll(pins(20), { beer_count: 2 });
  round(f, "poll_v2|a", v);
  const v2 = Object.assign({}, v, { me: { beer_count: 3 }, server_time: "2026-11-19T22:00:30Z" });
  const r = round(f, "poll_v2|a", v2);
  assert.equal(r.t.how, "part");
  assert.deepEqual(Object.keys(r.it.d).sort(), ["me", "server_time"]);
  assert.deepEqual(plain(r.t.v), v2);   // vm objects: compare as plain JSON
});
test("pn_sync: a field that is gone on the server is gone on the phone", () => {
  const f = net(), v = poll(pins(3), { beer_count: 2 });
  round(f, "poll_v2|a", Object.assign({ heat: [[1, 2, 3]] }, v));
  const r = round(f, "poll_v2|a", v);
  assert.equal(r.t.how, "part");
  assert.equal("heat" in r.t.v, false);
  assert.deepEqual(plain(r.t.v), v);
});
test("pn_sync: arrays and scalars use one hash (same = {s: 1}, changed = full)", () => {
  const f = net();
  round(f, "my_groups|{}", [{ id: 1 }]);
  assert.deepEqual(round(f, "my_groups|{}", [{ id: 1 }]).it, { s: 1 });
  const r = round(f, "my_groups|{}", [{ id: 1 }, { id: 2 }]);
  assert.equal(r.t.how, "full"); assert.deepEqual(r.t.v, [{ id: 1 }, { id: 2 }]);
  round(f, "n|{}", null);
  assert.deepEqual(round(f, "n|{}", null).it, { s: 1 });
});
test("pn_sync: the phone lost its copy -> syncTake says not ok (the caller asks again in full)", () => {
  const f = net();
  assert.equal(f.syncTake({ s: 1 }, undefined).ok, false);
  assert.equal(f.syncTake({ d: { a: 1 }, h: { a: "x" }, p: 1 }, undefined).ok, false);
  assert.equal(f.syncTake({ d: { a: 1 }, h: { a: "x" }, p: 1 }, { h: "y", d: [1] }).ok, false);   // had an array, not an object
  assert.equal(f.syncTake(null, undefined).ok, false);
  assert.equal(f.syncTake({}, undefined).ok, false);
});
test("pn_sync: the cache keeps at most SYNC_MAX keys (oldest out) and sends only the hashes of keys asked now", () => {
  const f = net();
  ["a", "b", "c", "d"].forEach((k) => round(f, k, [k]));
  assert.deepEqual(Object.keys(f.scope.sCache).sort(), ["b", "c", "d"]);
  const cs = [{ k: "c", n: "c" }, { k: "zz", n: "zz" }], base = {};
  cs.forEach((c) => { base[c.k] = f.syncBase(c, f.scope.sCache, f.scope.sByName); });
  assert.deepEqual(Object.keys(f.syncHave(cs, base)), ["c"]);
});

test("pn_sync: a new key of the same function (poll_v2 with a new box / p_heat) builds on the last answer of that function", () => {
  const f = net(), v = poll(pins(20), { beer_count: 2 });
  round(f, "poll_v2|box1", v, "poll_v2");
  const r = round(f, "poll_v2|box2", Object.assign({}, v, { server_time: "x" }), "poll_v2");
  assert.equal(r.t.how, "part");
  assert.deepEqual(Object.keys(r.it.d), ["server_time"]);
  assert.deepEqual(plain(r.t.v), Object.assign({}, v, { server_time: "x" }));
});

function gap(o) {
  const scope = Object.assign({ POLL_MS: 30000, POLL_SLOW_MS: 60000, POLL_QUIET_MS: 90000, POLL_DEEP_MS: 120000, DEEP_IDLE_MS: 15 * 60e3,
    quietPolls: 0, lastTouch: Date.now(), isIdle: false }, o);
  scope.idle = () => scope.isIdle;
  return loadFunctions(["pollGap"], scope).pollGap();
}
test("A7 adaptive poll: 30 s while used, 60 s idle, 90 s idle + 3 quiet polls, 120 s after 15 min idle + 5 quiet", () => {
  assert.equal(gap({ isIdle: false, quietPolls: 9 }), 30000);
  assert.equal(gap({ isIdle: true, quietPolls: 2 }), 60000);
  assert.equal(gap({ isIdle: true, quietPolls: 3 }), 90000);
  assert.equal(gap({ isIdle: true, quietPolls: 5, lastTouch: Date.now() - 16 * 60e3 }), 120000);
  assert.equal(gap({ isIdle: true, quietPolls: 4, lastTouch: Date.now() - 16 * 60e3 }), 90000);
});

function key(state) {
  const s = Object.assign({ beers: [], checkins: [], liveTotal: 0, meState: null, heatOn: false, heatAskAt: 0 }, state);
  const scope = Object.assign({ map: { getZoom: () => s.zoom || 14 }, document: { documentElement: { lang: "sv" } } }, s);
  return loadFunctions(["drawKey"], scope).drawKey();
}
test("A8 draw key: same data = same key; a pin count, a check-in, the zoom step or my count change it", () => {
  const b = pins(5), base = key({ beers: b });
  assert.ok(base.length > 10);
  assert.equal(key({ beers: JSON.parse(JSON.stringify(b)) }), base);
  const b2 = JSON.parse(JSON.stringify(b)); b2[0].beer_count++;
  assert.notEqual(key({ beers: b2 }), base);
  assert.notEqual(key({ beers: b, checkins: [{ bar_id: "x" }] }), base);
  assert.notEqual(key({ beers: b, zoom: 16 }), base);
  assert.notEqual(key({ beers: b, meState: { beer_count: 4 } }), base);
});
test("A8 draw key: data that cannot be written as JSON = '' (always draw)", () => {
  const b = pins(1); b[0].self = b[0];
  assert.equal(key({ beers: b }), "");
});
