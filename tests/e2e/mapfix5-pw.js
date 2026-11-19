// mapfix5-pw.js — lane mapfix5 (19 Nov 2026). Each section FAILS on the old code (big-update c3f1af4) and PASSES on the new code.
//   b11   B11 (bugsnet note 1+2): a rough fix (accuracy > 100 m) is never drawn as an exact dot (fastpos.js rule): not from a
//         fresh fix, not from an old saved fix with no accuracy. olnu.lastFix keeps the accuracy. Logout and account deletion
//         remove olnu.cam + olnu.lastFix, and the reload after them does not save the camera again.
//   b9    B9 (blind test §4): GL taps. A restaurant dot, a bar disc and the faces / count pill beside it have a 44 x 44 px hit
//         area (the look is the same size). One click router: with a bar sheet open, a tap on the empty map only closes it.
//   d4    D4 (product audit A3 #4): a real empty state when nobody is out in view.
// Mocked Supabase (d2-helpers), 390 x 844. b9 needs GL: real Mapbox with MAPBOX_TEST_TOKEN, else a STUB Mapbox (fake token,
// blank style) with the real GL bar layers. Usage: node mapfix5-pw.js <port> [sections regex]
const H = require("./d2-helpers.js");
const { ctxFor, boot, wait } = H;
const { TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8793, ONLY = new RegExp(process.argv[3] || ".");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 600)); };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const sect = async (k, fn) => { if (!ONLY.test(k)) return; try { await fn(); } catch (e) { fail++; console.log("FAIL " + k + " stopped by an exception:", String(e.message).split("\n")[0].slice(0, 300)); } };
const LUD = [60.1511, 15.1876];
const now = Date.now();

// what is drawn for me: DOM dots (the raster map draws it; GL hides it but the old code still made it), the accuracy circle,
// the GL marker position (GLBARS._me().ll) and the saved last fix
const meState = (page) => page.evaluate(() => {
  let lf = null; try { lf = JSON.parse(localStorage.getItem("olnu.lastFix") || "null"); } catch (e) {}
  let gl = null; try { gl = window.GLBARS && GLBARS.on && GLBARS.on() && GLBARS._me ? (GLBARS._me() || {}).ll || null : null; } catch (e) {}
  return { dot: document.querySelectorAll(".me-dot").length, acc: document.querySelectorAll(".me-acc").length, gl, lf, loc: window.PN && PN.s ? PN.s.lastLoc : null };
});

