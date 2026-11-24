// lane walktime (PLAN E6, 24 Nov 2026): docs/js/walktime.js. Walking time on the bar card + Sök › Krogar.
// Old code: walktime.js does not exist -> every test here fails on the old code.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../../docs/js/walktime.js", import.meta.url), "utf8");
const TOKEN = "pk.TESTTOKEN123";
// a fake page: FASTPOS with one fix, a fetch spy, document.hidden, home zone
function load(o = {}) {
  const calls = [], logs = [], vis = [];
  const fix = o.fix === null ? null : Object.assign({ latitude: 60.1545, longitude: 15.1960, accuracy: 20 }, o.fix || {});
  const win = {
    I18N: { lang: o.lang || "sv" },
    FASTPOS: { fresh: () => (fix && fix.accuracy <= 100 ? { coords: fix } : null) },
    OLNU_CONFIG: Object.assign({ MAPBOX_TOKEN: TOKEN }, o.cfg || {}),
    HOMEZONE: { home: () => o.home || null },
    navigator: { onLine: true },
    AbortController,
    BARS: o.bars ? { around: (lat, lng, m) => ({ bars: o.bars.map((b) => ({ bar: b, d: 0 })).filter(() => m > 0), places: [] }) } : null,
    fetch: (url, opt) => { calls.push(url); return o.reply ? o.reply(url, opt) : new Promise(() => {}); },
  };
  const doc = { hidden: !!o.hidden, addEventListener: (t, f) => vis.push(f), querySelectorAll: () => [] };
  const con = { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) };
  vm.runInNewContext(SRC, { window: win, document: doc, console: con, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, String, isFinite, encodeURIComponent });
  return { W: win.WALKTIME, calls, logs, doc, vis, win };
}
const PARMA = { id: "x-la-parma-ludvika", name: "La Parma", lat: 60.15124, lng: 15.18797 };
const ME = { lat: 60.1545, lng: 15.1960 };
const flush = () => new Promise((r) => setTimeout(r, 20));

test("estimate = straight line x 1.3 at 80 m/min, rounded; steps of 5 from 16 min", () => {
  const { W } = load();
  const m = W.estimate(ME, PARMA);             // about 574 m straight -> 746 m on foot -> 9.3 min
  assert.ok(m > 9 && m < 9.7, String(m));
  assert.equal(W.round(m), 9);
  assert.equal(W.round(0.3), 1);
  assert.equal(W.round(15.4), 15);
  assert.equal(W.round(17.6), 20);
  assert.equal(W.round(42), 40);
});

test("no walking time when too near (< 80 m: you are there) or too far (> 45 min)", () => {
  const { W } = load();
  assert.equal(W.estimate({ lat: 60.1511, lng: 15.1876 }, PARMA), null);   // 26 m
  assert.equal(W.estimate({ lat: 60.18, lng: 15.25 }, PARMA), null);       // about 4.6 km straight -> > 45 min
  assert.equal(W.estimate(ME, { id: 1, lat: null, lng: 15 }), null);
});

test("fastpos rule: a rough fix (> 100 m) or no fresh fix gives NO time at all", () => {
  assert.equal(load({ fix: { accuracy: 150 } }).W.short(PARMA), "");
  assert.equal(load({ fix: null }).W.short(PARMA), "");
  assert.equal(load({ fix: { accuracy: 150 } }).W.info(PARMA), null);
  assert.equal(load().W.short(PARMA), "ca 9 min");
});

test("honest words in sv and en", () => {
  assert.equal(load().W.text(8), "ca 8 min promenad");
  assert.equal(load({ lang: "en" }).W.text(8), "about 8 min walk");
  assert.equal(load({ lang: "en" }).W.short(PARMA), "about 9 min");
});

test("near(): bars within 10 min, nearest first, at most 5, the bar you stand in is left out", () => {
  const bars = [PARMA, { id: "a", name: "A", lat: 60.1560, lng: 15.1960 }, { id: "here", name: "Here", lat: 60.15451, lng: 15.19601 },
    { id: "far", name: "Far", lat: 60.1620, lng: 15.1960 }, { id: "b", name: "B", lat: 60.1535, lng: 15.1960 }];
  const r = load({ bars }).W.near();
  assert.deepEqual([...r.map((x) => x.bar.id)], ["b", "a", "x-la-parma-ludvika"]);
  assert.equal(r[0].label, "ca 2 min");   // 111 m -> 1.8 min
  assert.equal(load({ bars, fix: { accuracy: 300 } }).W.near().length, 0);
});

