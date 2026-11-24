// barcard-map-pw.js — I-133 bar card band on the REAL map (Mapbox GL, mocked Supabase), light map (Skymning, mb-dusk) and dark
// map (Natt, mb-night): every one of the 9 themes over each map (pictures in out/ui1-shots/barcard-*.png, uploaded by e2e.yml),
// and the one click router: with the card open, a tap on the open bar's own pin only closes it (selects nothing); the next tap opens it.
// Needs MAPBOX_TEST_TOKEN (run-all.sh skips without it). Mapbox map loads: 2 (one per style). Usage: node barcard-map-pw.js <port>
const { chromium } = require("playwright");
const { TOKEN, launchOpts, ghPage, closeCounted, SP } = require("./map3-lib.js");
const fs = require("fs");
const PORT = process.argv[2], DIR = SP + "ui1-shots/";
fs.mkdirSync(DIR, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 400))); c ? pass++ : fail++; };
const PARMA = "x-la-parma-ludvika", LL = [60.15124, 15.18797];
const KINDS = [["pub", "Lyktgubben"], ["sportbar", "Målvakten"], ["cocktail", "Blå timmen"], ["nattklubb", "Neonhallen"], ["olbar", "Gruvbryggeriet Taproom"],
  ["restbar", "Grytan Mat & Bar"], ["hotellbar", "Lobbybaren på Hotell Fyrklövern"], ["olhall", "Stora ölhallen"], ["bar", "Bar Kometen"]];
const settle = async (page, ms) => {
  await page.waitForFunction(() => { try { const m = BASEMAP.mapbox().getMapboxMap(); return BASEMAP.loaded() && m.loaded() && m.areTilesLoaded() && !m.isMoving(); } catch (e) { return true; } }, null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(ms || 1200);
};
const sheets = (page) => page.evaluate(() => [...document.querySelectorAll(".leaflet-popup .bs .pp-title")].map((t) => t.textContent));
(async () => {
  if (!TOKEN) { console.log("SKIP no MAPBOX_TEST_TOKEN"); process.exit(0); }
  const b = await chromium.launch(launchOpts([]));
  try {
    for (const style of ["mb-dusk", "mb-night"]) {
      const { ctx, page, errs } = await ghPage(b, PORT, { vp: { width: 390, height: 844 }, style });
      await page.waitForFunction(() => window.BASEMAP && BASEMAP.isMapbox() && BASEMAP.loaded() && window.GLBARS && GLBARS.on() && window.PN && PN.barcard, null, { timeout: 45000 }).catch(() => console.log("GL not ready"));
      await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
      const cur = await page.evaluate(() => BASEMAP.current());
      ok(cur === style, style + ": the map style is on", cur);
      await page.evaluate((ll) => window.__map.setView(ll, 17, { animate: false }), LL);
      await settle(page, 1500);
      // the real bar sheet from the GL pin
      const opened = await page.evaluate((id) => !!(window.GLBARS.open && GLBARS.open(id)), PARMA);
      await settle(page, 1800);
      let t = await sheets(page);
      const band = await page.evaluate(() => { const b = document.querySelector(".leaflet-popup .pn-bc"); return b ? b.dataset.bc : null; });
      ok(opened && t.length === 1 && band === "pub", style + ": La Parma's sheet opens from the GL pin with the pub band", { opened, t, band });
      await page.screenshot({ path: DIR + "barcard-" + style + "-parma.png" });
      // one click router: a tap on the open bar's own pin (in the strip above the sheet) only closes the card
      const pin = await page.evaluate((ll) => { const p = window.__map.latLngToContainerPoint(ll), c = window.__map.getContainer().getBoundingClientRect(), s = document.querySelector(".leaflet-popup:has(.bs)");
        return { x: c.left + p.x, y: c.top + p.y, sheetTop: s ? s.getBoundingClientRect().top : null }; }, LL);
      if (pin.sheetTop && pin.y < pin.sheetTop - 12 && pin.y > 100) {
        await page.mouse.click(pin.x, pin.y); await page.waitForTimeout(900);
        const t1 = await sheets(page);
        await page.mouse.click(pin.x, pin.y); await page.waitForTimeout(1500);
        const t2 = await sheets(page);
        ok(t1.length === 0, style + ": a tap on the open bar's own pin only closes the card (selects nothing)", t1);
        ok(t2.length === 1 && /La Parma/.test(t2[0]), style + ": the next tap on the pin opens it again (one card)", t2);
      } else console.log("info: " + style + " pin not in the strip above the sheet (" + JSON.stringify(pin) + "): router check skipped");
      // the 9 themes over this map
      for (const [vt, name] of KINDS) {
        const r = await page.evaluate(([id, vt, name, ll]) => {
          try { window.__map.closePopup(); } catch (e) {}
          let bar = null; try { bar = window.BARS && BARS.byId ? BARS.byId(id) : null; } catch (e) {}
          const b = Object.assign({ id, lat: ll[0], lng: ll[1], type: "pub" }, bar || {}, { vt, name });
          L.popup({ offset: L.point(0, -10), className: "olnu-bar" }).setLatLng(ll).setContent(PNDS._A().barPopup(b, [])).openOn(window.__map);
          return true;
        }, [PARMA, vt, name, LL]);
        await page.waitForTimeout(1300);
        const look = await page.evaluate(() => { const b = document.querySelector(".leaflet-popup .pn-bc"); return b ? b.dataset.bc : null; });
        ok(r && look === vt, style + ": theme " + vt + " drawn over the map", look);
        await page.screenshot({ path: DIR + "barcard-" + style + "-" + vt + ".png" });
      }
      ok(errs.length === 0, style + ": no page errors", errs);
      await closeCounted(ctx, page, "barcard-" + style);
    }
  } finally { await b.close(); }
  console.log("barcard-map-pw: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
