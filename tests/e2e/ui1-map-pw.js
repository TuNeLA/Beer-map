// ui1 map test (real Mapbox GL, mocked Supabase): B5 the Ölpasset map uses the main map style + bar discs ·
// B10 the real zone pill at 360 px for the owner's 4 kommuner (name never cut). Needs MAPBOX_TEST_TOKEN (run-all.sh skips without it).
// usage: node ui1-map-pw.js <port> [shot-tag]   Mapbox map loads: 1 main + 1 Ölpasset mini map.
const { chromium } = require("playwright");
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const fs = require("fs");
const PORT = process.argv[2], TAG = process.argv[3] || "t", DIR = SP + "ui1-shots/";
fs.mkdirSync(DIR, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 500))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const PASS_BARS = { v: 1, nights_n: 5, towns: [{ town: "Ludvika", nights: 5, first: "2026-10-02", last: "2026-11-07" }], bars: [
  { id: "n3472634175", name: "Pitchers", lat: 60.14997, lng: 15.18679, town: "Ludvika", in_se: true, nights: 3, first: "2026-10-02", last: "2026-11-07" },
  { id: "x-lobbybaren-ludvika", name: "Lobbybaren (Grand Hotel Elektra)", lat: 60.15098, lng: 15.18663, town: "Ludvika", in_se: true, nights: 1, first: "2026-10-09", last: "2026-10-09" },
  { id: "x-la-parma-ludvika", name: "La Parma Pub & Restaurang", lat: 60.15124, lng: 15.18797, town: "Ludvika", in_se: true, nights: 2, first: "2026-10-16", last: "2026-11-06" }] };
// zone counts for the owner's test kommuner (B10): Upplands Väsby 0114, Malung-Sälen 2023, Östra Göinge 1256, Smedjebacken 2061
const ZC = { v: 1, at: new Date().toISOString(), k: 3, total: 23, some: true,
  kommun: [{ c: "0114", n: 3 }, { c: "2023" }, { c: "1256", n: 12 }, { c: "2061" }, { c: "2085", n: 5 }],
  lan: [{ c: "01", n: 3 }, { c: "12", n: 12 }, { c: "20", n: 8 }] };
