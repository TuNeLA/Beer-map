// mapfix-pw.js — lane mapfix (14 Nov 2026): the map reacts correctly to ONE finger (owner, Android phone, Mapbox GL).
//  I-108  tap, then a one-finger drag = PAN, never zoom (Mapbox GL "tap-drag-zoom" is off; pinch + double-tap zoom stay on).
//  I-110  while a bar pop-up is open, a tap on the map only closes it: not the lit house of the same bar (barlit.js /
//         map3d.js), not a map "click" listener, not the loose "nearest icon within 28 px" rule. A tap ON another bar's
//         icon still switches. A tap on the sheet backdrop does not reach the map.
//  I-109  one bar tap = one visible open: a redraw (poll / new avatar specs / plain bars) with the sheet open shows no
//         "sheet slides down + slides up" (no ghost copy, no open animation), the sheet stays the same bar.
// Paths: gl = Mapbox GL (real token from MAPBOX_TEST_TOKEN, else a STUB Mapbox like d4map-pw.js), fb = the raster engine.
// usage: node mapfix-pw.js <port> [paths: gl,fb]
// MAPFIX_OLD=<dir with old mbx.js glmap.js app-pins.js>: run the checks on the old code (they must FAIL there).
const { H, TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const PORT = process.argv[2], PATHS = (process.argv[3] || "gl,fb").split(","), OLD = process.env.MAPFIX_OLD || "";
const BASE = "http://127.0.0.1:" + PORT + "/";
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 700))); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const LUD = [60.1505, 15.1872], LOBBY = "x-lobbybaren-ludvika", LOBBY_LL = [60.15098, 15.18663], PARMA = "x-la-parma-ludvika", BLACK = "x-blackstone-ludvika";
const OLDRE = /\/js\/(mbx|glmap|app-pins)\.js$/;
const oldBody = (p) => { const f = OLD && OLDRE.test(p) ? path.join(OLD, path.basename(p)) : ""; return f && fs.existsSync(f) ? fs.readFileSync(f) : null; };

