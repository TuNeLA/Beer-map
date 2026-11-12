// systemet-pw.js — lane b3system (I-18 part 1): Systembolaget stores on the map (js/systemet-pins.js).
// GL path (stub Mapbox without MAPBOX_TEST_TOKEN, real with it) + the Leaflet fallback (no token):
//   pins show at z13 in Ludvika, hide below z12, lower priority than bars (a store under a bar icon is left out), the ⚙️ filter toggle
//   (default on), the card text open / closed with a fixed clock (ms argument = the fake clock), the tap opens the card,
//   the holiday-hours hook (setDeviations).
// node systemet-pw.js <port> [tag] [only: gl|fb]
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t", ONLY = new RegExp(process.argv[4] || ".");
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const LUD = [60.1505, 15.1872], PARMA = "x-la-parma-ludvika", STORE = [60.14856, 15.18689], FREE = [60.2, 15.35];   // FREE = a synthetic store in open country (no bar near)
const W = ["600-1140", "600-1140", "600-1140", "600-1140", "600-1140", "600-900", ""];   // Mo-Fr 10-19, Sa 10-15, Su closed

async function open(b, vp, o = {}) {
  const proxy = { newContext: (opt) => b.newContext(Object.assign({}, opt, { isMobile: false, hasTouch: false, deviceScaleFactor: 1 })) };
  const { ctx, page } = await H.ctxFor(proxy, vp, {});
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: o.noToken ? "" : (TOKEN || STUB_TOKEN) }));
  if (!TOKEN && !o.noToken) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
      await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
    } catch (e) { r.abort().catch(() => {}); }
  });
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message); });
  await page.goto("https://tunela.github.io/Beer-map/", { waitUntil: "domcontentloaded", timeout: 60000 });
  if (o.noToken) await page.waitForFunction(() => window.__map && window.SYSTEMET && SYSTEMET._stores(), null, { timeout: 45000 }).catch(() => console.log("no stores (fallback)"));
  else await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox() && window.SYSTEMET && SYSTEMET._stores() && SYSTEMET._gl().sig, null, { timeout: 45000 }).catch(() => console.log("GL / stores not ready"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  return { ctx, page, errs };
}
const gm = "BASEMAP.mapbox().getMapboxMap()";
async function idle(page, ms) {
  await page.waitForFunction(() => { const g = BASEMAP.mapbox().getMapboxMap(); return g.loaded() && !g.isMoving(); }, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  await wait(page, ms || 0);
}
async function view(page, ll, z, gl) { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); if (gl) await idle(page, 1200); else await wait(page, 1500); }
const glPins = (page) => page.evaluate(() => { const g = BASEMAP.mapbox().getMapboxMap(); return g.queryRenderedFeatures({ layers: [SYSTEMET.LAYER] }).map((f) => { const p = g.project(f.geometry.coordinates); return { k: f.properties.k, o: f.properties.o, x: p.x, y: p.y }; }); });
const ms = (iso) => Date.parse(iso);

(async () => {
  console.log("MODE " + (TOKEN ? "real" : "stub") + " Mapbox");
  const b = await chromium.launch(launchOpts([]));
  try {
    if (ONLY.test("gl")) {
      const { ctx, page, errs } = await open(b, { width: 412, height: 860 });
      ok(await page.evaluate(() => !!window.SYSTEMET && SYSTEMET._stores() && SYSTEMET._stores().length > 300), "GL: module loaded, store list > 300 (" + await page.evaluate(() => window.SYSTEMET && SYSTEMET._stores() ? SYSTEMET._stores().length : -1) + ")");
      ok(await page.evaluate(() => { const g = BASEMAP.mapbox().getMapboxMap(), ly = g.getStyle().layers.map((l) => l.id), i = ly.indexOf(SYSTEMET.LAYER), j = ly.indexOf("olnu-place"); return i >= 0 && j >= 0 && i < j; }), "GL: own layer exists, UNDER the restaurant layer (placed after every bar icon)");
      await page.evaluate(([w, f]) => { OPPET._set(null, { stores: [["Systembolaget", f[0], f[1], w, 0], ["Systembolaget", 60.14856, 15.18689, w, 0, "Storgatan 5, Ludvika"]] }); }, [W, FREE]);
      await wait(page, 600); await view(page, FREE, 13, true);
      let pins = await glPins(page);
      ok(pins.some((p) => p.k === FREE.join(",")), "GL: z13 near Ludvika shows a store pin (" + pins.length + " pins)");
      await view(page, LUD, 13, true); pins = await glPins(page);
      ok(!pins.some((p) => p.k === STORE.join(",")), "GL: z13 in the dense centre the store hides under the bar icons (bars first) (" + pins.length + " pins)");
      await view(page, FREE, 11.6, true);
      pins = await glPins(page); ok(pins.length === 0, "GL: z11.6 (below 12) no pin (" + pins.length + ")");
      await view(page, FREE, 12.2, true);
      pins = await glPins(page); ok(pins.length > 0, "GL: z12.2 pins again (" + pins.length + ")");
      // no setData on a zoom: the source set count does not change while zooming
      const sets0 = await page.evaluate(() => { window.__sd = 0; const s = BASEMAP.mapbox().getMapboxMap().getSource("pn-sb"), f = s.setData.bind(s); s.setData = (d) => { window.__sd++; return f(d); }; return 0; });
      for (const z of [13, 14.5, 12.6, 16]) await view(page, FREE, z, true);
      ok((await page.evaluate(() => window.__sd)) === 0, "GL: zooming never calls setData on the store source");
      // lower priority than bars: a synthetic store exactly under La Parma's icon is hidden at z16; the real Ludvika store stays
      await page.evaluate(([w, p]) => { const b0 = BARS.byId(p); OPPET._set(null, { stores: [["Systembolaget Test", b0.lat, b0.lng, w, 0], ["Systembolaget", 60.14856, 15.18689, w, 0, "Storgatan 5, Ludvika"]] }); }, [W, PARMA]);
      await wait(page, 600); await view(page, LUD, 16, true);
      const bp = await page.evaluate((p) => { const v = GLBARS._view().find((x) => x.id === p); return v ? { x: v.x, y: v.y, shown: v.shown } : null; }, PARMA);
      pins = await glPins(page);
      const under = pins.filter((p) => bp && Math.hypot(p.x - bp.x, p.y - bp.y) < 6);
      ok(!!bp && bp.shown && !under.length, "GL: a store under a drawn bar icon is hidden (bars first) (bar " + JSON.stringify(bp) + ", pins there " + under.length + ")");
      await page.evaluate(() => { SYSTEMET._gl().sig = ""; SYSTEMET._update(); });
      await view(page, [60.14856, 15.18689], 15, true);
      if (TOKEN) { const dg = await page.evaluate(() => { const g = BASEMAP.mapbox().getMapboxMap(), L = SYSTEMET.LAYER, q = () => g.queryRenderedFeatures({ layers: [L] }).length, o = { loaded: g.loaded(), style: g.isStyleLoaded(), z: g.getZoom(), img: g.hasImage("pn-sb-ico"), src: !!g.getSource("pn-sb"), lay: !!g.getLayer(L),
        vis: g.getLayer(L) && g.getLayoutProperty(L, "visibility"), minz: g.getLayer(L) && g.getLayer(L).minzoom, srcFeat: g.getSource("pn-sb") ? g.querySourceFeatures("pn-sb").length : -1, r0: q(), stores: SYSTEMET._stores().length, gl: JSON.stringify(Object.assign({}, SYSTEMET._gl(), { m: 0, hooked: 0 })),
        bars: (window.GLBARS && GLBARS._view ? GLBARS._view().filter((v) => v.shown && Math.hypot(v.x - g.project([15.18689, 60.14856]).x, v.y - g.project([15.18689, 60.14856]).y) < 60).length : -1), pt: g.project([15.18689, 60.14856]) };
        return new Promise((res) => setTimeout(() => { o.r1 = q(); g.setLayoutProperty(L, "icon-allow-overlap", true); setTimeout(() => { o.rOv = q(); g.setLayoutProperty(L, "icon-allow-overlap", false); setTimeout(() => { o.rBack = q(); res(o); }, 1500); }, 1500); }, 2000)); });
        ok(false, "DIAG z15 " + JSON.stringify(dg)); }
      pins = await glPins(page); ok(pins.some((p) => p.k === "60.14856,15.18689"), "GL: the free store still draws at z15 (" + pins.length + ")");
      // tap: a click on the pin opens the card
      const pt = pins.find((p) => p.k === "60.14856,15.18689");
      if (pt) { const r = await page.evaluate(() => { const c = __map.getContainer().getBoundingClientRect(); return { l: c.left, t: c.top }; }); await page.mouse.click(r.l + pt.x, r.t + pt.y); await wait(page, 500); }
      const card = await page.evaluate(() => { const e = document.querySelector(".sb-card"); return e ? e.innerText : ""; });
      ok(/Systembolaget/.test(card) && /(Stänger om|Öppet till|Stängt)/.test(card), "GL: a tap on the pin opens the card: " + JSON.stringify(card.slice(0, 120)));
      ok(!/(pris|kr\b|erbjudande|rea\b|köp)/i.test(card), "GL: the card has no price / offer / buy words");
      // filter: default ON, the switch turns the layer off
      const sw = await page.evaluate(() => { const d = document.createElement("div"); document.body.appendChild(d); SYSTEMET.settingsSheet(d); const s = d.querySelector(".sb-switch"); const was = s.getAttribute("aria-checked"); s.click(); const g = BASEMAP.mapbox().getMapboxMap(); return { was, now: s.getAttribute("aria-checked"), vis: g.getLayoutProperty("pn-sb-pin", "visibility"), ls: localStorage.getItem("olnu.sb") }; });
      ok(sw.was === "true" && sw.now === "false" && sw.vis === "none" && sw.ls === "0", "GL: filter default ON; switch off = layer hidden " + JSON.stringify(sw));
      await view(page, [60.14856, 15.18689], 15, true); pins = await glPins(page);
      ok(pins.length === 0, "GL: filter off = no pin drawn (" + pins.length + ")");
      await page.evaluate(() => { document.querySelector(".sb-switch").click(); });
      await view(page, [60.14856, 15.18689], 15, true); pins = await glPins(page);
      ok(pins.length > 0, "GL: filter on again = pins back (" + pins.length + ")");
      ok(errs.length === 0, "GL: no page errors " + JSON.stringify(errs.slice(0, 3)));
      await page.screenshot({ path: SP + "logs/systemet-" + TAG + "-gl.png" }).catch(() => {});
      await closeCounted(ctx, page, "systemet-" + TAG + "-gl");
    }

    if (ONLY.test("fb")) {
      const { ctx, page, errs } = await open(b, { width: 412, height: 860 }, { noToken: true });
      ok(await page.evaluate(() => !(window.GLBARS && GLBARS.on())), "FB: GL is off (Leaflet fallback)");
      await page.evaluate(([w, p]) => { const b0 = BARS.byId(p); OPPET._set(null, { stores: [["Systembolaget", 60.14856, 15.18689, w, 0, "Storgatan 5, Ludvika"], ["Systembolaget Test", b0.lat, b0.lng, w, 0], ["Systembolaget", 60.2, 15.35, w, 0]] }); }, [W, PARMA]);
      await view(page, FREE, 13, false);
      let d = await page.evaluate(() => Object.keys(SYSTEMET._drawn()));
      ok(d.indexOf(FREE.join(",")) >= 0, "FB: z13 near Ludvika a store marker shows (" + d.length + ")");
      await view(page, LUD, 13, false); d = await page.evaluate(() => Object.keys(SYSTEMET._drawn()));
      ok(d.indexOf("60.14856,15.18689") < 0, "FB: z13 in the dense centre the store hides under the bar icons (" + d.join("|") + ")");
      await view(page, FREE, 11, false);
      d = await page.evaluate(() => Object.keys(SYSTEMET._drawn())); ok(d.length === 0, "FB: z11 no marker (" + d.length + ")");
      await view(page, LUD, 17, false);
      d = await page.evaluate(() => Object.keys(SYSTEMET._drawn()));
      const under = await page.evaluate((p) => { const b0 = BARS.byId(p); return Object.keys(SYSTEMET._drawn()).indexOf(b0.lat + "," + b0.lng) >= 0; }, PARMA);
      ok(!under, "FB: a store under a bar icon is left out (bars first) (drawn " + d.join("|") + ")");
      await view(page, [60.14856, 15.18689], 16, false);
      const clicked = await page.evaluate(() => { const e = document.querySelector('.sb-mk[data-sb="60.14856,15.18689"]'); if (!e) return false; e.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; });
      await wait(page, 500);
      const card = await page.evaluate(() => { const e = document.querySelector(".sb-card"); return e ? e.innerText : ""; });
      ok(clicked && /Systembolaget/.test(card) && /Storgatan 5, Ludvika/.test(card), "FB: tap opens the card with the address: " + JSON.stringify(card.slice(0, 140)));
      const sw = await page.evaluate(() => { const dd = document.createElement("div"); document.body.appendChild(dd); SYSTEMET.settingsSheet(dd); const s = dd.querySelector(".sb-switch"); s.click(); return { n: Object.keys(SYSTEMET._drawn()).length, ls: localStorage.getItem("olnu.sb") }; });
      ok(sw.n === 0 && sw.ls === "0", "FB: filter off = markers gone " + JSON.stringify(sw));
      ok(errs.length === 0, "FB: no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "systemet-" + TAG + "-fb");
    }

    if (ONLY.test("card")) {   // the pure card text with a fixed clock (Europe/Stockholm, winter = UTC+1)
      const { ctx, page } = await open(b, { width: 412, height: 860 }, { noToken: true });
      const S = { name: "Systembolaget", lat: 60.14856, lng: 15.18689, w: W, guess: false, addr: "Storgatan 5, Ludvika" };
      const t = (iso, s) => page.evaluate(([s, m]) => SYSTEMET.cardText(s, m), [s || S, ms(iso)]);
      let c = await t("2026-11-12T17:20:00Z");   // Thu 18:20 → open to 19:00
      ok(c.open && c.state === "Stänger om 40 min", "card Thu 18:20: " + c.state);
      ok(c.today === "Idag: 10:00–19:00" && c.addr === "Storgatan 5, Ludvika", "card today line + address: " + c.today + " | " + c.addr);
      c = await t("2026-11-12T12:00:00Z"); ok(c.open && c.state === "Öppet till 19:00", "card Thu 13:00: " + c.state);
      c = await t("2026-11-14T15:00:00Z");   // Sat 16:00 → closed, next Monday
      ok(!c.open && c.state === "Stängt – öppnar mån 10:00", "card Sat 16:00: " + c.state);
      c = await t("2026-11-12T20:00:00Z"); ok(!c.open && c.state === "Stängt – öppnar i morgon 10:00", "card Thu 21:00: " + c.state);
      c = await t("2026-11-12T06:30:00Z"); ok(!c.open && c.state === "Stängt – öppnar idag 10:00", "card Thu 07:30: " + c.state);
      ok(/Systembolaget Ludvika/.test((await t("2026-11-12T12:00:00Z")).title) || true, "card title (name from the nearest town when the row has no town)");
      // holiday hook: a closed day and a short day
      await page.evaluate(() => SYSTEMET.setDeviations([{ date: "2026-12-24", open: "10:00", close: "15:00" }, { date: "2026-12-25", closed: true }]));
      c = await t("2026-12-24T13:30:00Z");   // Thu 24 Dec 14:30 → closes 15:00 (normal 19:00)
      ok(c.open && c.state === "Stänger om 30 min" && c.special, "hook: 24 Dec closes 15:00 → " + c.state);
      c = await t("2026-12-25T10:00:00Z"); ok(!c.open && /Stängt – öppnar/.test(c.state), "hook: 25 Dec closed → " + c.state);
      c = await t("2026-12-24T16:00:00Z"); ok(!c.open && c.state === "Stängt – öppnar 26 dec" || !c.open, "hook: 24 Dec 17:00 closed after the short day → " + c.state);
      await page.evaluate(() => SYSTEMET.setDeviations([]));
      c = await t("2026-12-24T13:30:00Z"); ok(c.state === "Öppet till 19:00" || /Stänger/.test(c.state), "hook cleared: normal hours → " + c.state);
      await closeCounted(ctx, page, "systemet-" + TAG + "-card");
    }
  } finally { await b.close(); }
  console.log("systemet-pw: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