async function b11(browser) {
  // a) a fresh ROUGH fix (a network fix, 650 m): the circle only, no dot; the saved fix keeps its accuracy
  let { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await ctx.setGeolocation({ latitude: LUD[0], longitude: LUD[1], accuracy: 650 });
  await boot(page);
  await page.evaluate(() => PN.locate({ quiet: true, keepZoom: true })); await wait(page, 1500);
  let s = await meState(page);
  ok("b11 rough fix (650 m): no exact dot (DOM or GL; old: a .me-dot)", s.dot === 0 && !s.gl, s);
  ok("b11 rough fix: olnu.lastFix keeps the accuracy (acc 650; old: no acc field)", !!s.lf && s.lf.acc === 650, s.lf);
  await ctx.close();
  // an exact GPS fix (20 m): the dot shows (a new phone: the browser would give the cached rough fix again within maximumAge)
  ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }));
  await ctx.setGeolocation({ latitude: LUD[0], longitude: LUD[1], accuracy: 20 });
  await boot(page);
  await page.evaluate(() => PN.locate({ quiet: true, keepZoom: true })); await wait(page, 1500);
  s = await meState(page);
  ok("b11 guard: an exact fix (20 m) draws the dot and saves acc 20", s.dot === 1 && !!s.lf && s.lf.acc === 20, s);
  await ctx.close();

  // b) no location permission + a saved fix from before this fix (no accuracy) / a saved rough fix: the view moves there, no dot
  for (const [name, fix] of [["an old saved fix with no accuracy", { lat: 60.1525, lng: 15.1890, at: now - 600e3 }], ["a saved rough fix (900 m)", { lat: 60.1525, lng: 15.1890, acc: 900, at: now - 600e3 }]]) {
    ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }));
    await ctx.clearPermissions();
    await ctx.addInitScript((f) => { if (sessionStorage.getItem("m5b")) return; sessionStorage.setItem("m5b", "1"); localStorage.setItem("olnu.lastFix", JSON.stringify(f)); localStorage.setItem("olnu.locOk", "1"); }, fix);
    await boot(page);
    await page.evaluate(() => PN.locate({ quiet: true })); await wait(page, 1500);
    s = await meState(page);
    ok("b11 " + name + ": the map may move there, but NO exact dot (old: .me-dot from lastKnown with accuracy 0)", s.dot === 0 && !s.gl, s);
    await ctx.close();
  }
  // c) a saved EXACT fix (30 m), no permission: the dot shows at once (c2speed I-45 kept)
  ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }));
  await ctx.clearPermissions();
  await ctx.addInitScript((f) => { if (sessionStorage.getItem("m5b")) return; sessionStorage.setItem("m5b", "1"); localStorage.setItem("olnu.lastFix", JSON.stringify(f)); }, { lat: 60.1525, lng: 15.1890, acc: 30, at: now - 600e3 });
  await boot(page);
  await page.evaluate(() => PN.locate({ quiet: true })); await wait(page, 1200);
  s = await meState(page);
  ok("b11 guard: a saved exact fix (30 m) still shows the dot at once (c2speed I-45)", s.dot === 1, s);
  await ctx.close();

  // d) logout and account deletion: olnu.cam + olnu.lastFix are gone when the next page starts (read before any app code runs)
  for (const part of ["logout", "delete"]) {
    ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }));
    // the mark is window.name (it survives the reload; the deletion clears sessionStorage)
    await ctx.addInitScript(() => { if (window.name === "m5d") { window.__atLoad = { cam: localStorage.getItem("olnu.cam"), fix: localStorage.getItem("olnu.lastFix") }; } window.name = "m5d"; });
    await page.route(/rest\/v1\/rpc\/delete_my_data(_v2)?\b/, (r) => J(r, { ok: true }));
    await page.route(/rest\/v1\/rpc\/request_account_deletion/, (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function" }) }));
    await boot(page);
    await page.evaluate(() => { __map.setView([57.7089, 11.9746], 14, { animate: false }); localStorage.setItem("olnu.lastFix", JSON.stringify({ lat: 57.7089, lng: 11.9746, acc: 15, at: Date.now() })); });
    await wait(page, 1600);   // the camera is saved 1 s after the move
    const before = await page.evaluate(() => ({ cam: !!localStorage.getItem("olnu.cam"), fix: !!localStorage.getItem("olnu.lastFix") }));
    if (part === "logout") {
      await page.evaluate(() => window.ACCOUNT.logout());
      await page.waitForSelector("#sheet-body .acct-logout-go", { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .acct-logout-go"); if (b) b.click(); });
    } else {
      await page.evaluate(() => window.PRIVACY.showDelete());
      await page.waitForSelector("#sheet-body .mm-del-now, #sheet-body .confirm, #sheet-body .btn-danger", { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .mm-del-now"); if (b) b.click(); });
      await page.waitForFunction(() => { const b = document.querySelector("#sheet-body .btn-danger"); return b && !b.classList.contains("mm-del-go"); }, null, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .btn-danger"); if (b) b.click(); });
      await page.waitForSelector("#sheet-body .confirm .btn-danger", { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .confirm .btn-danger"); if (b) b.click(); });
    }
    // window.__atLoad exists only on the page after the reload (read by an init script before any app code runs)
    let at = null;
    for (let k = 0; k < 30 && !at; k++) { try { at = await page.evaluate(() => window.__atLoad || null); } catch (e) {} if (!at) await wait(page, 1000).catch(() => {}); }
    ok("b11 " + part + ": olnu.cam and olnu.lastFix are gone when the next page starts (old: still there / saved again on pagehide)",
      before.cam && before.fix && !!at && at.cam === null && at.fix === null, { before, at });
    await ctx.close();
  }
}

/* ---------- b9: GL hit areas ---------- */
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
async function openGl(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, o.vp || { width: 390, height: 844 }, o.h || {});
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN || STUB_TOKEN }));
  if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
      await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
    } catch (e) { r.abort().catch(() => {}); }
  });
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message); });
  const url = "https://tunela.github.io/Beer-map/";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(async () => { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); });
  await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => { window.__gm = () => BASEMAP.mapbox().getMapboxMap(); });
  await wait(page, 4200);   // calm.js quiet window
  return { ctx, page, errs };
}
async function glIdle(page, ms) {
  await page.waitForFunction(() => { const g = __gm(); return g.loaded() && !g.isMoving(); }, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  if (ms) await wait(page, ms);
}
// what may take a tap at (x, y) (page px) besides GL: a DOM element over the canvas (people pins, chips, HUD)
const freeAt = (page, x, y) => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && e.tagName === "CANVAS"; }, [x, y]);
// everything GL draws for the bars near (x, y): discs (radius + 6 = the exact rule) and parts (± 2 px = the exact rule)
const exactNear = (page, x, y) => page.evaluate(([x, y]) => {
  const cv = __gm().getCanvas().getBoundingClientRect(), px = x - cv.left, py = y - cv.top, out = [];
  (GLBARS._view() || []).filter((v) => v.shown).forEach((v) => {
    const im = GLBARS._img(v.id), ico = im && im.parts.find((q) => q.sel === ".bar-ico"); if (!im || !ico) return;
    const k = v.icoW / (ico.bb[2] - ico.bb[0]), d = Math.hypot(px - v.x, py - v.y);
    if (d <= v.icoW / 2 + 6) out.push(v.id + ":disc");
    if (v.full) im.parts.forEach((q) => { if (q.sel === ".bar-ico") return; const b = [v.x + q.bb[0] * k, v.y + q.bb[1] * k, v.x + q.bb[2] * k, v.y + q.bb[3] * k];
      if (px >= b[0] - 2 * k - 1 && px <= b[2] + 2 * k + 1 && py >= b[1] - 2 * k - 1 && py <= b[3] + 2 * k + 1) out.push(v.id + q.sel); });
  });
  return out;
}, [x, y]);
async function tapGl(page, x, y) {
  await page.evaluate(() => { GLBARS.stats.lastTap = ""; GLBARS.stats.tapHow = ""; window.__pe = 0; if (!window.__peOn) { window.__peOn = 1; __map.on("popupopen", () => window.__pe++); } });
  await page.touchscreen.tap(x, y); await wait(page, 1300);
  return page.evaluate(() => ({ tap: GLBARS.stats.lastTap, how: GLBARS.stats.tapHow, opened: window.__pe, sheet: !!document.querySelector(".leaflet-popup .bs, .olnu-sheet .bs") }));
}
// with a sheet open: move the map so the spot (x, y) sits 60 px above the sheet top (map moves keep the sheet: olnuSheet)
async function aboveSheet(page, x, y) {
  const top = await page.evaluate(() => { const s = document.querySelector(".leaflet-popup.olnu-sheet, .olnu-sheet"); return Math.min(s ? s.getBoundingClientRect().top : innerHeight, innerHeight); });
  const dy = Math.round(y - (top - 60));
  if (dy > 0) { await page.evaluate((dy) => __map.panBy([0, dy], { animate: false, olnuSheet: true }), dy); await glIdle(page, 900); }
  return { x, y: dy > 0 ? y - dy : y, dy };
}
const closeAll = (page) => page.evaluate(() => { try { __map.closePopup(); } catch (e) {} });

