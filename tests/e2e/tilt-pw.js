// tilt-pw.js — lane tilt (M4; owner 15 Nov 2026, I-115 sheet 4 "we can have tilted on the map", I-117): the tilted map view.
//  btn     the "3D" button: only on the GL map, 44 px, right above Locate (same right edge, 8 px gap), not on the rail
//  tilt    tap = pitch 50 (stored "1"), tap again = flat ("0"); two-finger tilt on, rotation still off; a reload keeps it;
//          zoomed far out = flat by itself, back in = tilted; tap while zoomed out = zoom in + tilt
//  maths   tilted: getBounds holds all 4 screen corners; fitBounds keeps both points on screen; clusters by SCREEN distance
//  taps    tilted: a tap on a GL bar opens THAT bar's sheet; a tap that closes the sheet selects nothing (one click router);
//          people pins sit where GL projects them and are on top at their centre (tappable)
//  reduced reduced motion: the camera jumps (no ease)
//  raster  no token (raster fallback): no button, no tilt, no page error
//  season  a northern lights night (?date= Dec night, ?wx=clear, ?kp=6): tilted = 62 (the aurora needs 60+) and the aurora
//          shows; the 3D Christmas tree shows in the tilted view; nothing of the sky canvas covers a bar (holes)
//  perf    frame time on the GL map, flat vs tilted, CPU throttle 1x and 4x (numbers for DONE.md; loose check only)
//  shots   with a real token: flat / tilted / town at 390x844 @2x in out/logs/tilt-shots/ (CI artifact e2e-logs-<shard>)
// GL path: MAPBOX_TEST_TOKEN = the real Standard style; else a STUB Mapbox (style = one background layer, like seasons-pw.js).
// usage: node tilt-pw.js <port> [sections regex]
const { H, TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = require("./env.js").OUT;
const PORT = process.argv[2], ONLY = new RegExp(process.argv[3] || ".");
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 700))); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const BAR = { parma: [60.15124, 15.18797], pitch: [60.14997, 15.18679], lobby: [60.15098, 15.18663], grek: [60.15205, 15.18059] };
const LUD = [60.1505, 15.1872];
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let nid = 9000;
const P = (ll, o = {}) => ({ id: nid++, lat: ll[0] + (o.d || 0), lng: ll[1] + (o.e || 0), beer_count: 1, precise: true, created_at: iso(30), is_mine: !!o.mine, friend_name: o.f || null, skal_count: 0, i_skaled: false, shot_count: 0 });
const crowd = () => { const b = []; for (let i = 0; i < 16; i++) b.push(P(BAR.parma, i === 0 ? { f: "Oskar" } : {})); for (let i = 0; i < 9; i++) b.push(P(BAR.pitch, i === 1 ? { f: "Ida" } : {}));
  for (let i = 0; i < 4; i++) b.push(P(BAR.lobby)); b.push(P([60.1530, 15.1905], { f: "Robban" }), P([60.1478, 15.1840])); return b; };
const TILES = () => (sl) => {   // the town for the stub style (js/seasonmap.js hook): Storgatan, a church, a park
  const L = (c, name, cls) => ({ properties: { name, class: cls }, geometry: { type: "LineString", coordinates: c } });
  if (sl === "road") return [L([[15.1840, 60.1488], [15.1868, 60.1499], [15.1883, 60.1510], [15.1900, 60.1522]], "Storgatan", "pedestrian"), L([[15.1830, 60.1517], [15.1920, 60.1495]], "Eriksgatan", "street")];
  if (sl === "poi_label") return [{ properties: { maki: "religious-christian", name: "Kyrkan", class: "religion" }, geometry: { type: "Point", coordinates: [15.1883, 60.1532] } }];
  if (sl === "landuse") return [{ properties: { class: "park" }, geometry: { type: "Polygon", coordinates: [[[15.1795, 60.1470], [15.1825, 60.1470], [15.1825, 60.1484], [15.1795, 60.1484], [15.1795, 60.1470]]] } }];
  return [];
};

