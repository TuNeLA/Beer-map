// maplight-pw.js — lane maplight (owner 15 Nov 2026, I-115): the map shows where the life is.
//  A  street light: warm light on the street pieces near a busy bar (reach 60 / 95 / 140 m by crowd step, brightest at the door)
//  B  lantern pin: the bar disc by crowd step (3-7 / 8-14 / 15+ people); C halo under the pin; E one ring on a check-in
//  Under 3 people: NO light, no halo, no lantern, no ring for a stranger. A poll with the same data sends nothing.
//  Town view: bars with people that would sit on each other = ONE lantern with the summed count.
//  My marker: always the top layer, never on a bar icon (it stands beside it). Friends = faces in the row under the disc.
//  Foam: gone (one rule for every state and size). Heat: one amber hue, gone from GL zoom 14.6.
//  Kill switch ?barlight=0 (PN.CFG.barlight): everything of the light is off, the old heat is back.
// Paths: gl = Mapbox GL (MAPBOX_TEST_TOKEN, else a STUB Mapbox like mapfix-pw.js; roads from the __PN_ROADS hook), fb = raster.
// usage: node maplight-pw.js <port> [sections regex: light|poll|ring|still|me|foam|heat|town|kill|perf|raster]
// MAPLIGHT_OLD=<dir with the old glmap.js mapart.js app-pins.js avpins.js index.html>: run on the old code (checks must FAIL).
const { H, TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const PORT = process.argv[2], ONLY = new RegExp(process.argv[3] || "."), OLD = process.env.MAPLIGHT_OLD || "";
const BASE = "http://127.0.0.1:" + PORT + "/";
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 700))); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const LUD = [60.1505, 15.1872], PIT = "n3472634175", LOBBY = "x-lobbybaren-ludvika", PARMA = "x-la-parma-ludvika", GREK = "x-grekiska-grill-bar-ludvika";
const BAR = { parma: [60.15124, 15.18797], pitch: [60.14997, 15.18679], lobby: [60.15098, 15.18663], grek: [60.15205, 15.18059] };
const AWAY = [60.1452, 15.1745];   // the lake shore park: no bar / food icon there
const OLDRE = /\/(js\/(glmap|mapart|app-pins|avpins|barlight)\.js|index\.html|barlight\.css)$/;
const oldBody = (p) => { if (!OLD || !OLDRE.test(p)) return null; const f = path.join(OLD, path.basename(p)); return fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from(""); };
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let nid = 7000;
const P = (ll, o = {}) => ({ id: nid++, lat: ll[0], lng: ll[1], beer_count: 1, precise: true, created_at: iso(30), is_mine: !!o.mine, friend_name: o.f || null, skal_count: 0, i_skaled: false, shot_count: 0 });
// the crowd: 16 at La Parma (2 friends), 9 at Pitchers (1 friend), 4 at Lobbybaren, 2 at Grekiska
function crowd(o = {}) {
  const b = [], n = Object.assign({ parma: 16, pitch: 9, lobby: 4, grek: 2 }, o);
  for (let i = 0; i < n.parma; i++) b.push(P(BAR.parma, i === 0 ? { f: "Oskar" } : i === 1 ? { f: "Lisa" } : {}));
  for (let i = 0; i < n.pitch; i++) b.push(P(BAR.pitch, i === 1 ? { f: "Ida" } : {}));
  for (let i = 0; i < n.lobby; i++) b.push(P(BAR.lobby));
  for (let i = 0; i < n.grek; i++) b.push(P(BAR.grek));
  return b;
}
const CI = (bar, id, name, o = {}) => ({ bar_id: id, bar_name: name, lat: bar[0], lng: bar[1], name: o.who || "Kalle K", is_mine: !!o.mine, is_friend: !!o.friend, created_at: o.at || new Date().toISOString() });
// roads for the stub style: two streets crossing at every bar (lines 400 m long, a little off the bar point)
const ROADS = () => { const out = [], m = (lat) => [1 / (111320 * Math.cos(lat * Math.PI / 180)), 1 / 110540];
  [[60.15124, 15.18797], [60.14997, 15.18679], [60.15098, 15.18663], [60.15205, 15.18059]].forEach(([la, ln]) => { const [kx, ky] = m(la), y = la + 12 * ky, x = ln + 10 * kx;
    out.push([[ln - 200 * kx, y], [ln, y], [ln + 200 * kx, y]], [[x, la - 200 * ky], [x, la], [x, la + 200 * ky]]); });
  return out; };