async function b9(browser) {
  const { ctx, page, errs } = await openGl(browser);
  const on = await page.evaluate(() => !!(window.GLBARS && GLBARS.on() && window.PN && PN.glhit));
  ok("b9 setup: the GL map is on and js/glhit.js is loaded", on);
  // a) GUARD (no code change): a restaurant dot at the smallest zoom (Leaflet 14.2). glmap.js takes any dot whose image touches
  //    a 28 px box around the finger; the image box is r >= 11 px, so a tap 20 px from the centre opens it (a 44+ px area).
  let pick = null; const dbg = [];
  for (const [ll, z] of [[[60.1497, 15.1876], 14.2], [[60.1510, 15.1840], 14.2], [[60.1488, 15.1905], 14.3]]) {
    await page.evaluate(([ll, z]) => __map.setView(ll, z, { animate: false }), [ll, z]); await glIdle(page, 1200);
    const cands = await page.evaluate(() => {
      const g = __gm(), cv = g.getCanvas().getBoundingClientRect(), all = g.getLayer("olnu-place") ? g.queryRenderedFeatures({ layers: ["olnu-place"] }) : [];
      const pts = all.map((f) => { const q = g.project(f.geometry.coordinates); return { id: String(f.properties.id), x: cv.left + q.x, y: cv.top + q.y }; });
      return pts.filter((p) => p.y > 230 && p.y < innerHeight - 260 && p.x > 40 && p.x < innerWidth - 70 && !pts.some((o) => o.id !== p.id && Math.hypot(o.x - p.x, o.y - p.y) < 50));
    });
    dbg.push(z + ": " + cands.length + " dots");
    for (const c of cands) {
      for (const [dx, dy] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) {
        const x = c.x + dx, y = c.y + dy;
        if (!(await freeAt(page, x, y)) || (await exactNear(page, x, y)).length) continue;
        const nearBar = await page.evaluate(([x, y]) => { const cv = __gm().getCanvas().getBoundingClientRect(); return (GLBARS._view() || []).some((v) => v.shown && Math.hypot(v.x + cv.left - x, v.y + cv.top - y) < 60); }, [x, y]);
        if (nearBar) continue;
        pick = { id: c.id, x, y, z }; break;
      }
      if (pick) break;
    }
    if (pick) break;
  }
  if (!pick) ok("b9 setup: a restaurant dot with free space around it", false, dbg);
  else {
    const r = await tapGl(page, pick.x, pick.y);
    ok("b9 guard: a tap 20 px from a restaurant dot's centre at the smallest zoom (" + pick.z + ") opens that place (its area is 44+ px)", r.tap === "place:" + pick.id && r.opened === 1, { r, pick });
  }
  await closeAll(page);
  // b) the faces / count pill beside a bar disc: a tap 6-9 px off the drawn part (outside the old ± 2 px) opens THAT part (Folk här)
  let pp = null;
  for (const [ll, z] of [[[60.15124, 15.18797], 16.5], [[60.14997, 15.18679], 16.5], [[60.15098, 15.18663], 17], [[60.1505, 15.1872], 16]]) {
    await page.evaluate(([ll, z]) => __map.setView(ll, z, { animate: false }), [ll, z]); await glIdle(page, 1500);
    const cands = await page.evaluate(() => {
      const cv = __gm().getCanvas().getBoundingClientRect(), out = [];
      (GLBARS._view() || []).filter((v) => v.shown && v.full).forEach((v) => {
        const im = GLBARS._img(v.id), ico = im && im.parts.find((q) => q.sel === ".bar-ico"); if (!im || !ico) return;
        const k = v.icoW / (ico.bb[2] - ico.bb[0]);
        im.parts.filter((q) => q.sel === ".pill").forEach((q) => {
          const b = [v.x + q.bb[0] * k, v.y + q.bb[1] * k, v.x + q.bb[2] * k, v.y + q.bb[3] * k], cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
          for (const off of [7, 9]) for (const [x, y] of [[cx, b[3] + off], [cx, b[1] - off], [b[0] - off, cy], [b[2] + off, cy]]) {
            // 2 px inside the 44 px area (CI flake 19 Nov: a point exactly on the 22 px edge fell out by float rounding)
            if (Math.abs(x - cx) > Math.max((b[2] - b[0]) / 2, 22) - 2 || Math.abs(y - cy) > Math.max((b[3] - b[1]) / 2, 22) - 2) continue;
            out.push({ id: v.id, x: cv.left + x, y: cv.top + y, h: Math.round(b[3] - b[1]), w: Math.round(b[2] - b[0]), off });
          }
        });
      });
      return out.filter((c) => c.y > 230 && c.y < innerHeight - 260 && c.x > 20 && c.x < innerWidth - 70);
    });
    for (const c of cands) {
      if (!(await freeAt(page, c.x, c.y))) continue;
      if ((await exactNear(page, c.x, c.y)).length) continue;
      // no other bar's 44 px area or loose rule nearby (the expected bar is the only candidate)
      const other = await page.evaluate(([x, y, id]) => { const cv = __gm().getCanvas().getBoundingClientRect(); return (GLBARS._view() || []).some((v) => v.shown && v.id !== id && Math.hypot(v.x + cv.left - x, v.y + cv.top - y) < 70); }, [c.x, c.y, c.id]);
      if (other) continue;
      pp = c; break;
    }
    if (pp) break;
  }
  if (!pp) ok("b9 setup: a bar with a faces / count pill and a free spot just off it", false);
  else {
    const r = await tapGl(page, pp.x, pp.y);
    ok("b9 a tap " + pp.off + " px off a bar's faces / count pill (" + pp.w + " x " + pp.h + " px drawn) opens that part = Folk här (old: the bar icon or nothing)", r.tap === pp.id + ".pill" && r.opened === 1, { r, pp });
    if (r.sheet) {
      const q = await aboveSheet(page, pp.x, pp.y), free = await freeAt(page, q.x, q.y);
      const r2 = free ? await tapGl(page, q.x, q.y) : null;
      ok("b9 router: with the bar sheet open, the same off-part tap closes it and opens nothing", !!r2 && !r2.sheet && r2.opened === 0, { r2, q, free });
    }
  }
  ok("b9 no page errors", errs.length === 0, errs);
  await ctx.close();
}

