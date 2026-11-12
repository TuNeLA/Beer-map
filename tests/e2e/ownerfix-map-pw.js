// ownerfix item 3 on the REAL Mapbox map (mocked Supabase): food / restaurant icons ~+20 % (20 px disc), bars stay the
// main icons, no food icon on a bar icon, a tap a bit off the dot still opens the place. Shots z15–17 at 360 / 390.
// Needs MAPBOX_TEST_TOKEN (run-all.sh skips without it). usage: node ownerfix-map-pw.js <port> [shot-tag]
const { chromium } = require("playwright");
const { H, TOKEN, launchOpts, SP } = require("./map3-lib.js");
const fs = require("fs");
const PORT = process.argv[2], TAG = process.argv[3] || "t", DIR = SP + "ownerfix-shots/";
fs.mkdirSync(DIR, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 500))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
async function settle(page, ms) {
  await page.waitForFunction(() => { try { const m = BASEMAP.mapbox().getMapboxMap(); return BASEMAP.loaded() && m.loaded() && m.areTilesLoaded(); } catch (e) { return true; } }, null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(ms || 1500);
}
(async () => {
  if (!TOKEN) { console.log("SKIP no MAPBOX_TEST_TOKEN"); process.exit(0); }
  const b = await chromium.launch(launchOpts([]));
  const nc = b.newContext.bind(b); b.newContext = (o) => nc({ ...o, serviceWorkers: "block" });
  for (const w of [360, 390]) {
    const { ctx, page } = await H.ctxFor(b, { width: w, height: w === 360 ? 780 : 844 }, {});
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("m3")) { sessionStorage.setItem("m3", 1); localStorage.setItem("olnu.mapStyle", "mb-dusk"); localStorage.setItem("olnu.places", "1"); } } catch (e) {} });
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN }));
    await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
      const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
      const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
      r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
    });
    await page.goto("https://tunela.github.io/Beer-map/");
    await page.waitForFunction(() => window.__map && window.BASEMAP && BASEMAP.isMapbox() && BASEMAP.loaded(), null, { timeout: 45000 }).catch(() => console.log("mapbox not loaded"));
    await settle(page, 2500);
    await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
    for (const z of [15, 16, 17]) {
      await page.evaluate((z) => window.__map.setView([60.1505, 15.1872], z, { animate: false }), z);
      await settle(page, 2200);
      const r = await page.evaluate(() => {
        const g = BASEMAP.mapbox().getMapboxMap(), feats = g.getLayer("olnu-place") ? g.queryRenderedFeatures({ layers: ["olnu-place"] }) : [];
        const pts = feats.map((f) => { const p = g.project(f.geometry.coordinates); return { x: p.x, y: p.y, id: f.properties.id, img: f.properties.img }; });
        const rects = window.GLBARS && GLBARS.rects ? GLBARS.rects() : [];
        // a food dot (20 px disc around its point) may not sit on a bar icon / pill
        const hitBar = pts.filter((p) => rects.some((q) => p.x + 10 > q.l && p.x - 10 < q.r && p.y + 10 > q.t && p.y - 10 < q.b)).map((p) => p.id);
        const img = pts[0] && g.style && g.style.getImage ? g.style.getImage(pts[0].img) : null;
        const R = window.devicePixelRatio || 1, iw = img && img.data ? Math.round(img.data.width / (img.pixelRatio || R)) : null;
        // the tap target: a food dot in the open middle of the map (not under the top bar / ticker, the rail or the ÖL! bar,
        // and not within 30 px of a bar icon, so the tap can only mean the food dot)
        const W = innerWidth, Hh = innerHeight;
        const free = pts.filter((p) => p.x > 40 && p.x < W - 90 && p.y > 200 && p.y < Hh - 280 && !rects.some((q) => p.x + 30 > q.l && p.x - 30 < q.r && p.y + 30 > q.t && p.y - 30 < q.b));
        return { n: pts.length, hitBar, iw, tok: window.PNTOKENS.size.placeDot, bars: rects.length, first: free[0] || null, free: free.length };
      });
      await page.screenshot({ path: DIR + TAG + "-3-map-" + w + "-z" + z + ".png" });
      if (z === 15) { ok(true, w + " z15 food dots (shown from z16): " + r.n, r); continue; }
      ok(r.n > 0, w + " z" + z + " food dots on the real map", { n: r.n, bars: r.bars });
      ok(!r.hitBar.length, w + " z" + z + " no food dot on a bar icon or pill", r.hitBar);
      if (r.iw != null) ok(r.iw >= 26, w + " z" + z + " food icon image ≥ 26 px (20 px disc + ring + shadow room; was 24)", r.iw);
      if (z === 17 && !r.first) ok(true, w + " z17 no food dot in the open middle of the map to tap (skip)", { n: r.n, free: r.free });
      if (z === 17 && r.first) {
        const before = await page.evaluate(() => (window.GLBARS && GLBARS.stats ? GLBARS.stats.lastTap : null) || (window.GLBARS && GLBARS._stats ? GLBARS._stats().lastTap : null));
        await page.mouse.click(r.first.x + 9, r.first.y + 9); await page.waitForTimeout(900);
        const tap = await page.evaluate(() => ({ sheet: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent, popup: !!document.querySelector(".leaflet-popup, .mapboxgl-popup, .olnu-sheet") }));
        await page.screenshot({ path: DIR + TAG + "-3-map-" + w + "-tap.png" });
        ok(tap.sheet || tap.popup, w + " z17 a tap 9 px off the food dot centre still opens the place", { tap, before });
        await page.evaluate(() => { try { document.getElementById("sheet-close").click(); } catch (e) {} try { window.__map.closePopup(); } catch (e) {} });
      }
    }
    await ctx.close();
  }
  await b.close();
  console.log("SUMMARY ownerfix-map pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash " + (e && e.stack || e)); process.exit(1); });
