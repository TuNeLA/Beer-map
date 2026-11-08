// glmap test: Mapbox-only picker (2 entries), default Skymning, one Mapbox map load per open, GL bar markers / heat / clouds,
// alignment during wheel + pinch zoom (< 2 px), taps open the bar sheet, silent fallback, screenshots.
// node glmap-pw.js <port> [tag] [smoke]
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t", SMOKE = process.argv[4] === "smoke", DRIFT = process.argv[4] === "drift";
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
async function open(b, o = {}) {
  const { ctx, page } = await H.ctxFor(b, { width: 412, height: 915 }, {});
  await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem("gm")) { sessionStorage.setItem("gm", 1); if (s) localStorage.setItem("olnu.mapStyle", s); } } catch (e) {} }, o.style || "");
  const sessions = [];
  page.on("request", (r) => { const u = r.url(); if (/api\.mapbox\.com\/map-sessions/.test(u)) sessions.push(u); });
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, mapbox_token: o.noToken ? "" : TOKEN }) }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("https://tunela.github.io/Beer-map/");
  await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => console.log("no pills"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  return { ctx, page, errs, sessions };
}
async function settle(page, ms) {
  await page.waitForFunction(() => { if (!BASEMAP.isMapbox()) return true; const m = BASEMAP.mapbox().getMapboxMap(); return BASEMAP.loaded() && m.loaded() && m.areTilesLoaded(); }, null, { timeout: 30000 }).catch(() => {});
  await wait(page, ms || 1800);
}
async function view(page, ll, z) { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await settle(page, 2200); }
const LUD = [60.1503, 15.1876], STH = [59.3326, 18.0649];

