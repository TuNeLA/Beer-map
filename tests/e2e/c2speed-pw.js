// c2speed-pw.js — lane c2speed (13 Nov 2026): I-45 locate-me moves at once from the last known position, I-56 "Öppet nu" food list shows
// rows / a skeleton at once, I-50 food icons from Leaflet 14 (small, zoom ramp), I-51 more bars at city zoom (cluster radius).
// Real Mapbox when MAPBOX_TEST_TOKEN is set (CI). Without it: a STUB Mapbox (blank style), the SAME GL layers run.
// node c2speed-pw.js <port> [tag] [only: regex loc|food|icons|clus]
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t", ONLY = new RegExp(process.argv[4] || ".");
const MODE = TOKEN ? "real" : "stub";
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x && !c ? " " + JSON.stringify(x) : "")); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const ZC = { v: 1, at: new Date().toISOString(), k: 3, total: 23, some: true,
  kommun: [{ c: "0180", n: 15 }, { c: "2061" }, { c: "2080" }, { c: "2085", n: 5, bar: "n3472634175" }, { c: "1480", n: 3 }],
  lan: [{ c: "01", n: 15, top: "0180" }, { c: "14", n: 3, top: "1480" }, { c: "20", n: 8, top: "2085" }] };
const PIT = "n3472634175", PARMA = "x-la-parma-ludvika", LUD = [60.1505, 15.1872];

const BAR_L = /olnu-bar-(full|dot|dote|cdot|cdote|cdotf)$/;   // the drawn bar icons (not the invisible blocker)