/* ---------- d4: the empty state on the map ---------- */
const BASE = "http://127.0.0.1:" + PORT + "/";
const cardSt = (page) => page.evaluate(() => { const c = document.querySelector(".pn-me-card"), vis = !!c && !c.hidden && getComputedStyle(c).display !== "none";
  const go = c && c.querySelector(".pn-me-go"), r = vis ? c.getBoundingClientRect() : null, dock = document.querySelector(".dock, #dock, .pn-dock");
  const x = c && c.querySelector(".pn-me-x"), xr = x && vis ? x.getBoundingClientRect() : null, gr = go && !go.hidden && vis ? go.getBoundingClientRect() : null;
  return { vis, t: vis ? c.querySelector(".pn-me-t").textContent : "", s: vis ? c.querySelector(".pn-me-s").textContent : "", go: !!gr ? go.textContent.trim() : "",
    r: r && { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), w: Math.round(r.width) }, x44: !!xr && xr.width >= 44 && xr.height >= 44, go44: !gr || gr.height >= 44,
    dockTop: dock ? Math.round(dock.getBoundingClientRect().top) : null }; });
async function openD4(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, o);
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__map && window.PN && PN.s && PN.s.firstLoadDone && PN.s.lastPollAt > 0, null, { timeout: 30000 }).catch(() => console.log("no first poll"));
  await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 15, { animate: false }));
  await wait(page, 7000);   // calm start + one check (5 s)
  return { ctx, page, errs };
}
async function d4(browser) {
  // a) nobody out: the calm card, no fake pin, no row (nothing known elsewhere), 44 px close, above the dock
  let { ctx, page, errs } = await openD4(browser, { empty: true });
  let c = await cardSt(page);
  ok("d4 empty: nobody in view = one calm card 'Inga pins här just nu' + 'Kartan visar bara folk som delar sin plats.' (old: no text at all)",
    c.vis && c.t === "Inga pins här just nu" && /^Kartan visar bara folk/.test(c.s) && !c.go, c);
  ok("d4 empty: the card sits above the dock, inside the screen, ✕ is 44 px", !!c.r && c.r.l >= 12 && c.r.w <= 366 && (c.dockTop == null || c.r.b <= c.dockTop) && c.x44, c);
  // the ✕ hides it; a move does not bring it back
  await page.evaluate(() => document.querySelector(".pn-me-card .pn-me-x").click()); await wait(page, 300);
  await page.evaluate(() => __map.setView([60.1530, 15.1900], 15, { animate: false })); await wait(page, 6000);
  c = await cardSt(page);
  ok("d4 empty: ✕ hides the card and a map move does not bring it back", !c.vis, c);
  ok("d4 empty: no page errors", errs.length === 0, errs);
  await ctx.close();
  // b) people out in view: no card (guard); moved away to Borlänge: the card + 'Närmast folk: N km bort' flies back to them
  ({ ctx, page, errs } = await openD4(browser, {}));
  c = await cardSt(page);
  ok("d4 guard: pins in view = no card", !c.vis, c);
  await page.evaluate(() => __map.setView([60.4858, 15.4371], 14, { animate: false })); await wait(page, 6500);
  c = await cardSt(page);
  ok("d4 away: no pin in view but pins 30+ km off = the card with the row 'Närmast folk: … km bort' (44 px)", c.vis && /^Närmast folk: \d+(,\d)? km bort$/.test(c.go) && c.go44, c);
  if (c.vis && c.go) {
    await page.evaluate(() => document.querySelector(".pn-me-card .pn-me-go").click()); await wait(page, 3500);
    const at = await page.evaluate(() => { const ce = __map.getCenter(); return { lat: +ce.lat.toFixed(3), lng: +ce.lng.toFixed(3) }; });
    c = await cardSt(page);
    ok("d4 away: a tap on the row flies to the nearest people (Ludvika) and the card goes", Math.abs(at.lat - 60.15) < 0.03 && Math.abs(at.lng - 15.19) < 0.05 && !c.vis, { at, c });
  }
  // c) a sheet open = no card
  await page.evaluate(() => __map.setView([60.4858, 15.4371], 14, { animate: false })); await wait(page, 6000);
  await page.evaluate(() => { const b = document.getElementById("btn-groups") || document.querySelector(".dock-groups, #btn-grupper"); if (b) b.click(); }); await wait(page, 6000);
  const sh = await page.evaluate(() => !!(PN.s && PN.s.sheetCur));
  c = await cardSt(page);
  ok("d4 guard: with a sheet open there is no card", !sh || !c.vis, { sh, c });
  await ctx.close();
  // d) English: the app is Swedish only for now (i18n.js, owner 7 Nov: lang is always "sv"); the en text is ready: swap I18N for one check
  ({ ctx, page, errs } = await openD4(browser, { empty: true }));
  await page.evaluate(() => { const I0 = window.I18N; window.I18N = { lang: "en", t: I0.t, add: I0.add, set: I0.set }; try { PN.mapEmpty.check(); } finally { window.__en = 1; window.I18N = I0; } });
  c = await cardSt(page);
  await page.evaluate(() => PN.mapEmpty.check());
  ok("d4 en: 'No pins here right now' + 'The map only shows people who share their place.'", c.vis && c.t === "No pins here right now" && /^The map only shows/.test(c.s), c);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch(launchOpts([]));
  try {
    await sect("b11", () => b11(browser));
    await sect("b9", () => b9(browser));
    await sect("d4", () => d4(browser));
  } finally { await browser.close(); }
  console.log("\nmapfix5: " + pass + " pass, " + fail + " fail" + (TOKEN ? " (real token)" : ""));
  process.exit(fail ? 1 : 0);
})();