// alignment: a DOM test marker at a bar point vs the GL projection of that point, every animation frame
async function drift(page, cdp, kind) {
  // glfix: start on a calm map (the last zoom of the previous run may still animate on a busy machine; a marker added
  // during a zoom animation is a Leaflet artefact, not GL drift)
  await page.waitForFunction(() => !__map._animatingZoom && !(__map.touchZoom && __map.touchZoom._zooming), null, { timeout: 15000 }).catch(() => {});
  await wait(page, 500);
  await page.evaluate(() => {
    const ll = __map.getCenter(); window.__dm && __map.removeLayer(__dm);
    window.__dm = L.marker([ll.lat + 0.0012, ll.lng + 0.002], { icon: L.divIcon({ className: "", html: '<i id="dm" style="position:absolute;left:-2px;top:-2px;width:4px;height:4px"></i>', iconSize: [0, 0] }), pane: "markerPane" }).addTo(__map);
    window.__dr = []; window.__drOn = true;
    const g = BASEMAP.mapbox().getMapboxMap(), cv = g.getCanvas();
    // glfix: measured right before paint (a ResizeObserver runs after ALL rAF callbacks of the frame, Leaflet's included), so it
    // is what the user sees; a measure inside our own rAF could run before Leaflet's callback of the same frame
    const meas = () => { const e = document.getElementById("dm"); if (e && __drOn) { const r = e.getBoundingClientRect(), c = cv.getBoundingClientRect(), ll = __dm.getLatLng(), p = g.project([ll.lng, ll.lat]);
      const sx = c.width / cv.clientWidth || 1; __dr.push(Math.hypot(r.left + 2 - (c.left + p.x * sx), r.top + 2 - (c.top + p.y * sx))); } };
    if (!window.__pr) { window.__pr = document.createElement("div"); __pr.style.cssText = "position:fixed;left:0;top:0;height:1px;width:1px;pointer-events:none;opacity:0"; document.body.appendChild(__pr); new ResizeObserver(() => meas()).observe(__pr); }
    let w = 1; const step = () => { w = 3 - w; __pr.style.width = w + "px"; if (__drOn) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  if (kind === "wheel") { await page.mouse.move(206, 480); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await wait(page, 160); } await wait(page, 600); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await wait(page, 160); } await wait(page, 700); }
  else { await cdp.send("Input.synthesizePinchGesture", { x: 206, y: 480, scaleFactor: 2.5, relativeSpeed: 500, gestureSourceType: "touch" }); await wait(page, 500);
    await cdp.send("Input.synthesizePinchGesture", { x: 206, y: 480, scaleFactor: 0.4, relativeSpeed: 500, gestureSourceType: "touch" }); await wait(page, 700); }
  const d = await page.evaluate(() => { __drOn = false; __map.removeLayer(__dm); window.__dm = null; const a = __dr.slice().sort((x, y) => x - y); return { n: a.length, max: +(a[a.length - 1] || 0).toFixed(2), p95: +(a[Math.floor(a.length * 0.95)] || 0).toFixed(2), all: __dr.map((x) => +x.toFixed(1)).join(' ') }; });
  return d;
}
async function tapBar(page, wantFull) {
  const pt = await page.evaluate((wantFull) => {
    const g = BASEMAP.mapbox().getMapboxMap(), cv = g.getCanvas().getBoundingClientRect(), W = innerWidth, Hh = innerHeight;
    const vis = new Set((GLBARS._view ? GLBARS._view() : []).filter((v) => v.shown).map((v) => v.id));
    const fs = GLBARS._feats().filter((p) => p.t === (wantFull ? 1 : 0) && (!GLBARS._view || vis.has(p.id)));
    for (const p of fs) {
      const mk = GLBARS._marker(p.id); if (!mk) continue; const ll = mk.getLatLng(), q = g.project([ll.lng, ll.lat]);
      const x = cv.left + q.x, y = cv.top + q.y; if (x < 60 || x > W - 60 || y < 220 || y > Hh - 330) continue;
      // glfix: a dot under another bar's full pill image is not a fair dot tap
      if (!wantFull && GLBARS.rects && GLBARS.rects().some((r) => r.t1 && r.id !== p.id && x >= r.l && x <= r.r && y >= r.t && y <= r.b)) continue;
      const im = GLBARS._img(p.id); const pill = wantFull && im && im.parts.find((x) => x.sel === ".pill");
      const c = mk.options && mk.options.olnuC, name = (c && c.bar && c.bar.name) || (c && c.name) || "";
      return { id: p.id, name, x: Math.round(x + (pill ? (pill.bb[0] + pill.bb[2]) / 2 : 0)), y: Math.round(y + (pill ? (pill.bb[1] + pill.bb[3]) / 2 : 0)), pill: !!pill };
    }
    return null;
  }, wantFull);
  if (!pt) return { pt: null };
  await page.evaluate(() => { window.__pe = []; if (!window.__peOn) { window.__peOn = 1; __map.on("popupopen popupclose", (e) => __pe.push(e.type + "@" + Math.round(performance.now()) + ":" + (new Error().stack.split("\n").slice(3, 16).map((l) => l.replace(/^\s*at /, "").replace(/https:\/\/[^ ]*\/(js\/)?/, "").replace(/\?v=\w+/, "").slice(0, 60)).join(" > ")))); window.addEventListener("popstate", () => __pe.push("popstate@" + Math.round(performance.now()))); } });
  await page.evaluate(() => { try { GLBARS.stats.lastTap = ""; } catch (e) {} });   // a stale value from the last tap must not count
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForFunction(() => !!document.querySelector(".olnu-sheet .bs, .leaflet-popup .bs"), null, { timeout: 6000 }).catch(() => {});   // glfix: busy machine
  await wait(page, 600);
  const r = await page.evaluate(() => ({ sheet: !!document.querySelector(".olnu-sheet .bs, .leaflet-popup .bs"), title: (document.querySelector(".olnu-sheet .pp-title, .leaflet-popup .pp-title") || {}).textContent || "",
    here: !!document.querySelector('.olnu-sheet details[data-fold="here"][open], .leaflet-popup details[data-fold="here"][open]'), tap: GLBARS.stats.lastTap, pe: (window.__pe || []).slice(0, 8) }));
  // glfix: close like a user (✕ = SHEETNAV unwinds its history entry); a bare closePopup() left a back entry whose late
  // popstate closed the NEXT sheet
  await page.evaluate(() => { const x = document.querySelector(".leaflet-popup-close-button, .olnu-sheet .sheet-close, #sheet-close"); if (x) x.click(); else __map.closePopup(); });
  await wait(page, 900);
  return Object.assign({ pt }, r);
}
(async () => {
  const b = await chromium.launch(launchOpts([]));
  const nc = b.newContext.bind(b); b.newContext = (o) => nc({ ...o, serviceWorkers: "block" });
  // 1. a user on an old style (Klassisk) opens the app
  const { ctx, page, errs, sessions } = await open(b, { style: "classic" });
  await settle(page, 2500);
  const st0 = await page.evaluate(() => ({ cur: BASEMAP.current(), stored: localStorage.getItem("olnu.mapStyle"), gl: GLBARS.on(), loads: BASEMAP.mapboxLoads(), feats: GLBARS._feats().length,
    pane: getComputedStyle(document.querySelector(".leaflet-hotbars-pane")).display, heat: !!BASEMAP.mapbox().getMapboxMap().getLayer("olnu-heat") }));
  console.log("start", JSON.stringify(st0));
  ok(st0.cur === "mb-dusk" && st0.stored === "mb-dusk", "old Klassisk user → Skymning (" + st0.cur + ", stored " + st0.stored + ")");
  ok(st0.gl && st0.feats > 0 && st0.pane === "none" && st0.heat, "GL bars on, " + st0.feats + " features, DOM bar panes hidden, heat layer");
  for (const [tag, ll, z] of DRIFT ? [] : [["ludvika-z13", LUD, 13], ["ludvika-z16", [60.15124, 15.18797], 16], ["sthlm-z14", STH, 14]]) {
    await view(page, ll, z); await page.screenshot({ path: SP + "glmap-" + TAG + "-dusk-" + tag + ".png", timeout: 120000 }).catch((e) => console.log("shot failed", e.message.slice(0, 60)));
  }
  if (SMOKE) { console.log(JSON.stringify(await page.evaluate(() => GLBARS.stats))); console.log("errs", errs.slice(0, 4)); await closeCounted(ctx, page, "glmap-smoke"); await b.close(); return; }
  if (DRIFT) { const cdp = await ctx.newCDPSession(page); for (let i = 0; i < 3; i++) { await view(page, LUD, 14); console.log("drift", JSON.stringify(await drift(page, cdp, "pinch"))); } await closeCounted(ctx, page, "glmap-drift"); await b.close(); return; }
  // 2. taps
  await view(page, LUD, 15);
  const t1 = await tapBar(page, true); console.log("tap full", JSON.stringify(t1));
  ok(t1.sheet && t1.title, "tap on a GL full pill opens the bar sheet (" + t1.title + ")");
  if (t1.pt && t1.pt.pill) ok(t1.here, "tap on the pill opens the 🍺 Folk här fold");
  // glfix: at z16 every Ludvika bar may be full (tiers: empty bars full from z16); dots are at z14–15. Live data: try a few views
  // until a dot that no other pill covers is on screen
  let t2 = { pt: null };
  for (const [ll, z] of [[LUD, 14], [LUD, 15], [STH, 15], [STH, 14]]) { await view(page, ll, z); t2 = await tapBar(page, false); if (t2.pt) break; } console.log("tap dot", JSON.stringify(t2));
  // ds30+: a DOM chip on the same spot (my pin / friends' chip at my check-in bar) may take the tap first; then GLBARS.stats.lastTap
  // stays empty. Either way the sheet must be THAT bar's (a different bar's sheet = real bug).
  ok(t2.pt && t2.sheet && t2.title && ((t2.tap && t2.tap.indexOf(t2.pt.id) === 0) || (!t2.tap && !!t2.pt.name && t2.title === t2.pt.name)),
    "tap on a GL dot opens THAT bar's sheet (" + t2.title + ", want " + (t2.pt && (t2.pt.name || t2.pt.id)) + ", GL tap " + (t2.tap || "-") + ")");
  if (process.env.TAPONLY) { await closeCounted(ctx, page, "glmap-taponly"); await b.close(); return; }
  // 3. alignment during wheel + pinch zoom
  const cdp = await ctx.newCDPSession(page);
  for (const [nm, ll] of [["ludvika", LUD], ["sthlm", STH]]) {
    await view(page, ll, 14); await wait(page, 1500);
    for (const k of ["wheel", "pinch"]) { const d = await drift(page, cdp, k); console.log("drift", nm, k, JSON.stringify(d)); ok(d.n > 5 && d.max < 2, "aligned " + nm + " " + k + " max " + d.max + " px (" + d.n + " frames)"); }
  }
  // glfix: ✏️ BAREA editor hides the GL bar layers (body.ba-edit), and shows them again on close
  await view(page, [60.14997, 15.18679], 17);
  const ba = await page.evaluate(async () => {
    const g = BASEMAP.mapbox().getMapboxMap(), ids = GLBARS._layers().filter((x) => /bar/.test(x));
    const vis = () => ids.map((id) => g.getLayoutProperty(id, "visibility") || "visible");
    const before = vis(); const opened = window.BAREA && BAREA.open({ id: "n3472634175", name: "Pitchers", lat: 60.14997, lng: 15.18679 });
    await new Promise((r) => setTimeout(r, 400)); const during = vis(), cls = document.body.classList.contains("ba-edit");
    if (window.BAREA) BAREA.close(); await new Promise((r) => setTimeout(r, 400));
    return { ids, opened, cls, before, during, after: vis() };
  });
  console.log("barea", JSON.stringify(ba));
  ok(ba.opened && ba.cls && ba.during.every((v) => v === "none") && ba.before.every((v) => v === "visible") && ba.after.every((v) => v === "visible"),
    "✏️ BAREA editor: GL bar layers hidden while editing (" + ba.during.join(",") + "), back after close");
  await page.evaluate(() => __map.closePopup());
  // clouds (☁️ Senaste dagarna chip) in GL
  await view(page, LUD, 13);
  await page.evaluate(() => { const b = document.getElementById("btn-ghostpins"); if (b) b.click(); }); await wait(page, 2500);
  const cl = await page.evaluate(() => ({ n: window.CLOUDS && CLOUDS._last ? CLOUDS._last.count() : -1, gl: GLBARS.stats.cloudPts, cv: CLOUDS._last && CLOUDS._last._c ? CLOUDS._last._c.width : -1 }));
  console.log("clouds", JSON.stringify(cl));
  ok(cl.n <= 0 || (cl.gl === cl.n && cl.cv === 0), "clouds drawn in GL (" + cl.gl + " points), canvas empty");
  await page.screenshot({ path: SP + "glmap-" + TAG + "-dusk-clouds-z13.png", timeout: 120000 }).catch((e) => console.log("shot failed", e.message.slice(0, 60)));
  await page.evaluate(() => { const b = document.getElementById("btn-ghostpins"); if (b) b.click(); }); await wait(page, 600);
  // 4. picker: exactly 2 entries, switch to Natt = same map object
  await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 900);
  await page.evaluate(() => { const t = [...document.querySelectorAll("#sheet [role=tab], #sheet .pf-tabs button")].find((x) => /Inställ|Settings/.test(x.textContent)); if (t) t.click(); }); await wait(page, 700);
  const pk = await page.evaluate(() => [...document.querySelectorAll("#sheet [data-bm]")].map((x) => x.getAttribute("data-bm") + ":" + x.textContent.trim()));
  console.log("picker", JSON.stringify(pk));
  ok(pk.length === 2 && /mb-dusk/.test(pk[0]) && /mb-night/.test(pk[1]), "style picker has exactly 2 entries (Skymning ⭐, Natt)");
  await page.screenshot({ path: SP + "glmap-" + TAG + "-picker.png", timeout: 120000 }).catch((e) => console.log("shot failed", e.message.slice(0, 60)));
  await page.evaluate(() => document.querySelector('#sheet [data-bm="mb-night"]').click()); await wait(page, 600);
  await page.evaluate(() => { const c = document.querySelector("#sheet .sheet-close, #sheet [data-close], #sheet-close"); if (c) c.click(); }); await wait(page, 600);
  await page.keyboard.press("Escape").catch(() => {});
  await settle(page, 1500);
  for (const [tag, ll, z] of [["ludvika-z13", LUD, 13], ["ludvika-z16", [60.15124, 15.18797], 16], ["sthlm-z14", STH, 14]]) {
    await view(page, ll, z); await page.screenshot({ path: SP + "glmap-" + TAG + "-night-" + tag + ".png", timeout: 120000 }).catch((e) => console.log("shot failed", e.message.slice(0, 60)));
  }
  // 5. hide / show (app switch, resume) and a few style switches
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await wait(page, 500);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("pageshow")); });
  for (const s of ["mb-dusk", "mb-night", "mb-dusk"]) { await page.evaluate((s) => BASEMAP.set(s), s); await wait(page, 600); }
  await settle(page, 1200);
  const st1 = await page.evaluate(() => ({ loads: BASEMAP.mapboxLoads(), cur: BASEMAP.current(), gl: GLBARS.on() }));
  console.log("after switches", JSON.stringify(st1), "map-sessions", sessions.length);
  ok(st1.loads === 1, "ONE Mapbox map object per open after 2 picker + 3 API switches + hide/show (" + st1.loads + ")");
  ok(sessions.length <= 1, "billing calls (api.mapbox.com/map-sessions) per open: " + sessions.length);
  // 6. silent fallback
  await page.evaluate(() => BASEMAP.set("classic")); await wait(page, 800);
  const fb = await page.evaluate(() => ({ cur: BASEMAP.current(), gl: GLBARS.on(), pane: getComputedStyle(document.querySelector(".leaflet-hotbars-pane")).display, tiles: document.querySelectorAll(".leaflet-tile").length, heat: !!document.querySelector("canvas.leaflet-heatmap-layer") }));
  console.log("fallback", JSON.stringify(fb));
  ok(fb.cur === "classic" && !fb.gl && fb.pane !== "none" && fb.tiles > 0, "fallback: raster tiles, DOM markers back, GL off");
  ok(errs.length === 0, "no page errors " + JSON.stringify(errs.slice(0, 3)));
  await closeCounted(ctx, page, "glmap-" + TAG);
  // 7. no token at all → raster fallback, no Mapbox load
  const o2 = await open(b, { noToken: true });
  await wait(o2.page, 3000);
  const nt = await o2.page.evaluate(() => ({ cur: BASEMAP.current(), loads: BASEMAP.mapboxLoads(), gl: GLBARS.on(), tiles: document.querySelectorAll(".leaflet-tile").length, pills: document.querySelectorAll(".leaflet-hotbars-pane .pill").length }));
  console.log("no token", JSON.stringify(nt));
  ok(nt.cur === "classic" && nt.loads === 0 && !nt.gl && nt.tiles > 0, "no token: silent raster fallback, 0 Mapbox loads");
  await o2.ctx.close();
  console.log("RESULT pass " + pass + " fail " + fail);
  await b.close();
})();
