// d4map-pw.js — lane d4map (13 Nov 2026), SMOOTH-PLAN fixes 2, 3, 9: smooth map.
//  fix 2: a finger tap on a bar paints feedback (.pn-tapring) in < 100 ms at 4x CPU; the sheet is built after that frame.
//  fix 3: moveend / zoomend listeners run in slices after the frame (not one long task); html.map-moving + "pn:mapmove"
//         while the map moves; endless map decorations pause while it moves (finite ones keep running).
//  fix 9: a DOM pin under the finger shrinks a little (CSS scale on its child).
//  Guards: bars never hide on zoom, my-location dot under the bar layers, clusters as c2speed set them (max zoom 13), code
//  calls (GLBARS.open) still open the sheet at once.
// Real Mapbox when MAPBOX_TEST_TOKEN is set (CI). Without it: a STUB Mapbox (blank style), the SAME GL layers run.
// node d4map-pw.js <port> [tag] [only: regex tap|move|pause|press|guard]
const { H, TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t", ONLY = new RegExp(process.argv[4] || ".");
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x ? " " + JSON.stringify(x) : "")); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const LUD = [60.1505, 15.1872], PIT = "n3472634175";

async function open(b, vp) {
  const { ctx, page } = await H.ctxFor(b, vp, {});
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
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(async (e) => { console.log("goto retry: " + e.message.split("\n")[0]); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); });
  await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => { window.__gm = () => BASEMAP.mapbox().getMapboxMap(); });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, errs, cdp };
}
async function idle(page, ms) {
  await page.waitForFunction(() => { const g = __gm(); return g.loaded() && !g.isMoving(); }, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  if (ms) await wait(page, ms);
}
async function view(page, ll, z, ms) { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await idle(page, ms == null ? 1500 : ms); }
async function drag(page, cdp, x0, y0, x1, y1, steps) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); await wait(page, 16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
// a bar drawn in GL in the middle band of the screen (page px)
function barInView(page, k) {
  return page.evaluate((k) => { const r = __map.getContainer().getBoundingClientRect();
    const v = (GLBARS._view() || []).filter((x) => x.shown && x.x > 50 && x.x < r.width - 50 && x.y > 220 && x.y < r.height - 300);
    const x = v[k % Math.max(1, v.length)]; return x ? { id: x.id, name: x.name, x: x.x + r.left, y: x.y + r.top, cx: x.x, cy: x.y } : null; }, k);
}

(async () => {
  const b = await chromium.launch(launchOpts([]));
  console.log("d4map " + TAG + " mode " + (TOKEN ? "real" : "stub"));
  try {
    const { ctx, page, errs, cdp } = await open(b, { width: 390, height: 844 });
    await view(page, LUD, 16, 2500);

    /* ---------- fix 2: tap feedback < 100 ms (4x CPU), then the full sheet of the same bar ---------- */
    if (ONLY.test("tap")) {
      const runs = [];
      for (let k = 0; k < 3; k++) {
        const v = await barInView(page, k); if (!v) { ok(false, "fix 2: a GL bar in view to tap"); break; }
        await page.evaluate(() => { window.__fb = null; window.__full = null; window.__tt = 0;
          window.addEventListener("touchend", () => { window.__tt = performance.now(); }, { capture: true, once: true });
          (function f() { if (__tt) { const sh = document.querySelector(".pn-tapring"), full = document.querySelector(".leaflet-popup.olnu-sheet .bs, .leaflet-popup .bs");
            if (__fb == null && (sh || full)) { __fb = { ms: Math.round(performance.now() - __tt), ring: !!sh, sheet: !!full };
              if (sh) { const cr = __map.getContainer().getBoundingClientRect(), q = sh.getBoundingClientRect(); __fb.at = { x: Math.round(q.left + q.width / 2 - cr.left), y: Math.round(q.top + q.height / 2 - cr.top) }; } }
            if (full && __full == null) __full = Math.round(performance.now() - __tt); }
            if (__full == null) requestAnimationFrame(f); })(); });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: v.x, y: v.y }] }); await wait(page, 30);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForFunction(() => window.__full != null, null, { timeout: 8000 }).catch(() => {});
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        const r = await page.evaluate(() => ({ fb: window.__fb, full: window.__full, title: ((document.querySelector(".olnu-sheet .pp-title, .leaflet-popup .pp-title") || {}).textContent || "").trim(),
          ring: window.__fb && window.__fb.at || null }));
        r.id = v.id; r.name = v.name; r.at = { x: Math.round(v.cx), y: Math.round(v.cy) }; runs.push(r);
        await page.evaluate(() => __map.closePopup()); await wait(page, 900);
      }
      console.log("TAP " + JSON.stringify(runs));
      const ms = runs.map((r) => (r.fb ? r.fb.ms : 9999)).sort((a, b) => a - b), med = ms[Math.floor(ms.length / 2)];
      ok(runs.length === 3 && med < 100, "fix 2: a bar tap shows feedback in < 100 ms at 4x CPU (median of 3: " + med + " ms)", ms);
      ok(runs.length && runs.every((r) => r.fb && r.fb.ring), "fix 2: the first feedback is the tap ring (painted before the sheet is built)");
      ok(runs.length && runs.every((r) => r.full != null && r.full < 2500), "fix 2: the full sheet still opens after the ring (< 2.5 s at 4x)", runs.map((r) => r.full));
      ok(runs.length && runs.every((r) => r.title && r.name && r.title.toLowerCase().indexOf(String(r.name).toLowerCase().slice(0, 6)) >= 0), "fix 2: the sheet is the tapped bar", runs.map((r) => [r.name, r.title]));
      ok(runs.length && runs.every((r) => r.ring && Math.abs(r.ring.x - r.at.x) < 8 && Math.abs(r.ring.y - r.at.y) < 8), "fix 2: the ring is centred on the tapped bar", runs.map((r) => [r.ring, r.at]));
      // a code call is NOT deferred (mypins / barlit / deep links call GLBARS.open and expect the sheet at once)
      await view(page, LUD, 17, 1500);
      const sync = await page.evaluate((id) => { const did = GLBARS.open(id); return { did, open: !!document.querySelector(".leaflet-popup .bs") }; }, PIT);
      ok(sync.did && sync.open, "fix 2: GLBARS.open (code call) still opens the sheet in the same task", sync);
      await page.evaluate(() => __map.closePopup()); await wait(page, 600);
    }

    /* ---------- fix 3: moveend work in slices after the frame; order kept; map-moving + pn:mapmove ---------- */
    if (ONLY.test("move")) {
      await view(page, LUD, 15, 1500);
      const r = await page.evaluate(() => new Promise((res) => {
        const log = [], m = __map, a = () => log.push("a"), z = () => log.push("z"), c = () => log.push("c");
        m.on("zoomend", z); m.on("moveend", a); m.on("moveend", c);
        const n = (m._events.moveend || []).length;
        m.fire("zoomend"); m.fire("moveend");
        const syncLog = log.slice(), pend = m._pnMoves ? m._pnMoves.pending() : 0;
        requestAnimationFrame(() => setTimeout(() => { const t0 = performance.now();
          const done = () => { if (log.length >= 3 || performance.now() - t0 > 3000) { m.off("zoomend", z); m.off("moveend", a); m.off("moveend", c); res({ n, syncLog, pend, log }); } else setTimeout(done, 20); }; done(); }, 0));
      }));
      ok(r.syncLog.length === 0 && r.pend > 2, "fix 3: moveend / zoomend listeners do not run in the firing task (" + r.n + " moveend listeners; " + r.pend + " queued)", r);
      ok(r.log.join("") === "zac", "fix 3: they all run after the frame, in order (zoomend first, then moveend in registration order)", r.log);
      const r2 = await page.evaluate(() => { const log = [], m = __map, a = (e) => log.push("a" + (e && e.n)); m.on("moveend", a);
        m.fire("moveend", { n: 1 }); m.fire("moveend", { n: 2 }); const s = log.slice(); m._pnMoves && m._pnMoves.flush(); m.off("moveend", a); return { s, log }; });
      ok(r2.s.join() === "a1" && r2.log.join() === "a1,a2", "fix 3: a new moveend first runs what is left of the old one (each listener sees every event)", r2);
      const r3 = await page.evaluate(() => { const m = __map, log = []; const f = () => log.push(1); m.on("moveend", f); m.fire("moveend"); m.off("moveend", f); m._pnMoves && m._pnMoves.flush(); return log.length; });
      ok(r3 === 0, "fix 3: a listener removed before its slice is skipped (a removed layer gets no late moveend)", r3);
      // a real finger pan: class + event on, then off after the end; the long tasks after the finger lifts
      await page.evaluate(() => { window.__mv = []; document.addEventListener("pn:mapmove", (e) => __mv.push(e.detail.moving));
        window.__cls = []; window.__lt = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => __lt.push(Math.round(e.duration)))).observe({ type: "longtask" });
        const f = () => { __cls.push(document.documentElement.classList.contains("map-moving")); if (__cls.length < 400) requestAnimationFrame(f); }; f(); });
      await drag(page, cdp, 300, 520, 90, 330, 16);
      const mid = await page.evaluate(() => document.documentElement.classList.contains("map-moving") || __cls.some(Boolean));
      await idle(page, 600);
      const end = await page.evaluate(() => ({ cls: document.documentElement.classList.contains("map-moving"), ev: __mv.slice(), lt: __lt.slice() }));
      ok(mid, "fix 3: html.map-moving is on while the finger pans the map");
      ok(!end.cls && end.ev[0] === true && end.ev[end.ev.length - 1] === false, "fix 3: pn:mapmove fires true at the start and false after the end; the class is off again", end);
      console.log("LONGTASKS after pan (1x CPU): " + JSON.stringify(end.lt));
    }

    /* ---------- fix 3: endless decorations pause while the map moves (map + page + ambient overlay); finite ones run ---------- */
    if (ONLY.test("pause")) {
      await view(page, LUD, 15, 1200);
      await page.evaluate(() => {
        const st = document.createElement("style"); st.id = "d4-css"; st.textContent = "@keyframes d4spin{to{transform:rotate(360deg)}}@keyframes d4once{to{opacity:.5}}" +
          ".d4-loop,.d4-page,.d4-once,.d4-amb{position:absolute;left:40px;top:300px;width:20px;height:20px;background:#f5a623;pointer-events:none}" +
          ".d4-loop{animation:d4spin 1s linear infinite}.d4-page{animation:d4spin 1s linear 3}.d4-once,.d4-amb{animation:d4once 5s linear forwards}";
        document.head.appendChild(st);
        const p = __map.getPane("markerPane") || __map.getContainer(), add = (c, par) => { const d = document.createElement("div"); d.className = c; par.appendChild(d); return d; };
        add("d4-loop", p); add("d4-once", p); add("d4-page", document.body);
        const amb = add("fx-amb d4-ambroot", document.body); amb.style.cssText = "position:fixed;inset:0;pointer-events:none"; add("d4-amb", amb);
      });
      await wait(page, 100);
      const st = () => page.evaluate(() => ["d4-loop", "d4-page", "d4-amb", "d4-once"].map((c) => { const a = document.querySelector("." + c).getAnimations()[0]; return a ? a.playState : "none"; }));
      const before = await st();
      await page.evaluate(() => { __map.panBy([120, 60], { animate: true, duration: 0.8 }); });
      await wait(page, 150);
      const during = await st();
      await idle(page, 500);
      const after = await st();
      ok(before[0] === "running" && during[0] === "paused" && after[0] === "running", "fix 3: an endless animation in the map pauses while the map moves and runs again after", { before, during, after });
      ok(during[1] === "paused" && after[1] === "running", "fix 3: a repeating animation elsewhere on the page (3 loops, like the pill glow) pauses too", { during, after });
      ok(during[2] === "paused" && after[2] === "running", "fix 3: the ambient overlay (.fx-amb) pauses while the map moves", { during, after });
      ok(during[3] === "running", "fix 3: a finite animation (enter / press / sheet) is not paused", { during });
      await page.evaluate(() => document.querySelectorAll(".d4-loop,.d4-once,.d4-page,.d4-ambroot,#d4-css").forEach((e) => e.remove()));
    }

    /* ---------- fix 9: a DOM pin shrinks under the finger ---------- */
    if (ONLY.test("press")) {
      await view(page, LUD, 15, 1200);
      const pt = await page.evaluate(() => {
        const m = L.marker(__map.getCenter(), { icon: L.divIcon({ className: "d4-pin", html: '<div class="d4-in" style="width:30px;height:30px;background:#fff"></div>', iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 99999 }).addTo(__map);
        window.__d4m = m; const r = m.getElement().querySelector(".d4-in").getBoundingClientRect(); return { x: r.left + 15, y: r.top + 15 };
      });
      await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await wait(page, 200);
      const s = await page.evaluate(() => { const e = document.querySelector(".d4-in"); return { scale: getComputedStyle(e).scale, tr: e.closest(".leaflet-marker-icon").style.transform !== "" }; });
      await page.mouse.up(); await wait(page, 200);
      const s2 = await page.evaluate(() => getComputedStyle(document.querySelector(".d4-in")).scale);
      ok(/^0\.9/.test(s.scale) && s.tr, "fix 9: a pressed map pin's child scales to ~0.92 (the marker keeps its own inline transform)", s);
      ok(s2 === "none" || s2 === "1", "fix 9: back to full size after the finger lifts", s2);
      await page.evaluate(() => { __d4m.remove(); __map.closePopup(); });
    }

    /* ---------- guards: bars never hide on zoom, my dot under the bars, clusters as c2speed set them ---------- */
    if (ONLY.test("guard")) {
      await view(page, LUD, 15, 1500);
      await page.evaluate(() => { window.__zf = []; const g = __gm(), lays = GLBARS._layers().filter((l) => /olnu-bar-(full|dot|dote|cdot|cdote|cdotf|cl)$/.test(l) && g.getLayer(l));
        const f = () => { try { __zf.push(g.queryRenderedFeatures({ layers: lays }).length); } catch (e) {} if (__zf.length < 120) requestAnimationFrame(f); }; f();
        __map.flyTo(__map.getCenter(), 16.5, { duration: 0.9 }); });
      await wait(page, 1500); await idle(page, 300);
      const zf = await page.evaluate(() => __zf.slice());
      ok(zf.length > 10 && Math.min(...zf) > 0, "guard: GL bars never hide during a zoom (min drawn per frame " + Math.min(...zf) + ", " + zf.length + " frames)");
      await page.evaluate((ll) => { GLBARS.me(ll[0], ll[1]); }, [LUD[0] + 0.0004, LUD[1] + 0.0004]);
      await drag(page, cdp, 200, 520, 160, 420, 8); await idle(page, 600);   // after a move too
      const ord = await page.evaluate(() => { const ids = __gm().getStyle().layers.map((l) => l.id);
        const barIx = ids.filter((id) => /^olnu-(bar-|place$)/.test(id) && id !== "olnu-bar-blk").map((id) => ids.indexOf(id)), dot = ids.indexOf("olnu-me-dot");
        return { dot, bars: barIx.length, under: dot >= 0 && barIx.every((i) => i > dot) }; });
      ok(ord.under && ord.bars > 0, "guard: my-location dot layer stays under every bar / food layer", ord);
      const cl = await page.evaluate(() => GLBARS._cl());
      ok(cl.maxz === 14, "guard: bar clusters stop at Leaflet zoom 14 (CL_MAXZ 13: c12fix put it back so close bars never disappear at z14)", { maxz: cl.maxz });
      ok(errs.length === 0, "no page errors", errs.slice(0, 5));
    }
    await ctx.close().catch(() => {});
  } catch (e) { console.log("ERR " + e.stack); fail++; }
  await b.close();
  console.log((fail ? "FAIL " : "OK ") + pass + " pass, " + fail + " fail"); process.exit(fail ? 1 : 0);
})();