async function open(b, mode) {
  const { ctx, page } = await H.ctxFor(b, { width: 390, height: 844 }, {});
  let url = BASE;
  if (mode === "gl") {
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN || STUB_TOKEN }));
    if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
    await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
      const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
      const ob = oldBody(p); if (ob) return r.fulfill({ status: 200, contentType: "text/javascript", body: ob });
      try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
        await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
      } catch (e) { r.abort().catch(() => {}); }
    });
    url = "https://tunela.github.io/Beer-map/";
  } else if (OLD) {
    await page.route((u) => u.href.startsWith(BASE) && OLDRE.test(u.pathname), (r) => { const ob = oldBody(new URL(r.request().url()).pathname); return ob ? r.fulfill({ status: 200, contentType: "text/javascript", body: ob }) : r.fallback(); });
  }
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(async (e) => { console.log("goto retry: " + e.message.split("\n")[0]); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); });
  if (mode === "gl") await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  else await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => console.log("no pills"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => {
    const M = window.__mf = { ev: [], clicks: 0 };
    const key = (e) => (e.popup && e.popup._source && e.popup._source.options && e.popup._source.options.olnuKey) || "?";
    __map.on("popupopen", (e) => M.ev.push("open:" + key(e))); __map.on("popupclose", (e) => M.ev.push("close:" + key(e)));
    M.gl = () => (window.GLBARS && GLBARS.on() ? BASEMAP.mapbox().getMapboxMap() : null);
    // every bar icon on screen (page px)
    M.bars = () => { const r = __map.getContainer().getBoundingClientRect();
      if (M.gl()) return (GLBARS._view() || []).filter((x) => x.shown).map((x) => ({ id: x.id, x: x.x + r.left, y: x.y + r.top, full: x.full, icoW: x.icoW }));
      return [...document.querySelectorAll(".leaflet-marker-icon[data-bar]")].map((e) => { const i = (e.querySelector(".bar-ico") || e).getBoundingClientRect();
        return { id: e.getAttribute("data-bar"), x: i.left + i.width / 2, y: i.top + i.height / 2, icoW: i.width, full: e.classList.contains("cm-full") }; }).filter((x) => x.icoW > 0 && x.x > 0 && x.x < innerWidth && x.y > 0 && x.y < innerHeight); };
    // is (x, y) plain map under the finger (no HUD, no marker, no pop-up)? house = a lit-house outline is fine too
    M.free = (x, y, house) => { const e = document.elementFromPoint(x, y); if (!e || !e.closest) return false;
      if (e.closest(".leaflet-popup, .leaflet-marker-icon, button, a, .dock, .hud, #backdrop, #sheet")) return false;
      if (e.closest(".mbx-svg")) return !!house;
      return e.classList.contains("mapboxgl-canvas") || e.classList.contains("leaflet-tile") || e.classList.contains("mbx-raster") || e === __map.getContainer() || e.classList.contains("leaflet-map-pane"); };
    // something else that takes a tap near (x, y): a GL symbol of ours (restaurant dot, cluster), a DOM marker
    M.drawn = (x, y) => { const r = __map.getContainer().getBoundingClientRect(), g = M.gl(), B = 26;
      if (g) { try { if (g.queryRenderedFeatures([[x - r.left - B, y - r.top - B], [x - r.left + B, y - r.top + B]]).some((f) => /^olnu/.test(f.layer.id) || /^olnu/.test(String(f.source)))) return true; } catch (e) {} }
      return [...document.querySelectorAll(".leaflet-marker-icon")].some((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && x > q.left - B && x < q.right + B && y > q.top - B && y < q.bottom + B; }); };
    M.polys = () => { const r = __map.getContainer().getBoundingClientRect(), out = [];
      for (const k in __map._layers) { const l = __map._layers[k]; if (!(l._blIds || l._blId) || !l.getLatLngs) continue;
        let ring = l.getLatLngs(); while (ring.length && Array.isArray(ring[0]) && typeof ring[0][0] !== "number") ring = ring[0];
        ring = ring.filter((q) => q && (Array.isArray(q) || q.lat != null)); if (ring.length < 3) continue;
        out.push({ ids: l._blIds || [l._blId], pts: ring.map((q) => { const p = __map.latLngToContainerPoint(q); return [p.x + r.left, p.y + r.top]; }) }); }
      return out; };
    M.inside = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    // a point inside the lit house of bar id, more than 40 px from every bar icon (so only the house can take the tap)
    M.house = (id, top, bottom) => { const po = M.polys().filter((p) => p.ids.indexOf(id) >= 0)[0]; if (!po) return null;
      const bars = M.bars(), inn = (x, y) => M.inside(po.pts, x, y); let best = null;
      for (let y = top; y <= bottom; y += 3) for (let x = 8; x < innerWidth - 8; x += 3) {
        if (!inn(x, y) || !inn(x - 5, y) || !inn(x + 5, y) || !inn(x, y - 5) || !inn(x, y + 5) || !M.free(x, y, true)) continue;
        const d = Math.min.apply(null, bars.map((b) => Math.hypot(b.x - x, b.y - y)).concat(999));
        if (d > 40 && (!best || d > best.d)) best = { x, y, d: Math.round(d) }; }
      return best; };
    // a point of empty map: no bar icon within `far` px, no lit house
    M.empty = (top, bottom, far) => { const bars = M.bars(), po = M.polys(); let best = null;
      for (let y = top; y <= bottom; y += 4) for (let x = 12; x < innerWidth - 12; x += 4) {
        if (!M.free(x, y) || po.some((p) => M.inside(p.pts, x, y)) || M.drawn(x, y)) continue;
        const d = Math.min.apply(null, bars.map((b) => Math.hypot(b.x - x, b.y - y)).concat(999));
        if (d > (far || 60) && (!best || d > best.d)) best = { x, y, d: Math.round(d) }; }
      return best; };
    M.state = () => { const s = document.querySelector(".leaflet-popup.olnu-sheet"), p = document.querySelector(".leaflet-popup .bs");
      return { open: !!p, title: ((document.querySelector(".leaflet-popup .pp-title") || {}).textContent || "").trim(), top: s ? Math.round(s.getBoundingClientRect().top) : null,
        ev: M.ev.splice(0), z: +__map.getZoom().toFixed(3), clicks: M.clicks }; };
    // I-109: what the eye sees of the sheet: "slides down" copies, open animations, the sheet missing in a frame
    M.watch = () => { const w = M.w = { ghosts: 0, anims: [], gone: 0, frames: 0 };
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.classList.contains("pn-bs-ghost") && getComputedStyle(n).display !== "none") w.ghosts++; }))).observe(document.body, { childList: true });
      document.addEventListener("animationstart", (e) => { const t = e.target; if (t && t.classList && (t.classList.contains("leaflet-popup") || t.classList.contains("leaflet-popup-content-wrapper"))) w.anims.push(e.animationName); }, true);
      const f = () => { w.frames++; if (w.on && !document.querySelector(".leaflet-popup .bs")) w.gone++; requestAnimationFrame(f); }; f(); };
    M.watch();
  });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, errs, cdp };
}
const T = (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
async function tap(page, cdp, x, y) { await T(cdp, "touchStart", [{ x, y }]); await wait(page, 30); await T(cdp, "touchEnd", []); }
async function drag(page, cdp, x0, y0, x1, y1, steps) {
  await T(cdp, "touchStart", [{ x: x0, y: y0 }]);
  for (let i = 1; i <= steps; i++) { await T(cdp, "touchMove", [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }]); await wait(page, 16); }
  await T(cdp, "touchEnd", []);
}
async function view(page, ll, z, ms) { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await wait(page, ms || 2500); await page.evaluate(() => __mf.ev.splice(0)); }
const st = (page) => page.evaluate(() => __mf.state());
const barAt = (page, id) => page.evaluate((id) => __mf.bars().filter((b) => b.id === id)[0] || null, id);
// open a bar with a finger tap on its icon; wait for its sheet and for the sheet's "keep the bar visible" pan
async function tapBar(page, cdp, id) {
  const b = await barAt(page, id); if (!b) return null;
  await tap(page, cdp, b.x, b.y);
  await page.waitForFunction(() => !!document.querySelector(".leaflet-popup .bs"), null, { timeout: 8000 }).catch(() => {});
  await wait(page, 1500);
  return b;
}
async function codeOpen(page, id) { await page.evaluate((id) => { if (!document.querySelector(".leaflet-popup .bs")) BARLIT.open(id); }, id); await wait(page, 1300); await page.evaluate(() => __mf.ev.splice(0)); }
// screen shift of a map centre (px) between two states
const centre = (page) => page.evaluate(() => { const c = __map.getCenter(); return { lat: c.lat, lng: c.lng, z: __map.getZoom() }; });
const shiftPx = (page, c0) => page.evaluate((c0) => { const p = __map.latLngToContainerPoint([c0.lat, c0.lng]), s = __map.getSize(); return { dx: Math.round(p.x - s.x / 2), dy: Math.round(p.y - s.y / 2) }; }, c0);