async function open(b, mode, o = {}) {
  const ctxo = o.ctx;
  const { ctx, page } = ctxo ? { ctx: ctxo, page: await ctxo.newPage() } : await H.ctxFor(b, { width: 390, height: 844 }, { reduced: !!o.reduced });
  if (!ctxo) {
    await ctx.setGeolocation({ latitude: 60.14997, longitude: 15.18679 });
    if (o.tilt != null) await ctx.addInitScript((v) => { try { if (!localStorage.getItem("tl0")) { localStorage.setItem("tl0", 1); localStorage.setItem("olnu.map.tilt", v); } } catch (e) {} }, o.tilt);
    if (mode === "gl" && !TOKEN) await ctx.addInitScript(`window.__PN_SEASON_TILES = (${TILES.toString()})();`);
  }
  const beers = crowd();
  await page.route(/rest\/v1\/rpc\/live_beers/, (r) => J(r, beers));
  await page.route(/rest\/v1\/rpc\/live_others/, (r) => J(r, []));
  const q = o.query || "?season=normal&wx=none&light=0";
  let url = "http://127.0.0.1:" + PORT + "/" + q;
  if (mode === "gl") {
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN || STUB_TOKEN }));
    if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
    await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
      const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
      try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
        await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
      } catch (e) { r.abort().catch(() => {}); }
    });
    url = "https://tunela.github.io/Beer-map/" + q;
  } else await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: "" }));
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message.slice(0, 200)); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (mode === "gl") await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox() && window.PNTILT, null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  else await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill, .cm").length > 2, null, { timeout: 30000 }).catch(() => console.log("no pins"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => { window.__gm = () => BASEMAP.mapbox().getMapboxMap(); }).catch(() => {});
  await wait(page, 1500);
  return { ctx, page, errs };
}
const view = async (page, ll, z, ms) => { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await wait(page, ms || 1500); };
const pitch = (page) => page.evaluate(() => Math.round(__gm().getPitch() * 10) / 10);
// the season map finished its work for this view (map still + loaded, no build / pin check waiting, counters still 600 ms)
const ssSettle = (page, ms) => page.evaluate((ms) => new Promise((res) => { const m = __gm(), t0 = Date.now(); let last = "", same = 0;
  const tick = () => { const s = PNSeasonMap.stats, k = s.builds + "," + (s.culls || 0), calm = m.loaded() && !m.isMoving() && !(PNSeasonMap._pending && PNSeasonMap._pending());
    same = calm && k === last ? same + 1 : 0; last = k;
    if (same >= 4 || Date.now() - t0 > ms) return requestAnimationFrame(() => requestAnimationFrame(() => res(same >= 4)));
    setTimeout(tick, 150); };
  tick(); }), ms || 12000);
const settleCam = (page, ms) => page.waitForFunction(() => !__gm().isMoving() && !__gm().isEasing(), null, { timeout: ms || 6000 }).catch(() => {});
const btnBox = (page) => page.evaluate(() => { const e = document.getElementById("pn-tilt"), l = document.getElementById("btn-locate"); const r = (x) => x && x.getClientRects().length ? x.getBoundingClientRect().toJSON() : null;
  return { has: !!e, shown: !!(e && !e.hidden && e.getClientRects().length), b: r(e), loc: r(l), pressed: e && e.getAttribute("aria-pressed"), label: e && e.getAttribute("aria-label"),
    rail: [...document.querySelectorAll(".pn-rail, #btn-more")].filter((x) => x.id !== "pn-tilt").map(r).filter(Boolean), store: (() => { try { return localStorage.getItem("olnu.map.tilt"); } catch (e) { return "x"; } })() }; });
const inter = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const tapTilt = async (page) => { await page.evaluate(() => { const e = document.getElementById("pn-tilt"); if (e) e.scrollIntoView({ block: "nearest" }); }); const bb = await btnBox(page);
  if (bb.shown) await page.touchscreen.tap(bb.b.x + bb.b.width / 2, bb.b.y + bb.b.height / 2); return bb.shown; };