test("route option is OFF by default: no network call at all", async () => {
  const t = load();
  assert.equal(t.W._want(PARMA, ME), false);
  t.W.info(PARMA); t.W.short(PARMA); t.W.near();
  await flush();
  assert.equal(t.calls.length, 0);
});

test("route ON: sends the 150 m cell centre (never the GPS point), once per bar per cell per session", async () => {
  const t = load({ cfg: { walkRoute: "mapbox" }, reply: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ routes: [{ duration: 660 }] }) }) });
  assert.equal(t.W._want(PARMA, ME), true);
  await flush();
  assert.equal(t.calls.length, 1);
  const u = t.calls[0], c = t.W.cell(ME);
  assert.match(u, /^https:\/\/api\.mapbox\.com\/directions\/v5\/mapbox\/walking\//);
  assert.ok(u.includes(c.lng.toFixed(5) + "," + c.lat.toFixed(5) + ";"), "cell centre is the origin");
  assert.ok(!u.includes("15.19600,60.15450") && !u.includes("15.196,60.1545"), "the GPS point is not sent");
  assert.ok(Math.abs(c.lat - ME.lat) < 0.0015 && Math.abs(c.lng - ME.lng) < 0.003);
  assert.deepEqual(JSON.parse(JSON.stringify(t.W.info(PARMA))), { n: 11, src: "route" });
  assert.equal(t.W._want(PARMA, ME), false);                                    // cached
  assert.equal(t.W._want(PARMA, { lat: ME.lat + 0.00003, lng: ME.lng }), false); // same cell
  await flush();
  assert.equal(t.calls.length, 1);
});

test("route ON: no call while the page is hidden, offline, at home, or without a pk token", async () => {
  assert.equal(load({ cfg: { walkRoute: "mapbox" }, hidden: true }).W._want(PARMA, ME), false);
  const off = load({ cfg: { walkRoute: "mapbox" } }); off.win.navigator.onLine = false;
  assert.equal(off.W._want(PARMA, ME), false);
  assert.equal(load({ cfg: { walkRoute: "mapbox" }, home: { lat: 60.1560, lng: 15.1970, r: 100 } }).W._want(PARMA, ME), false);
  assert.equal(load({ cfg: { walkRoute: "mapbox", MAPBOX_TOKEN: "sk.secret" } }).W._want(PARMA, ME), false);
  assert.equal(load({ cfg: { walkRoute: "mapbox" }, home: { lat: 60.17, lng: 15.25, r: 100 } }).W._want(PARMA, ME), true);
});

test("route ON: hiding the page aborts the call (no pause); an API error = estimate stays + 5 min pause; token never logged", async () => {
  let sig = null;
  const h = load({ cfg: { walkRoute: "mapbox" }, reply: (u, o) => new Promise((res, rej) => { sig = o.signal; o.signal.addEventListener("abort", () => rej(new Error("abort"))); }) });
  h.W._want(PARMA, ME); h.doc.hidden = true; h.vis.forEach((f) => f());
  await flush();
  assert.equal(sig.aborted, true);
  h.doc.hidden = false;
  assert.equal(h.W._want({ id: "other", lat: 60.15, lng: 15.18 }, ME), true, "no pause after a hide-abort");

  const e = load({ cfg: { walkRoute: "mapbox" }, reply: () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }) });
  e.W._want(PARMA, ME); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(e.W.info(PARMA))), { n: 9, src: "est" });
  assert.equal(e.W._want({ id: "other", lat: 60.15, lng: 15.18 }, ME), false, "paused after an error");
  assert.equal(e.calls.length, 1);
  assert.ok(!e.logs.concat(h.logs).some((l) => l.includes(TOKEN) || l.includes("api.mapbox.com")));
});

test("the token is not stored in the file and the CSS uses tokens only", () => {
  assert.ok(!/pk\.[A-Za-z0-9]{20,}/.test(SRC));
  const css = fs.readFileSync(new URL("../../docs/walktime.css", import.meta.url), "utf8");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css));
  assert.match(css, /\.pn-wt\[hidden\]\{display:none/);
});