async function run(b, mode) {
  const W = mode + ": ";
  const { ctx, page, errs, cdp } = await open(b, mode);
  const isGl = await page.evaluate(() => !!__mf.gl());
  if (mode === "gl" && !isGl) { ok(false, W + "the GL path did not start"); await ctx.close(); return; }

  /* ---------- I-108: tap, then a one-finger drag = pan ---------- */
  await view(page, LUD, 16, 3000);
  if (isGl) {
    const h = await page.evaluate(() => { const g = __mf.gl(), t = g.touchZoomRotate; const a = { api: typeof t.disableTapDragZoom, tdz: t.isTapDragZoomEnabled ? t.isTapDragZoomEnabled() : null,
      inner: !!(t._tapDragZoom && t._tapDragZoom.isEnabled && t._tapDragZoom.isEnabled()), pinch: t.isEnabled(), dbl: g.doubleClickZoom.isEnabled(), pan: g.dragPan.isEnabled(), ver: mapboxgl.version };
      __map.touchZoom.disable(); __map.touchZoom.enable(); a.tdz2 = t.isTapDragZoomEnabled ? t.isTapDragZoomEnabled() : null; a.inner2 = !!(t._tapDragZoom && t._tapDragZoom.isEnabled()); a.pinch2 = t.isEnabled(); return a; });
    ok(h.tdz === false && !h.inner, W + "I-108 the tap-drag-zoom gesture is off on the GL map (GL JS " + h.ver + ", public switch: " + h.api + ")", h);
    ok(h.tdz2 === false && !h.inner2 && h.pinch2, W + "I-108 it stays off after touchZoom.disable() / enable() (pinch back on)", h);
    ok(h.pinch && h.dbl && h.pan, W + "I-108 pinch zoom, double-tap zoom and one-finger pan stay on", h);
  }
  {
    const e = await page.evaluate(() => __mf.empty(260, 480, 70)); let c0 = await centre(page);
    if (!e) ok(false, W + "I-108 setup: an empty spot on the map");
    else {
      await tap(page, cdp, e.x, e.y); await wait(page, 90);
      await drag(page, cdp, e.x, e.y, e.x, e.y + 130, 10); await wait(page, 900);
      const c1 = await centre(page), s = await shiftPx(page, c0), s1 = await st(page);
      ok(Math.abs(c1.z - c0.z) < 0.02, W + "I-108 a tap, then a one-finger drag does not zoom (zoom " + c0.z + " -> " + c1.z + ")", { c0, c1 });
      ok(s.dy > 60 && !s1.open, W + "I-108 that drag pans the map (" + s.dy + " px down) and opens nothing", { s, s1 });
    }
    // the owner's steps: tap a bar, tap away (the sheet closes), one finger moves
    await view(page, LUD, 16, 2000);
    const tb = await tapBar(page, cdp, PARMA), s0 = await st(page);
    const e2 = await page.evaluate((top) => __mf.empty(150, (top || 220) - 10, 45), s0.top);
    if (!tb || !s0.open || !e2) ok(false, W + "I-108 setup: a bar sheet open and an empty spot above it", { tb, s0, e2 });
    else {
      c0 = await centre(page);
      await tap(page, cdp, e2.x, e2.y); await wait(page, 90);
      await drag(page, cdp, 200, 300, 200, 430, 10); await wait(page, 900);
      const c1 = await centre(page), s = await shiftPx(page, c0), s1 = await st(page);
      ok(!s1.open && Math.abs(c1.z - c0.z) < 0.02 && s.dy > 60, W + "I-108 tap a bar, tap away, one finger moves: the sheet is closed, the map pans, no zoom (zoom " + c0.z + " -> " + c1.z + ", " + s.dy + " px)", { s, s1 });
    }
    if (isGl) {   // guards: the other zoom gestures still work
      await view(page, LUD, 16, 1500);
      const z0 = (await centre(page)).z;
      await T(cdp, "touchStart", [{ x: 160, y: 420, id: 1 }, { x: 230, y: 420, id: 2 }]);
      for (let i = 1; i <= 10; i++) { await T(cdp, "touchMove", [{ x: 160 - i * 7, y: 420, id: 1 }, { x: 230 + i * 7, y: 420, id: 2 }]); await wait(page, 16); }
      await T(cdp, "touchEnd", []); await wait(page, 900);
      const z1 = (await centre(page)).z;
      ok(z1 > z0 + 0.3, W + "I-108 guard: a two-finger pinch still zooms (zoom " + z0 + " -> " + z1.toFixed(2) + ")");
      await view(page, LUD, 16, 1500);
      const e3 = await page.evaluate(() => __mf.empty(260, 480, 70));
      if (e3) { await tap(page, cdp, e3.x, e3.y); await wait(page, 70); await tap(page, cdp, e3.x, e3.y); await wait(page, 1300); }
      const z2 = (await centre(page)).z;
      ok(!!e3 && z2 > 16.4, W + "I-108 guard: a double tap still zooms in (zoom 16 -> " + z2.toFixed(2) + ")");
    }
  }

  /* ---------- I-110: a tap outside the pop-up only closes it ---------- */
  // a) the lit house of the open bar (the owner's bar: the hotel lobby bar), zoomed in so the house is bigger than the icon
  await view(page, LOBBY_LL, 19, 3000);
  {
    const tb = await tapBar(page, cdp, LOBBY), s0 = await st(page);
    const hp = await page.evaluate(([id, top]) => __mf.house(id, 60, (top || 220) - 8), [LOBBY, s0.top]);
    ok(!!tb && s0.open && /Lobbybaren/.test(s0.title) && s0.ev.filter((x) => /^open/.test(x)).length >= 1, W + "I-110 setup: a finger tap opens the lobby bar sheet", { tb, s0 });
    if (!hp) console.log("note " + W + "no free point inside the lobby bar's lit house (above the sheet): house check skipped");
    else {
      await tap(page, cdp, hp.x, hp.y); await wait(page, 1800);
      const s1 = await st(page);
      ok(!s1.open && s1.ev.join() === "close:" + s0.ev.filter((x) => /^open/.test(x)).pop().slice(5), W + "I-110 a tap on the open bar's own house (" + hp.d + " px from its icon) closes the sheet and opens nothing", s1);
    }
    // b) any map "click" consumer (map3d.js opens a bar from its 3D house): it must not get the tap that closed the sheet
    await codeOpen(page, LOBBY);
    await page.evaluate((id) => { __mf.click = () => { __mf.clicks++; BARLIT.open(id); }; __map.on("click", __mf.click); }, LOBBY);
    const s2 = await st(page), e = await page.evaluate((top) => __mf.empty(60, (top || 220) - 8, 45), s2.top);
    if (!s2.open || !e) ok(false, W + "I-110 setup: the sheet open again and an empty spot above it", { s2, e });
    else {
      await tap(page, cdp, e.x, e.y); await wait(page, 1800);
      const s3 = await st(page);
      ok(!s3.open && s3.clicks === 0 && s3.ev.join() === "close:" + (s3.ev[0] || "").slice(6), W + "I-110 a tap on the empty map closes the sheet; no map click listener can open it again", s3);
      await tap(page, cdp, e.x, e.y); await wait(page, 900);
      const s4 = await st(page);
      ok(s4.clicks === 1, W + "I-110 guard: with no pop-up open the same tap is a normal map click", s4);
    }
    await page.evaluate(() => { __map.off("click", __mf.click); __mf.clicks = 0; __map.closePopup(); });
  }
  // c) the loose "nearest icon within 28 px" rule (GL bars): near another bar = close only; ON another bar = switch
  if (isGl) {
    await view(page, LOBBY_LL, 16, 2500);
    await codeOpen(page, LOBBY);
    // move the map so the next bar (La Parma) sits in the free strip between the HUD and the sheet
    const lower = async () => { await page.evaluate((id) => { const b = __mf.bars().filter((x) => x.id === id)[0], s = document.querySelector(".leaflet-popup.olnu-sheet");
      if (b && s) __map.panBy([0, -Math.round(s.getBoundingClientRect().top - 32 - b.y)], { animate: false, olnuSheet: true }); }, PARMA); await wait(page, 1200); await page.evaluate(() => __mf.ev.splice(0)); };
    await lower();
    const s0 = await st(page);
    const pick = await page.evaluate(([A, top]) => { const bars = __mf.bars(), out = [];
      bars.filter((b) => b.id !== A && b.y > 60 && b.y < (top || 220) - 6).forEach((b) => {
        const d = b.icoW / 2 + 6 + 3; if (d > 27) return;   // off its disc (+ 6 px), inside the 28 px "near" rule
        [[1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0, 1], [0.7, -0.7], [-0.7, -0.7]].forEach((v) => { const x = b.x + v[0] * d, y = b.y + v[1] * d;
          if (y > (top || 220) - 6 || !__mf.free(x, y)) return;
          if (bars.some((o) => o.id !== b.id && Math.hypot(o.x - x, o.y - y) < o.icoW / 2 + 40)) return;
          out.push({ id: b.id, x, y, bx: b.x, by: b.y, onFree: __mf.free(b.x, b.y), d }); }); });
      return out.sort((a, b) => (b.onFree ? 1 : 0) - (a.onFree ? 1 : 0))[0] || null; }, [LOBBY, s0.top]);
    if (!s0.open || !pick) ok(false, W + "I-110 setup: another bar above the sheet with a free spot near it", { s0, pick });
    else {
      await tap(page, cdp, pick.x, pick.y); await wait(page, 1800);
      const s1 = await st(page), how = await page.evaluate(() => GLBARS.stats.tapHow);
      ok(!s1.open && s1.ev.filter((x) => /^open/.test(x)).length === 0, W + "I-110 a tap NEAR another bar (" + pick.d + " px from its centre, off its icon) only closes the sheet (rule: " + how + ")", s1);
      await codeOpen(page, LOBBY); await lower();
      const b2 = await barAt(page, pick.id), s2 = await st(page);
      if (!s2.open || !b2 || !(await page.evaluate((b) => __mf.free(b.x, b.y), b2))) console.log("note " + W + "the other bar's icon is not free to tap: switch guard skipped " + JSON.stringify({ open: s2.open, b2, pick }));
      else {
        await tap(page, cdp, b2.x, b2.y); await wait(page, 2000);
        const s3 = await st(page);
        ok(s3.open && !/Lobbybaren/.test(s3.title) && s3.ev.filter((x) => /^open/.test(x)).length === 1, W + "I-110 guard: a tap ON another bar's icon switches to that bar (one open)", s3);
      }
    }
    // d) the open bar's own icon: closes, stays closed
    await page.evaluate(() => __map.closePopup()); await wait(page, 500);
    await codeOpen(page, LOBBY);
    const me = await barAt(page, LOBBY);
    if (me && await page.evaluate((b) => __mf.free(b.x, b.y), me)) {
      await tap(page, cdp, me.x, me.y); await wait(page, 1800);
      const s5 = await st(page);
      ok(!s5.open && s5.ev.filter((x) => /^open/.test(x)).length === 0, W + "I-110 a tap on the open bar's own icon closes the sheet (no reopen)", s5);
    } else console.log("note " + W + "the open bar's icon is not free to tap: own-icon check skipped");
  }
  // e) the app sheet backdrop: the tap closes the sheet, the map under it gets nothing
  {
    await view(page, LUD, 16, 1500);
    await page.evaluate(() => { __mf.clicks = 0; __mf.click = () => { __mf.clicks++; }; __map.on("click", __mf.click); document.getElementById("btn-settings").click(); });
    await wait(page, 1200);
    const bd = await page.evaluate(() => { const s = document.getElementById("sheet"), b = document.getElementById("backdrop"); if (!s || s.hidden || !b || b.hidden) return null;
      const top = s.getBoundingClientRect().top; for (let y = 30; y < top - 10; y += 8) { const e = document.elementFromPoint(195, y); if (e === b) return { x: 195, y }; } return { none: Math.round(top) }; });
    if (!bd) ok(false, W + "I-110 setup: the settings sheet with its backdrop");
    else if (bd.none != null) console.log("note " + W + "the settings sheet covers the whole screen (top " + bd.none + "): backdrop check skipped");
    else {
      await tap(page, cdp, bd.x, bd.y); await wait(page, 1200);
      const r = await page.evaluate(() => ({ sheet: !document.getElementById("sheet").hidden, pop: !!document.querySelector(".leaflet-popup"), clicks: __mf.clicks }));
      ok(!r.sheet && !r.pop && r.clicks === 0, W + "I-110 a tap on the sheet backdrop closes the sheet and does not reach the map", r);
    }
    await page.evaluate(() => { __map.off("click", __mf.click); if (!document.getElementById("sheet").hidden) document.getElementById("sheet-close").click(); });
  }

  /* ---------- I-109: one bar tap = one visible open ---------- */
  for (const [id, re, kind] of [[PARMA, /Parma/, "a bar with people"], [BLACK, /Blackstone/, "a quiet bar"]]) {
    await view(page, LUD, 16, 2500);
    await page.evaluate(() => { const w = __mf.w; w.ghosts = 0; w.anims = []; w.gone = 0; w.on = false; });
    const tb = await tapBar(page, cdp, id);
    const s0 = await st(page);
    if (!tb || !s0.open || !re.test(s0.title)) { ok(false, W + "I-109 setup: a finger tap opens " + kind, { tb, s0 }); continue; }
    // the redraws that come by themselves after a tap: the poll (render), new avatar specs (render), the plain bars
    const r = await page.evaluate(async () => { const w = __mf.w, A = TIERS._app, sl = (ms) => new Promise((res) => setTimeout(res, ms));
      const sc = document.querySelector(".leaflet-popup .leaflet-popup-content"); if (sc) sc.scrollTop = 30; const sc0 = sc ? sc.scrollTop : 0;
      await sl(250); w.ghosts = 0;   // (the scroll event has stored the position; the tap's own open is over)
      w.on = true; const out = { live: [] };
      for (const f of [() => A.render(), () => A.plain(true), () => A.render()]) { f();
        const wr = document.querySelector(".leaflet-popup .leaflet-popup-content-wrapper");
        out.live.push(wr && wr.getAnimations ? wr.getAnimations().filter((a) => a.playState !== "finished").length : -1); await sl(450); }
      w.on = false; const sc1 = document.querySelector(".leaflet-popup .leaflet-popup-content");
      out.ghosts = w.ghosts; out.anims = w.anims.slice(); out.gone = w.gone; out.frames = w.frames; out.sc = [sc0, sc1 ? sc1.scrollTop : -1];
      out.sheetClass = !!document.querySelector(".leaflet-popup.olnu-sheet") && document.body.classList.contains("barsheet-open"); return out; });
    const s1 = await st(page), ins = r.anims.filter((a) => /SheetIn|^up$/i.test(a));
    ok(ins.length === 1, W + "I-109 " + kind + ": the sheet plays its open animation once for one tap, not again at a redraw (" + ins.length + ")", r);
    ok(r.ghosts === 0 && r.live.every((n) => n === 0), W + "I-109 " + kind + ": a redraw shows no 'sheet slides down' copy and no running sheet animation", r);
    ok(s1.open && re.test(s1.title) && r.sheetClass && r.gone === 0 && Math.abs(r.sc[1] - r.sc[0]) <= 2, W + "I-109 " + kind + ": after 3 redraws the same bar's sheet is still open, same scroll, never missing in a frame", { s1, r });
    await page.evaluate(() => __map.closePopup()); await wait(page, 600);
    const s2 = await st(page);
    await tapBar(page, cdp, id);
    const r2 = await page.evaluate(() => ({ cls: !!document.querySelector(".leaflet-popup[data-pn-reopen]"), open: !!document.querySelector(".leaflet-popup .bs") }));
    ok(!s2.open && r2.open && !r2.cls, W + "I-109 guard " + kind + ": close + a new tap opens it again the normal way (with its animation)", { s2, r2 });
    await page.evaluate(() => __map.closePopup()); await wait(page, 400);
  }
  ok(errs.length === 0, W + "no page errors", errs.slice(0, 3));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch(launchOpts([]));
  console.log("mapfix paths=" + PATHS.join(",") + " gl=" + (TOKEN ? "real token" : "stub") + (OLD ? " OLD CODE from " + OLD : ""));
  try { for (const mode of PATHS) await run(b, mode); }
  catch (e) { ok(false, "crash: " + (e && e.stack || e)); }
  await b.close();
  console.log("mapfix: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