/* ---------- btn + tilt + maths + taps (GL) ---------- */
async function runGL(b) {
  const { ctx, page, errs } = await open(b, "gl", { tilt: "0" });
  await view(page, LUD, 16, 2500);
  if (ONLY.test("btn")) {
    const bb = await btnBox(page);
    ok(bb.has && bb.shown && bb.pressed === "false", "the '3D' button shows on the GL map (flat: not pressed)", bb);
    if (bb.shown) {
      ok(bb.b.width >= 44 && bb.b.height >= 44, "the button is at least 44 x 44 px", bb.b);
      ok(bb.loc && Math.abs(bb.b.right - bb.loc.right) <= 1 && Math.abs(bb.loc.top - bb.b.bottom - 8) <= 1.5, "right above Locate: same right edge, 8 px gap", { b: bb.b, loc: bb.loc });
      ok(!bb.rail.some((r) => inter(r, bb.b)), "it touches no rail button", { b: bb.b, rail: bb.rail });
      ok(/Lutad karta/.test(bb.label || ""), "it has a Swedish name for screen readers (" + bb.label + ")");
    }
  }
  if (ONLY.test("tilt")) {
    const h = await page.evaluate(() => { const m = __gm(); return { maxP: m.getMaxPitch(), tp: !!(m.touchPitch && m.touchPitch.isEnabled()), rot: m.dragRotate.isEnabled() || (m.touchZoomRotate.isRotationEnabled ? m.touchZoomRotate.isRotationEnabled() : false) }; });
    ok(h.maxP >= 60 && h.tp && !h.rot, "two-finger tilt is on (max pitch " + h.maxP + "), rotation stays off", h);
    await tapTilt(page); await settleCam(page); await wait(page, 300);
    let p = await pitch(page), bb = await btnBox(page);
    ok(Math.abs(p - 50) < 0.6 && bb.pressed === "true" && bb.store === "1", "tap '3D': the map tilts to 50 degrees, the button is pressed, the choice is stored", { p, pressed: bb.pressed, store: bb.store });
    await page.screenshot({ path: OUT + "logs/tilt-gl-tilted.png" }).catch(() => {});
    // zoom far out: flat by itself; back in: tilted again
    await page.evaluate(() => __map.setView([60.1505, 15.1872], 12.5, { animate: false })); await wait(page, 300); await settleCam(page); await wait(page, 200);
    const pOut = await pitch(page);
    await page.evaluate(() => __map.setView([60.1505, 15.1872], 16, { animate: false })); await wait(page, 300); await settleCam(page); await wait(page, 200);
    const pIn = await pitch(page);
    ok(pOut < 0.6 && Math.abs(pIn - 50) < 0.6 && (await btnBox(page)).store === "1", "zoomed far out the map goes flat, zoomed back in it tilts again (choice kept)", { pOut, pIn });
    // the user's two-finger tilt (a real touch gesture): flat again counts as the choice
    const cdp = await ctx.newCDPSession(page);
    const drag = async (dy) => { const x1 = 150, x2 = 240, y = 520, pts = (yy) => [{ x: x1, y: yy, id: 1 }, { x: x2, y: yy, id: 2 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(y) });
      for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(y + dy * i / 12) }); await wait(page, 30); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(page, 300); await settleCam(page); };
    await drag(240); const pg = await pitch(page), sg = (await btnBox(page)).store;
    ok(pg < 15 && sg === "0", "two fingers dragged down: the map goes (nearly) flat and that is stored as the choice", { pitch: pg, store: sg });
    await drag(-260); const pu = await pitch(page), su = (await btnBox(page)).store;
    ok(pu > 15 && su === "1", "two fingers dragged up: the map tilts (" + pu + ") and that is stored", { pitch: pu, store: su });
    await tapTilt(page); await settleCam(page); await wait(page, 300);
    p = await pitch(page); bb = await btnBox(page);
    ok(p < 0.6 && bb.pressed === "false" && bb.store === "0", "tap '3D' again: flat, not pressed, stored", { p, pressed: bb.pressed, store: bb.store });
    // zoomed out + tap: zoom in to the town and tilt
    await page.evaluate(() => __map.setView([60.1505, 15.1872], 12, { animate: false })); await wait(page, 500);
    await tapTilt(page); await settleCam(page, 8000); await wait(page, 300);
    const zt = await page.evaluate(() => ({ z: +__map.getZoom().toFixed(2), p: Math.round(__gm().getPitch()) }));
    ok(zt.z >= 13.95 && zt.p === 50, "tap '3D' while zoomed far out: zoom in to the town view and tilt", zt);
    // a jump right after the tap (another module's setView) must not leave the map half tilted
    await page.evaluate(() => { PNTILT.set(false); __gm().jumpTo({ pitch: 0 }); }); await wait(page, 300);
    await page.evaluate(() => { PNTILT.set(true); setTimeout(() => __map.setView([60.1505, 15.1872], 16, { animate: false }), 120); }); await wait(page, 400); await settleCam(page); await wait(page, 300);
    const pj = await pitch(page);
    ok(Math.abs(pj - 50) < 0.6, "a jump during the tilt ease (setView of another module) does not leave the map half tilted (" + pj + ")", pj);
    // a reload keeps the choice (the same browser storage)
    const r2 = await open(b, "gl", { ctx });
    await view(r2.page, LUD, 16, 1500); await settleCam(r2.page);
    const pr = await pitch(r2.page), br = await btnBox(r2.page);
    ok(Math.abs(pr - 50) < 0.6 && br.pressed === "true", "after a reload the map starts tilted (the stored choice)", { pr, pressed: br.pressed });
    ok(r2.errs.length === 0, "reload: no page error", r2.errs);
    await r2.page.close();
  }
  // from here on: tilted
  await page.evaluate(() => PNTILT.set(true)); await view(page, LUD, 16, 1500); await settleCam(page); await wait(page, 400);
  if (ONLY.test("maths")) {
    const bd = await page.evaluate(() => { const c = __map.getContainer(), W = c.clientWidth, Hh = c.clientHeight, B = __map.getBounds(), m = __gm();
      const pts = [[0, 0], [W, 0], [0, Hh], [W, Hh]].map(([x, y]) => m.unproject([x, y])); return { p: m.getPitch(), all: pts.every((l) => B.contains([l.lat, l.lng])), n: pts.filter((l) => B.contains([l.lat, l.lng])).length }; });
    ok(bd.p > 40 && bd.all, "tilted: getBounds() holds all 4 screen corners (" + bd.n + "/4; the far edge of a tilted view is wider)", bd);
    const fb = await page.evaluate(async () => { const a = [60.1440, 15.1800], c = [60.1560, 15.1960];
      __map.fitBounds([a, c], { padding: [40, 40], animate: false }); await new Promise((r) => setTimeout(r, 600));
      const W = __map.getSize(), q = [a, c].map((x) => __map.latLngToContainerPoint(x)); return { p: Math.round(__gm().getPitch()), q: q.map((x) => [Math.round(x.x), Math.round(x.y)]), W: [W.x, W.y], in: q.every((x) => x.x >= 0 && x.y >= 0 && x.x <= W.x && x.y <= W.y) }; });
    ok(fb.p > 40 && fb.in, "tilted: fitBounds keeps both corners of the box on the screen", fb);
    await view(page, LUD, 16, 1200); await settleCam(page);
    const cl = await page.evaluate(() => { const m = __gm(), z = __map.getZoom(), y = 100, a = m.unproject([150, y]), c = m.unproject([150 + 70, y]);
      const wx = (lng) => (lng + 180) / 360 * 256 * Math.pow(2, z), wy = (lat) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); };
      const flat = Math.hypot(wx(a.lng) - wx(c.lng), wy(a.lat) - wy(c.lat));
      const g = L.markerClusterGroup({ maxClusterRadius: 80 }); const ic = () => L.divIcon({ className: "", html: "<i></i>", iconSize: [4, 4] });
      g.addLayers([L.marker([a.lat, a.lng], { icon: ic() }), L.marker([c.lat, c.lng], { icon: ic() })]); __map.addLayer(g);
      const n = Object.keys(g._clusters).length, s = Object.keys(g._shown).length; __map.removeLayer(g); return { flat: Math.round(flat), screen: 70, clusters: n, single: s }; });
    ok(cl.flat > 88 && cl.clusters === 1 && cl.single === 0, "tilted: two pins 70 px apart on the screen (far, near the top) form one cluster (flat maths said " + cl.flat + " px)", cl);
  }
  if (ONLY.test("taps")) {
    await view(page, LUD, 16.3, 2000); await settleCam(page);
    const t = await page.evaluate(() => { const g = __gm(), cv = g.getCanvas().getBoundingClientRect(), vis = new Set((GLBARS._view ? GLBARS._view() : []).filter((v) => v.shown).map((v) => v.id));
      for (const p of GLBARS._feats().filter((p) => p.t === 1 && (!GLBARS._view || vis.has(p.id)))) { const mk = GLBARS._marker(p.id); if (!mk) continue; const ll = mk.getLatLng(), q = g.project([ll.lng, ll.lat]);
        const x = cv.left + q.x, y = cv.top + q.y; if (x < 60 || x > innerWidth - 80 || y < 240 || y > innerHeight - 330) continue;
        const c = mk.options && mk.options.olnuC; return { id: p.id, name: (c && c.bar && c.bar.name) || "", x: Math.round(x), y: Math.round(y) }; } return null; });
    if (t) {
      await page.touchscreen.tap(t.x, t.y);
      await page.waitForFunction(() => !!document.querySelector(".olnu-sheet .bs, .leaflet-popup .bs"), null, { timeout: 6000 }).catch(() => {});
      const s1 = await page.evaluate(() => { const e = document.querySelector(".olnu-sheet .bs, .leaflet-popup .bs"); const h = e && (e.querySelector("h2, h3, .bs-title, .pp-title") || e); return e ? h.textContent.trim().slice(0, 60) : null; });
      ok(!!s1 && (!t.name || s1.indexOf(t.name.slice(0, 8)) >= 0), "tilted: a tap on a GL bar opens THAT bar's sheet (" + s1 + ", want " + t.name + ")", { t, s1 });
      // one click router: a tap on the map that closes the sheet must not open / select anything
      await page.evaluate(() => { window.__pe2 = 0; __map.on("popupopen", () => window.__pe2++); });
      await page.touchscreen.tap(195, 330); await wait(page, 1500);
      const s2 = await page.evaluate(() => ({ open: !!document.querySelector(".olnu-sheet .bs, .leaflet-popup .bs"), opened: window.__pe2 }));
      ok(s2.opened === 0, "tilted: the tap that closes the bar sheet selects nothing (one click router)", s2);
    } else ok(false, "tilted: no GL bar in a fair spot to tap");
    await view(page, [60.1522, 15.1905], 16, 1500); await settleCam(page); await wait(page, 800);   // Robban's pin (a friend, not at a bar) near the middle
    const pp = await page.evaluate(() => { const g = __gm(), out = [];
      Object.values(MBX.main._dom).forEach((o) => { if (!o._mounted || !o._icon || !o.getLatLng) return; const ch = o._icon.getBoundingClientRect().width ? o._icon : o._icon.firstElementChild; if (!ch) return;
        const r = ch.getBoundingClientRect(); if (r.width < 20 || r.top < 150 || r.bottom > innerHeight - 260 || r.left < 10 || r.right > innerWidth - 70) return;
        const ll = o.getLatLng(), q = g.project([ll.lng, ll.lat]), cv = g.getCanvas().getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        out.push({ tap: getComputedStyle(ch).pointerEvents !== "none", cls: String(o._icon.className).slice(0, 30), d: Math.round(Math.hypot(o._icon._mx + cv.left - (cv.left + q.x), o._icon._my - q.y) * 10) / 10, onTop: !!top && o._icon.contains(top) }); });
      return out; });
    ok(pp.length > 0 && pp.every((x) => x.d <= 1.5), "tilted: every DOM pin (people, chips) sits where GL projects its point (" + pp.length + " pins)", pp.slice(0, 6));
    ok(pp.filter((x) => x.tap).length > 0 && pp.filter((x) => x.tap && x.onTop).length >= Math.ceil(pp.filter((x) => x.tap).length / 2), "tilted: the tappable pins are on top at their centre (readable, tappable; " + pp.filter((x) => x.tap).length + " pins)", pp.slice(0, 6));
  }
  if (ONLY.test("perf")) {
    const cdp = await ctx.newCDPSession(page);
    const run = async (tilt, rate) => {
      await page.evaluate((t) => { PNTILT.set(t); __gm().jumpTo({ pitch: t ? PNTILT.PITCH : 0 }); }, tilt); await view(page, LUD, 16.3, 1500); await settleCam(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const r = await page.evaluate(() => new Promise((res) => { const m = __gm(), d = []; let last = performance.now(), on = true; const p0 = MBX.stats.posMs, n0 = MBX.stats.posN;
        const f = () => { const n = performance.now(); d.push(n - last); last = n; if (on) requestAnimationFrame(f); }; requestAnimationFrame(f);
        const c = m.getCenter(); m.easeTo({ center: [c.lng + 0.004, c.lat + 0.0015], duration: 3000, easing: (t) => t });
        setTimeout(() => { on = false; m.jumpTo({ center: c }); const a = d.slice(3).sort((x, y) => x - y), q = (p) => +(a[Math.floor(a.length * p)] || 0).toFixed(1);
          res({ n: a.length, p50: q(0.5), p95: q(0.95), pinMs: +((MBX.stats.posMs - p0) / Math.max(1, MBX.stats.posN - n0)).toFixed(2) }); }, 3100); }));
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      return r;
    };
    const R = {};
    for (const rate of [1, 4]) for (const t of [false, true]) R[(t ? "tilt" : "flat") + rate + "x"] = await run(t, rate);
    console.log("PERF " + (TOKEN ? "real GL" : "stub GL") + " (software GL, swiftshader): " + JSON.stringify(R));
    ok(R.flat1x.n > 5 && R.tilt1x.n > 5 && R.tilt1x.p50 <= R.flat1x.p50 * 3 + 20, "perf: frame time measured flat vs tilted (1x p50 " + R.flat1x.p50 + " vs " + R.tilt1x.p50 + " ms; 4x " + R.flat4x.p50 + " vs " + R.tilt4x.p50 + " ms); tilted is not more than 3x", R);
    ok(R.tilt1x.pinMs < 4, "perf: the DOM pins cost " + R.tilt1x.pinMs + " ms per move frame when tilted (< 4 ms)", R.tilt1x);
    await page.evaluate(() => PNTILT.set(true)); await view(page, LUD, 16, 1200); await settleCam(page);
  }
  if (ONLY.test("shots") && TOKEN) {
    const dir = OUT + "logs/tilt-shots/"; fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(() => PNTILT.set(false)); await view(page, LUD, 16.3, 4000); await settleCam(page); await wait(page, 2500); await page.screenshot({ path: dir + "1-flat.png" });
    await page.evaluate(() => PNTILT.set(true)); await settleCam(page); await wait(page, 4000); await page.screenshot({ path: dir + "2-tilted.png" });
    await view(page, LUD, 14.6, 4000); await wait(page, 2500); await page.screenshot({ path: dir + "3-tilted-town.png" });
    ok(fs.existsSync(dir + "2-tilted.png"), "shots: flat / tilted / town saved (CI artifact logs/tilt-shots)");
  }
  ok(errs.length === 0, "GL: no page error", errs);
  await ctx.close();
}