async function open(b, mode, o = {}) {
  const { ctx, page } = await H.ctxFor(b, { width: 390, height: 844 }, { reduced: !!o.reduced, checkin: false });
  const S = { beers: crowd(o.crowd), checkins: o.checkins || [] };
  await page.route(/rest\/v1\/rpc\/live_beers/, (r) => J(r, S.beers));
  await page.route(/rest\/v1\/rpc\/live_others/, (r) => J(r, []));
  await page.route(/rest\/v1\/rpc\/live_checkins/, (r) => J(r, S.checkins));
  await page.route(/rest\/v1\/rpc\/heat_points/, (r) => J(r, S.beers.map((x) => ({ lat: x.lat, lng: x.lng, w: 1 }))));
  if (mode === "gl" && !TOKEN) await ctx.addInitScript(`window.__PN_ROADS = ${ROADS.toString()};`);
  let url = BASE + (o.query || "");
  if (mode === "gl") {
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN || STUB_TOKEN }));
    if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
    await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
      const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
      const ob = oldBody(p); if (ob) return r.fulfill({ status: 200, contentType: /\.css$/.test(p) ? "text/css" : /\.html$/.test(p) ? "text/html" : "text/javascript", body: ob });
      try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
        await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
      } catch (e) { r.abort().catch(() => {}); }
    });
    url = "https://tunela.github.io/Beer-map/" + (o.query || "");
  } else {
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: "" }));
    if (OLD) await page.route((u) => u.href.startsWith(BASE) && OLDRE.test(u.pathname), (r) => { const ob = oldBody(new URL(r.request().url()).pathname); return ob ? r.fulfill({ status: 200, body: ob }) : r.fallback(); });
  }
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message.slice(0, 200)); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (mode === "gl") await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  else await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill, .cm").length > 2, null, { timeout: 30000 }).catch(() => console.log("no pins"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => { window.__gm = () => BASEMAP.mapbox().getMapboxMap(); }).catch(() => {});
  await wait(page, 2500);
  return { ctx, page, errs, S };
}
const view = async (page, ll, z, ms) => { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await wait(page, ms || 1500); };
const poll = async (page, ms) => { await page.evaluate(() => { try { PN.refresh(); } catch (e) {} }); await wait(page, ms || 1500); };
// the light is built (roads read, pieces sent) for the lit bars
const built = (page) => page.waitForFunction(() => window.BARLIGHT && BARLIGHT._state().lit.length >= 3 && BARLIGHT._state().lit.every((b) => BARLIGHT._state().cache[b.id]), null, { timeout: 15000 }).catch(() => {});


(async () => {
  const b = await chromium.launch(launchOpts(["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]));
  const { ctx, page, errs } = await open(b, "gl");
  for (const z of [16, 13]) {
    await view(page, LUD, z, 2500);
    console.log("z" + z, JSON.stringify(await page.evaluate(() => (GLBARS._view() || []).filter((x) => x.n > 0 || /blackstone|parma|lobby|n3472/.test(x.id)).map((x) => [x.id.slice(0, 14), x.full ? "F" : "d", x.lbl ? "L" : "-", x.dem ? "DEM" : "", x.n, x.lv]))));
    console.log("stats", JSON.stringify(await page.evaluate(() => ({ dem: GLBARS.stats.demoted, cr: GLBARS.stats.crowds }))));
  }
  console.log("errs", errs);
  await b.close();
})();