const KOM = [["Upplands Väsby", 59.519, 17.913], ["Malung-Sälen", 60.69, 13.72], ["Östra Göinge", 56.254, 14.077], ["Smedjebacken", 60.135, 15.42]];
async function settle(page, ms) {
  await page.waitForFunction(() => { try { const m = BASEMAP.mapbox().getMapboxMap(); return BASEMAP.loaded() && m.loaded() && m.areTilesLoaded(); } catch (e) { return true; } }, null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(ms || 1200);
}
(async () => {
  if (!TOKEN) { console.log("SKIP no MAPBOX_TEST_TOKEN"); process.exit(0); }
  const b = await chromium.launch(launchOpts([]));
  const nc = b.newContext.bind(b); b.newContext = (o) => nc({ ...o, serviceWorkers: "block" });
  const { ctx, page } = await H.ctxFor(b, { width: 390, height: 844 }, {});
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("m3")) { sessionStorage.setItem("m3", 1); localStorage.setItem("olnu.mapStyle", "mb-dusk"); } } catch (e) {} });
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN }));
  await page.route(/rest\/v1\/rpc\/my_passport/, (r) => J(r, PASS_BARS));
  await page.route(/rest\/v1\/rpc\/zone_counts/, (r) => J(r, ZC));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = [], cons = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|404|ERR_|net::/.test(m.text())) cons.push(m.text().slice(0, 160)); });
  await page.goto("https://tunela.github.io/Beer-map/");
  await page.waitForFunction(() => window.__map && window.BASEMAP && BASEMAP.isMapbox() && BASEMAP.loaded(), null, { timeout: 45000 }).catch(() => console.log("mapbox not loaded"));
  await settle(page, 2500);
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});

  // ---------- B5 Ölpasset map ----------
  await page.evaluate(() => window.PASSPORT.open());
  await page.waitForFunction(() => { const m = window.PASSPORT._map && window.PASSPORT._map(); const g = m && m.gl; return g && g.loaded() && g.areTilesLoaded(); }, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => { const e = document.getElementById("ps-map"); if (e) e.scrollIntoView({ block: "center" }); });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const m = window.PASSPORT._map ? window.PASSPORT._map() : null, main = BASEMAP.mapbox().getMapboxMap(), box = document.getElementById("ps-map");
    const out = { hook: !!m, engine: m && m.engine, pins: m && m.pins, box: !!box, canvas: !!(box && box.querySelector("canvas.mapboxgl-canvas")), esri: !!(box && box.querySelector('img[src*="arcgisonline"]')) };
    if (m && m.gl) {
      const g = m.gl, k = ["lightPreset", "colorLand", "colorWater", "colorRoads", "showPointOfInterestLabels"];
      out.style = (g.getStyle().imports || []).map((i) => i.url || i.id).join(",") || (g.getStyle().name || "");
      out.same = k.every((x) => JSON.stringify(g.getConfigProperty("basemap", x)) === JSON.stringify(main.getConfigProperty("basemap", x)));
      out.cfg = k.map((x) => x + "=" + JSON.stringify(g.getConfigProperty("basemap", x))).join(" ");
      out.interactive = g.boxZoom && g.boxZoom.isEnabled() || g.dragPan && g.dragPan.isEnabled();
      out.discs = [...box.querySelectorAll(".ps-pin-pni img")].filter((i) => /^data:image\/svg\+xml/.test(i.src) && i.naturalWidth > 0).length;
      const br = box.getBoundingClientRect();
      out.inBox = [...box.querySelectorAll(".ps-pin-pni")].every((p) => { const q = p.getBoundingClientRect(); return q.left >= br.left && q.right <= br.right && q.top >= br.top && q.bottom <= br.bottom; });
      out.logo = !!box.querySelector(".mapboxgl-ctrl-logo"), out.attrib = !!box.querySelector(".mapboxgl-ctrl-attrib");
    }
    return out;
  });
  ok(r.engine === "gl" && r.canvas && !r.esri && r.same, "B5 Ölpasset map = Mapbox GL with the main map's style config (" + (r.cfg || "") + ")", r);
  ok(r.pins === 3 && r.discs === 3 && r.inBox, "B5 the 3 bars are the main map's bar discs (mapart SVG), all inside the map", r);
  ok(r.engine === "gl" && !r.interactive && r.logo && r.attrib, "B5 mini map is non-interactive and keeps the Mapbox logo + attribution", r);
  for (const [w, h] of [[390, 844], [360, 780], [430, 932]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(900);
    await page.evaluate(() => { const e = document.getElementById("ps-map"); if (e) e.scrollIntoView({ block: "center" }); }); await page.waitForTimeout(600);
    await page.screenshot({ path: DIR + TAG + "-B5-passport-" + w + ".png" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.getElementById("sheet-close").click()); await page.waitForTimeout(800);
  const gone = await page.evaluate(() => ({ m: window.PASSPORT._map ? window.PASSPORT._map() : null, canv: document.querySelectorAll("canvas.mapboxgl-canvas").length }));
  ok(gone.m && gone.m.engine === null && gone.canv === 1, "B5 the mini map is removed when the sheet closes (1 GL canvas left = the main map)", gone);
  ok(!errs.length && !cons.length, "B5 no page / console errors", { errs: errs.slice(0, 3), cons: cons.slice(0, 3) });

  // ---------- B10 real zone pill at 360 px ----------
  await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(600);
  const res = [];
  for (const [name, lat, lng] of KOM) {
    await page.evaluate(([lat, lng]) => { __map.closePopup(); __map.setView([lat, lng], 8.2, { animate: false }); }, [lat, lng]);
    await settle(page, 2200);
    const p = await page.evaluate((name) => {
      const el = document.getElementById("live-count"), nm = el.querySelector(".zn-pn"), z = window.ZONES && ZONES._zoneAt(__map.getCenter().lat, __map.getCenter().lng);
      return { name, zone: z && z.k, txt: el.textContent.replace(/ /g, " "), zn: el.classList.contains("zn-pill"), cut: el.scrollWidth > el.clientWidth + 1 || !!(nm && nm.scrollWidth > nm.clientWidth + 1),
        whole: (nm ? nm.textContent : el.textContent).indexOf(name) === 0, fs: parseFloat(getComputedStyle(nm || el).fontSize) };
    }, name);
    res.push(p);
    await page.screenshot({ path: DIR + TAG + "-B10-zone-" + name.replace(/\W+/g, "") + "-360.png", clip: { x: 0, y: 0, width: 360, height: 64 } });
  }
  const bad = res.filter((p) => p.zone === p.name && (!p.zn || p.cut || !p.whole || p.fs < 14));
  ok(res.every((p) => p.zone === p.name) && !bad.length, "B10 real zone pill at 360 px: Upplands Väsby, Malung-Sälen, Östra Göinge, Smedjebacken whole, not cut, ≥ 14 px", bad.length ? bad : res.map((p) => p.txt));

  const loads = await closeCounted(ctx, page, "ui1-map-" + TAG);
  console.log("mapbox loads (main map) " + loads + "; + 1 for the Ölpasset mini map");
  await b.close();
  console.log("ui1-map done: pass " + pass + " fail " + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash " + (e && e.stack || e)); process.exit(1); });