async function runOther(b) {
  if (ONLY.test("reduced")) {
    const { ctx, page, errs } = await open(b, "gl", { tilt: "0", reduced: true });
    await view(page, LUD, 16, 2000);
    await tapTilt(page); await wait(page, 120);
    const p = await pitch(page);
    ok(Math.abs(p - 50) < 0.6, "reduced motion: the camera jumps to 50 degrees at once (no ease; " + p + " after 120 ms)", p);
    ok(errs.length === 0, "reduced: no page error", errs);
    await ctx.close();
  }
  if (ONLY.test("raster")) {
    const { ctx, page, errs } = await open(b, "fb", { tilt: "1" });
    await wait(page, 2000);
    const r = await page.evaluate(() => { let e = null; try { PNTILT.set(true); PNTILT.set(false); PNTILT.set(true); } catch (x) { e = x.message; }
      const bt = document.getElementById("pn-tilt"); return { e, gl: !!(window.MBX && MBX.main && MBX.main.isGL()), shown: !!(bt && !bt.hidden && bt.getClientRects().length), pins: document.querySelectorAll(".pill, .cm").length,
        b: (() => { try { const B = __map.getBounds(); return B.isValid(); } catch (x) { return x.message; } })() }; });
    ok(!r.gl && !r.shown && r.e === null && r.b === true && r.pins > 2, "raster fallback (no token): no '3D' button, no tilt, no error, the pins still show", r);
    ok(errs.length === 0, "raster: no page error", errs);
    await ctx.close();
  }
  if (ONLY.test("season")) {
    const { ctx, page, errs } = await open(b, "gl", { tilt: "0", query: "?date=2026-12-10T22:30&wx=clear&kp=6&light=0" });
    await view(page, LUD, 16, 2500);
    await page.waitForFunction(() => window.PNSeasonMap && PNSeasonMap.stats.feats > 0, null, { timeout: 20000 }).catch(() => {});
    const s0 = await page.evaluate(() => ({ key: PNSeason.now().key, sky: PNTILT._sky(), kp: PNSeason.now().kp }));
    await tapTilt(page); await settleCam(page); await wait(page, 800);
    await page.evaluate(() => { try { PNSkyFx._maybe(PNSeason.now()); } catch (e) {} }); await wait(page, 1500);
    const s1 = await page.evaluate(() => ({ p: Math.round(__gm().getPitch()), sky: PNSky.active() }));
    ok(s0.sky && s1.p === 62 && s1.sky.includes("aurora"), "a northern lights night: tilted = 62 degrees (the aurora needs 60+) and the aurora shows", { s0, s1 });
    const hs = await page.evaluate(() => { const c = document.querySelector(".ss-sky"), g = c && c.getContext("2d"), R = c ? c.width / c.clientWidth : 1, rs = GLBARS.rects().filter((r) => !r.lbl);
      const at = rs.map((r) => { const x = Math.round((r.l + r.r) / 2 * R), y = Math.round((r.t + r.b) / 2 * R); return x > 0 && y > 0 && x < c.width && y < c.height ? g.getImageData(x, y, 1, 1).data[3] : -1; }).filter((a) => a >= 0);
      return { n: at.length, bad: at.filter((a) => a > 0).length }; });
    ok(hs.n > 0 && hs.bad === 0, "tilted with the aurora: the sky canvas has a hole at every bar icon (" + hs.n + " bars)", hs);
    // the 3D Christmas tree in the tilted view (seasonmap.js: pitch > 25)
    // seasonsfix (24 Nov): the tree is hidden in a tilted view where its box touches a pin (bars behind it come close on
    // screen), so the old check (visible after a fixed 2.5 s, one direction) was red on some runs. Now: read after the season
    // map settled; in each direction the 3D tree shows exactly when the tree is not hidden; one of 4 directions shows it.
    const tp = await page.evaluate(() => PNSeasonMap.stats.tree);
    if (tp) await view(page, [tp[1], tp[0]], 17.5, 1500);
    const tl = [];
    for (const bearing of [0, 90, 180, 270]) {
      await page.evaluate((bearing) => __gm().jumpTo({ bearing }), bearing); await ssSettle(page);
      const t = await page.evaluate(() => { const m = __gm(), tr = PNSeasonMap.feats().filter((x) => x.k === "tree")[0];
        return { model: PNSeasonMap.stats.model, vis: m.getLayer("pn-ss-tree3d") ? m.getLayoutProperty("pn-ss-tree3d", "visibility") : "none", p: Math.round(m.getPitch()), b: Math.round(m.getBearing()), h: tr ? tr.h : -1 }; });
      tl.push(t); if (t.vis === "visible") break;
    }
    await page.evaluate(() => __gm().jumpTo({ bearing: 0 })); await ssSettle(page);
    const t3 = tl[tl.length - 1];
    ok(!!tp && t3.model && tl.every((t) => t.p > 25 && (t.vis === "visible") === (t.h === 0)) && tl.some((t) => t.vis === "visible"), "Christmas: the real 3D tree shows in the tilted view (pitch " + t3.p + "), exactly when the tree touches no pin", tl);
    // flat again: aurora off, 3D tree off
    await tapTilt(page); await settleCam(page); await wait(page, 800);
    const s2 = await page.evaluate(() => { const m = __gm(); return { p: Math.round(m.getPitch()), sky: PNSky.active(), vis: m.getLayer("pn-ss-tree3d") ? m.getLayoutProperty("pn-ss-tree3d", "visibility") : "none" }; });
    ok(s2.p === 0 && !s2.sky.includes("aurora") && s2.vis !== "visible", "flat again: no aurora, no 3D tree", s2);
    ok(errs.length === 0, "season: no page error", errs);
    await ctx.close();
  }
}
(async () => {
  console.log("tilt " + (TOKEN ? "real token" : "stub GL"));
  const b = await chromium.launch(launchOpts(["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]));
  try { await runGL(b); } catch (e) { ok(false, "exception " + e.message.split("\n")[0]); }
  try { await runOther(b); } catch (e) { ok(false, "exception " + e.message.split("\n")[0]); }
  await b.close();
  console.log("\ntilt-pw: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