async function open(b, vp, o = {}) {
  const desk = vp.width > 600;
  const proxy = { newContext: (opt) => b.newContext(Object.assign({}, opt, desk ? { isMobile: false, hasTouch: false, deviceScaleFactor: 1 } : {})) };
  const { ctx, page } = await H.ctxFor(proxy, vp, o.h || {});
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN || STUB_TOKEN }));
  await page.route(/rest\/v1\/rpc\/zone_counts/, (r) => J(r, ZC));
  if (o.quiet) {   // the owner's I-08 case: nobody out, no crown, no event (every bar is a quiet dot)
    await page.route(/rest\/v1\/rpc\/bar_kings/, (r) => J(r, []));
    await page.route(/rest\/v1\/rpc\/events_near\b/, (r) => J(r, []));
    await page.route(/rest\/v1\/rpc\/(events_near2|events_near3)\b/, (r) => J(r, { v: 1, server_time: new Date().toISOString(), events: [] }));
  }
  if (o.noMine) await page.route(/rest\/v1\/rpc\/live_checkins/, (r) => J(r, []));   // not checked in anywhere
  if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
      await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
    } catch (e) { r.abort().catch(() => {}); }   // a closed page / a reset local socket: never crash the run
  });
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message); });
  const url = "https://tunela.github.io/Beer-map/" + (o.q || "");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(async (e) => { console.log("goto retry: " + e.message.split("\n")[0]); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); });
  await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate((src) => { window.__mz = { gm: () => BASEMAP.mapbox().getMapboxMap() }; window.__mz.BAR_L = new RegExp(src); }, BAR_L.source);
  return { ctx, page, errs };
}
async function idle(page, ms) {
  await page.waitForFunction(() => { const g = __mz.gm(); return g.loaded() && !g.isMoving(); }, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  if (ms) await wait(page, ms);
}
async function view(page, ll, z, ms) { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await idle(page, ms == null ? 1200 : ms); }
// every bar in view: id, x, y, icon diameter, type rank, drawn (an icon feature of its own at its point) and how
function bars(page) {
  return page.evaluate(() => {
    const g = __mz.gm(), lays = GLBARS._layers().filter((l) => __mz.BAR_L.test(l) && g.getLayer(l)), by = {};
    g.queryRenderedFeatures({ layers: lays }).forEach((f) => { const id = String(f.properties.id); (by[id] = by[id] || []).push(f.layer.id.replace("olnu-bar-", "")); });
    const cls = g.getLayer("olnu-bar-cl") ? g.queryRenderedFeatures({ layers: ["olnu-bar-cl"] }).map((f) => g.project(f.geometry.coordinates)) : [];
    const RK = { bar: 6, pub: 5, nightclub: 4, restaurant: 3, cafe: 2 };
    return (GLBARS._view() || []).map((v) => { const b = BARS.byId(v.id) || {}, c = PNPINS.cat((GLBARS._vt(v.id) || {}).k || b.type);
      return { id: v.id, name: (b.name || v.id).slice(0, 18), x: v.x, y: v.y, d: v.icoW, cat: c, rk: RK[c] != null ? RK[c] : /bar|olbar|cocktail|vinbar|sportsbar|hotellbar|spelbar|nation|karaoke|livescen/.test(c) ? 6 : 0,
        full: v.full, lays: by[v.id] || [], drawn: !!by[v.id], incl: cls.some((q) => Math.hypot(q.x - v.x, q.y - v.y) < 44) }; });
  });
}

const VAS = [59.6099, 16.5448];
// bars in view: singles drawn as icons + cluster badges (count + sum of their bars)
function counts(page) {
  return page.evaluate(() => {
    const g = __mz.gm(), lays = GLBARS._layers().filter((l) => __mz.BAR_L.test(l) && g.getLayer(l)), ids = new Set();
    g.queryRenderedFeatures({ layers: lays }).forEach((f) => ids.add(String(f.properties.id)));
    const cl = g.getLayer("olnu-bar-cl") ? g.queryRenderedFeatures({ layers: ["olnu-bar-cl"] }) : [];
    const sz = (g.getLayer("olnu-place") ? g.queryRenderedFeatures({ layers: ["olnu-place"] }).length : 0);
    return { singles: ids.size, clusters: new Set(cl.map((f) => f.properties.cluster_id)).size, inView: (GLBARS._view() || []).length, places: sz, placeStat: GLBARS.stats.places | 0 };
  });
}

(async () => {
  console.log("MODE " + MODE);
  const b = await chromium.launch(launchOpts([]));
  try {
    /* ---------- I-45: locate-me with a cached position moves < 1 s even when the browser never answers ---------- */
    if (ONLY.test("loc")) {
      const { ctx, page } = await open(b, { width: 390, height: 780 });
      await page.evaluate(() => { Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition() {}, watchPosition() { return 1; }, clearWatch() {} } }); });
      await view(page, LUD, 12, 300);
      await page.evaluate((ll) => { PN.s.lastLoc = { lat: ll[0], lng: ll[1] }; }, VAS);
      const dt = await page.evaluate((ll) => new Promise((res) => { const t0 = performance.now(); document.getElementById("btn-locate").click();
        const tick = () => { const c = __map.getCenter(); if (Math.abs(c.lat - ll[0]) < 0.02 && Math.abs(c.lng - ll[1]) < 0.02) res(Math.round(performance.now() - t0)); else if (performance.now() - t0 > 15000) res(99999); else requestAnimationFrame(tick); }; tick(); }), VAS);
      const c = await page.evaluate(() => __map.getCenter());
      ok(Math.abs(c.lat - VAS[0]) < 0.02 && dt < 1000, "I-45 locate-me flies to the last known position < 1 s while the GPS never answers (" + dt + " ms)");
      await wait(page, 5000);
      ok(!(await page.evaluate(() => /för lång tid/.test(document.body.innerText))), "I-45 no timeout error when a position is known");
      // no position at all: the error shows
      await page.evaluate(() => { PN.s.lastLoc = null; try { localStorage.removeItem("olnu.lastFix"); } catch (e) {}
        Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition(a, e) { setTimeout(() => e({ code: 3 }), 200); }, watchPosition() { return 1; }, clearWatch() {} } }); });
      await page.click("#btn-locate"); await wait(page, 1200);
      ok(await page.evaluate(() => /för lång tid/.test(document.body.innerText)), "I-45 the timeout error shows when there is NO position at all");
      await ctx.close().catch(() => {});
    }
    /* ---------- I-56: "Öppet nu: mat nära dig" shows rows (or a skeleton) at once, before the network answers ---------- */
    if (ONLY.test("food")) {
      const { ctx, page } = await open(b, { width: 390, height: 780 });
      await page.route(/overpass/, (r) => setTimeout(() => r.abort().catch(() => {}), 15000));
      await wait(page, 1500);
      await page.evaluate((ll) => { PN.s.lastLoc = { lat: ll[0], lng: ll[1] }; window.__t0 = performance.now(); AFTER.showKebab(); }, LUD);
      const q = await page.evaluate(() => new Promise((res) => { const t0 = performance.now(), tick = () => { const rows = document.querySelectorAll(".af-krow").length, skel = document.querySelectorAll(".af-skel").length;
        if (rows + skel > 0) res({ rows, skel, ms: Math.round(performance.now() - t0) }); else if (performance.now() - t0 > 5000) res({ rows: 0, skel: 0, ms: 5000 }); else requestAnimationFrame(tick); }; tick(); }));
      ok(q.rows + q.skel > 0 && q.ms < 1000, "I-56 food list shows a skeleton or rows < 1 s with the network still pending", q);
      ok(q.rows > 0, "I-56 nearest food rows come from local data at once (Ludvika)", q);
      await ctx.close().catch(() => {});
    }
    /* ---------- I-50 / I-51: icon + cluster counts ---------- */
    if (ONLY.test("icons|clus")) {
      const { ctx, page } = await open(b, { width: 390, height: 780 });
      await page.evaluate(() => { window.__noCaps = 1; });
      const out = {};
      for (const [nm, ll, zs] of [["Ludvika", LUD, [14, 15, 16]], ["Vasteras", VAS, [13, 14, 15]]]) for (const z of zs) {
        await view(page, ll, z, 2200); out[nm + " z" + z] = await counts(page);
      }
      console.log("COUNTS " + JSON.stringify(out));
      const ly = await page.evaluate(() => { const g = __mz.gm(); return JSON.stringify(g.getLayoutProperty("olnu-place", "icon-size") || null); });
      if (ONLY.test("icons")) {
        ok(out["Ludvika z14"].placeStat > 0 && out["Ludvika z15"].placeStat > 0, "I-50 food icons are set from Leaflet 14 (Ludvika z14 " + out["Ludvika z14"].placeStat + ", z15 " + out["Ludvika z15"].placeStat + ")");
        ok(/interpolate/.test(ly || ""), "I-50 food icon-size is zoom-interpolated: " + ly);
      }
      if (ONLY.test("clus")) {
        const v = out["Vasteras z14"], v13 = out["Vasteras z13"];
        ok(v.singles >= 6, "I-51 Västerås z14 shows >= 6 single bars (was 2): " + v.singles + " singles, " + v.clusters + " clusters");
        ok(v13.singles + v13.clusters >= 4, "I-51 Västerås z13 shows more icons: " + v13.singles + " + " + v13.clusters);
      }
      await ctx.close().catch(() => {});
    }
  } catch (e) { console.log("ERR " + e.stack); fail++; }
  await b.close();
  console.log((fail ? "FAIL " : "OK ") + pass + " pass, " + fail + " fail"); process.exit(fail ? 1 : 0);
})();
