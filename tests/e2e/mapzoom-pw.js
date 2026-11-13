// mapzoom-pw.js — lane a1map (2026-11-12, map polish): I-08 bars hide on zoom-out while there is room, I-27 bar icons blink on zoom,
// I-28 my dot under the bar icons (+ "Du" when checked in), I-09 cluster badge >= pin, I-20 popup clear of the HUD, I-10 arena chip
// icon = the pin disc, I-06 Hemzon mini map in the main map's navy look, I-11 one chip per country at the Nordic zoom.
// Real Mapbox when MAPBOX_TEST_TOKEN is set (CI). Without it: a STUB Mapbox (fake pk token, blank style), so the SAME GL bar /
// zone layers run on any machine (no basemap tiles, no Mapbox load counted).
// node mapzoom-pw.js <port> [tag] [only: regex of sections z08|z27|z28|z09|z20|z10|z06|z11]
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t", ONLY = new RegExp(process.argv[4] || ".");
const MODE = TOKEN ? "real" : "stub";
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const ZC = { v: 1, at: new Date().toISOString(), k: 3, total: 23, some: true,
  kommun: [{ c: "0180", n: 15 }, { c: "2061" }, { c: "2080" }, { c: "2085", n: 5, bar: "n3472634175" }, { c: "1480", n: 3 }],
  lan: [{ c: "01", n: 15, top: "0180" }, { c: "14", n: 3, top: "1480" }, { c: "20", n: 8, top: "2085" }] };
const PIT = "n3472634175", PARMA = "x-la-parma-ludvika", LUD = [60.1505, 15.1872];
const shotDir = SP + "logs/";
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

(async () => {
  console.log("MODE " + MODE + (MODE === "stub" ? " (no MAPBOX_TEST_TOKEN: blank stub basemap, real GL layers)" : ""));
  const b = await chromium.launch(launchOpts([]));
  try {
    /* ---------- I-08: zoom out a little = an icon only hides when its disc touches a better icon (owner case: all quiet) ---------- */
    if (ONLY.test("z08")) {
      const { ctx, page, errs } = await open(b, { width: 412, height: 860 }, { quiet: true, h: { empty: true, checkin: false, noEv: true } });
      await view(page, LUD, 16, 2500);
      const bad = [], prio = [], parma = [];
      for (const z of [16, 15.6, 15.2, 15]) {
        await view(page, LUD, z, 1500);
        const v = (await bars(page)).filter((x) => x.x > 20 && x.y > 20 && x.x < 392 && x.y < 840);
        const drawn = v.filter((x) => x.drawn);
        v.filter((x) => !x.drawn).forEach((u) => {
          const by = drawn.filter((w) => Math.hypot(w.x - u.x, w.y - u.y) < (u.d + w.d) / 2 + 4);   // + the ring / shadow
          if (!by.length) bad.push("z" + z + " " + u.name + " (" + u.cat + ") hidden with room");
          else if (by.every((w) => w.rk < u.rk)) prio.push("z" + z + " " + u.name + " (" + u.cat + ") hidden for " + by.map((w) => w.name + " (" + w.cat + ")").join(", "));
        });
        const p = v.find((x) => x.id === PARMA); parma.push("z" + z + ":" + (p ? (p.drawn ? p.lays.join("+") : "HIDDEN") : "off"));
        console.log("I-08 z" + z + " drawn " + drawn.length + "/" + v.length + ": " + v.map((x) => x.name.slice(0, 10) + (x.drawn ? "" : "(-)")).join(", "));
        if (z === 15) await page.screenshot({ path: shotDir + "mapzoom-" + TAG + "-z08-z15.png" });
      }
      ok(!bad.length, "I-08 Ludvika z16 → z15, all quiet: no bar icon hides while it has room (" + (bad.slice(0, 6).join("; ") || "none") + ")");
      ok(!prio.length, "I-08 a hidden icon never beats a better type (bar > pub > nightclub > restaurant > café) (" + (prio.slice(0, 4).join("; ") || "none") + ")");
      ok(parma.every((s) => !/HIDDEN|off/.test(s)), "I-08 La Parma (pub) stays an icon z16 → z15 (" + parma.join(" ") + ")");
      await view(page, LUD, 14, 1800);
      const p14 = (await bars(page)).find((x) => x.id === PARMA);
      ok(!!p14 && (p14.drawn || p14.incl), "I-08 La Parma at z14: its own icon or inside a drawn cluster badge (" + JSON.stringify(p14 && { lays: p14.lays, incl: p14.incl }) + ")");
      ok(errs.length === 0, "I-08 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "mapzoom-" + TAG + "-z08");
    }

    /* ---------- I-27: during a zoom animation a visible bar icon never drops out and never changes layer ---------- */
    if (ONLY.test("z27")) for (const quiet of [false, true]) {
      const W = quiet ? "quiet" : "live";
      const { ctx, page, errs } = await open(b, { width: 412, height: 860 }, quiet ? { quiet: true, h: { empty: true, checkin: false, noEv: true } } : {});
      await view(page, LUD, 16.6, 2500);
      for (const [z0, z1] of [[16.6, 15.1], [15.1, 16.6]]) {
        await view(page, LUD, z0, 1500);
        const r = await page.evaluate(([z1]) => new Promise((res) => {
          const g = __mz.gm(), lays = GLBARS._layers().filter((l) => __mz.BAR_L.test(l) && g.getLayer(l)), seq = {}, S = g.getCanvas().getBoundingClientRect();
          const fam = (l) => /bar-full$/.test(l) ? "" : /bar-c/.test(l) ? "c" : "b";
          let frames = 0; const sets0 = GLBARS.stats.sets || 0, cl0 = GLBARS.stats.clSets || 0, ids0 = GLBARS._cl().ids;
          const sample = () => { frames++; const by = {};
            g.queryRenderedFeatures([[8, 8], [S.width - 8, S.height - 8]], { layers: lays }).forEach((f) => { const id = String(f.properties.id); by[id] = (by[id] || "") + fam(f.layer.id); });
            Object.keys(by).forEach((id) => { if (!seq[id]) seq[id] = new Array(frames - 1).fill(null); });
            Object.keys(seq).forEach((id) => seq[id].push(by[id] == null ? null : (by[id].replace(/(.)\1+/g, "$1") || "f"))); };
          sample();
          const t0 = performance.now(); let zoomed = false;
          const tick = () => { sample(); if (performance.now() - t0 < 1400 + 1300) requestAnimationFrame(tick); else res({ frames, seq, sets: (GLBARS.stats.sets || 0) - sets0, clSets: (GLBARS.stats.clSets || 0) - cl0, same: GLBARS._cl().ids === ids0 }); };
          g.easeTo({ zoom: z1 - 1, duration: 1400 }); zoomed = true; requestAnimationFrame(tick);
        }), [z1]);
        const gaps = [], swaps = [];
        Object.keys(r.seq).forEach((id) => {
          const s = r.seq[id], first = s[0], last = s[s.length - 1]; if (first == null || last == null) return;   // came in / went out of view
          const holes = s.filter((x) => x == null).length; if (holes) gaps.push(id + ":" + holes + "f");
          const fams = [...new Set(s.filter((x) => x && x !== "f").map((x) => x.replace("f", "")).filter(Boolean))];
          if (fams.length > 1) swaps.push(id + ":" + fams.join(">"));
        });
        console.log("I-27 " + W + " z" + z0 + "→" + z1 + ": " + r.frames + " frames, " + Object.keys(r.seq).length + " bars, main setData " + r.sets + ", cluster setData " + r.clSets);
        ok(!gaps.length, "I-27 " + W + " z" + z0 + "→" + z1 + ": a bar drawn before and after the zoom is drawn in EVERY frame (" + (gaps.slice(0, 6).join(" ") || "no gaps") + ")");
        ok(!swaps.length, "I-27 " + W + " z" + z0 + "→" + z1 + ": a bar's icon stays in ONE layer (no dot ↔ cluster-dot switch) (" + (swaps.slice(0, 6).join(" ") || "none") + ")");
        if (quiet) ok(r.clSets === 0 || !r.same, "I-27 quiet z" + z0 + "→" + z1 + ": the dot source is re-sent only when the set of bars changes, never for a zoom alone (setData " + r.clSets + ", same bars " + r.same + ")");
      }
      ok(errs.length === 0, "I-27 " + W + " no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "mapzoom-" + TAG + "-z27");
    }

    /* ---------- I-28: my dot under the bar icons, a ring over them; checked in = "Du" on that bar ---------- */
    if (ONLY.test("z28")) for (const ci of [false, true]) {
      const W = ci ? "checked in at Pitchers" : "not checked in";
      const { ctx, page, errs } = await open(b, { width: 412, height: 860 }, ci ? {} : { noMine: true, h: { checkin: false } });
      await view(page, [60.14997, 15.18679], 16.5, 2500);
      await page.evaluate(() => { if (PN.locate) PN.locate({}); });
      await wait(page, 2500); await idle(page, 600);
      const r = await page.evaluate(() => {
        const g = __mz.gm(), ids = (g.getStyle().layers || []).map((l) => l.id), ix = (id) => ids.indexOf(id);
        const barIx = ids.filter((id) => /^olnu-(bar-|place$)/.test(id) && id !== "olnu-bar-blk").map(ix);
        const dot = ix("olnu-me-dot"), ring = ix("olnu-me-ring"), dom = [...document.querySelectorAll(".me-dot")].filter((e) => e.offsetParent && getComputedStyle(e).display !== "none").length;
        const q = (l) => g.getLayer(l) ? g.queryRenderedFeatures({ layers: [l] }).length : -1;
        const pit = GLBARS._marker("n3472634175"), pp = pit && g.project([pit.getLatLng().lng, pit.getLatLng().lat]);
        const du = g.getLayer("olnu-me-du") ? g.queryRenderedFeatures({ layers: ["olnu-me-du"] }).map((f) => { const p = g.project(f.geometry.coordinates); return pp ? Math.round(Math.hypot(p.x - pp.x, p.y - pp.y)) : -1; }) : [];
        return { dot, ring, under: dot >= 0 && barIx.every((i) => i > dot), over: ring >= 0 && barIx.every((i) => i < ring), dom, nDot: q("olnu-me-dot"), nRing: q("olnu-me-ring"), du, me: GLBARS._me ? GLBARS._me() : null };
      });
      console.log("I-28 " + W + " " + JSON.stringify(r).slice(0, 400));
      ok(r.under, "I-28 " + W + ": my dot layer is UNDER every bar / food icon layer (dot at " + r.dot + ")");
      ok(r.over, "I-28 " + W + ": the ring (bigger than a bar icon) is OVER the bar icons (ring at " + r.ring + ")");
      ok(r.dom === 0, "I-28 " + W + ": no DOM me-dot on top of the GL bars (" + r.dom + " visible)");
      if (!ci) {   // hotfix1 I-63 (owner 13 Nov): the ring only when a bar / food icon covers my dot; away from the bars = the dot only
        const at = async (ll) => { await page.evaluate((ll) => { __map.closePopup(); GLBARS.me(ll[0], ll[1]); __map.setView(ll, 16.5, { animate: false }); }, ll); await idle(page, 1200);
          return page.evaluate(() => { const g = __mz.gm(), q = (l) => g.getLayer(l) ? g.queryRenderedFeatures({ layers: [l] }).length : -1; return { nDot: q("olnu-me-dot"), nRing: q("olnu-me-ring"), cov: GLBARS._me().cov }; }); };
        const pit = await page.evaluate((id) => { const m = GLBARS._marker(id); return m ? [m.getLatLng().lat, m.getLatLng().lng] : null; }, PIT);
        const nb = pit ? await at(pit) : {}, aw = await at([60.1452, 15.1745]);
        ok(nb.nDot === 1 && nb.nRing >= 1, "I-28 not checked in, on the Pitchers icon: my dot + ring are drawn " + JSON.stringify(nb));
        ok(aw.nDot === 1 && aw.nRing === 0, "I-28 not checked in, away from the bars: my dot, no ring (I-63) " + JSON.stringify(aw));
      }
      else ok(r.nDot === 0 && r.du.length === 1 && r.du[0] <= 2, "I-28 checked in at Pitchers: no dot, one 'Du' tag on the Pitchers icon (dot " + r.nDot + ", du " + JSON.stringify(r.du) + ")");
      await page.screenshot({ path: shotDir + "mapzoom-" + TAG + "-z28-" + (ci ? "ci" : "me") + ".png" });
      ok(errs.length === 0, "I-28 " + W + " no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "mapzoom-" + TAG + "-z28");
    }

    /* ---------- I-09: a bar cluster badge is never smaller than one bar pin, and grows with the count ---------- */
    if (ONLY.test("z09")) {
      const { ctx, page, errs } = await open(b, { width: 412, height: 860 }, { quiet: true, h: { empty: true, checkin: false } });   // quiet bars cluster
      for (const z of [14.5, 14, 13.5]) {   // the first zoom with a drawn cluster (the bars and the cluster images come async)
        await view(page, LUD, z, 2500);
        if (await page.waitForFunction(() => { const g = __mz.gm(); return g.getLayer("olnu-bar-cl") && g.queryRenderedFeatures({ layers: ["olnu-bar-cl"] }).length > 0; }, null, { timeout: 10000 }).then(() => true, () => false)) break;
      }
      const r = await page.evaluate(() => {
        const g = __mz.gm(), fs = g.getLayer("olnu-bar-cl") ? g.queryRenderedFeatures({ layers: ["olnu-bar-cl"] }) : [];
        const im = fs.map((f) => { const id = g.getLayoutProperty("olnu-bar-cl", "icon-image"); const nm = "pncl-" + f.properties.point_count + "-" + (f.properties.b > 0 ? 1 : 0) + (f.properties.f > 0 ? 1 : 0);
          const i = g.style.getImage ? g.style.getImage(nm) : null; if (!i) return { n: f.properties.point_count, h: -1 };
          // the drawn height = the rows with ink (the image itself is square)
          const W = i.data.width, Hh = i.data.height, d = i.data.data; let top = -1, bot = -1;
          for (let y = 0; y < Hh; y++) { let any = false; for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) { any = true; break; } if (any) { if (top < 0) top = y; bot = y; } }
          return { n: f.properties.point_count, h: +((bot - top + 1) / i.pixelRatio).toFixed(1) }; });
        const pin = 32 * 0.875;   // a bar pin at this zoom (Ø 32 image px × the zoom ramp)
        const st = GLBARS._cl().step; return { im, pin, steps: st ? [2, 5, 10].map((n) => st(n)[0]) : null };
      });
      console.log("I-09 " + JSON.stringify(r));
      ok(r.im.length >= 1 && r.im.every((x) => x.h >= 33), "I-09 every cluster badge is at least as high as a bar pin (Ø 32 image px; drawn ≥ 33 px): " + JSON.stringify(r.im));
      ok(!!r.steps && r.steps[0] >= 32 && r.steps[0] < r.steps[1] && r.steps[1] < r.steps[2], "I-09 the badge grows with the count (2–4 / 5–9 / 10+: " + JSON.stringify(r.steps) + ")");
      await page.screenshot({ path: shotDir + "mapzoom-" + TAG + "-z09.png" });
      ok(errs.length === 0, "I-09 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "mapzoom-" + TAG + "-z09");
    }

    /* ---------- I-20: on a short PC screen the popup's ✕ is never under a map control ---------- */
    if (ONLY.test("z20")) for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
      const { ctx, page, errs } = await open(b, vp, { h: { checkin: false } });
      await view(page, LUD, 16.5, 2500);
      const bad = [];
      for (const [pn, fx, fy] of [["top-right", 0.96, 0.16], ["right", 0.96, 0.5], ["top", 0.5, 0.12]]) {
        await page.evaluate(([fx, fy]) => { __map.closePopup(); const mk = GLBARS._marker("n3472634175"), s = __map.getSize(), p = __map.latLngToContainerPoint(mk.getLatLng());
          __map.panBy([Math.round(p.x - s.x * fx), Math.round(p.y - s.y * fy)], { animate: false }); }, [fx, fy]);
        await idle(page, 600);
        await page.evaluate(() => GLBARS.open("n3472634175")); await wait(page, 1800);
        const m = await page.evaluate(() => { const root = [...document.querySelectorAll(".leaflet-popup")].find((p) => p.offsetParent); if (!root) return null;
          const x = root.querySelector(".leaflet-popup-close-button"); if (!x) return { nox: 1 }; const r = x.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { ok: !!hit && root.contains(hit), hit: hit ? (hit.id || String(hit.getAttribute("class") || "").slice(0, 30) || hit.tagName) + (hit.closest("[id]") ? " in #" + hit.closest("[id]").id : "") : "", x: Math.round(r.left), y: Math.round(r.top) }; });
        console.log("I-20 " + vp.width + "x" + vp.height + " " + pn + " " + JSON.stringify(m));
        if (m && !m.ok) bad.push(pn + ": " + m.hit + " @" + m.x + "," + m.y);
        if (pn === "top-right") await page.screenshot({ path: shotDir + "mapzoom-" + TAG + "-z20-" + vp.width + ".png" });
      }
      ok(!bad.length, "I-20 " + vp.width + "x" + vp.height + ": the popup's ✕ is never under a map control at the top / right edge (" + (bad.join("; ") || "clear") + ")");
      ok(errs.length === 0, "I-20 " + vp.width + " no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "mapzoom-" + TAG + "-z20");
    }

    /* ---------- I-10: the arena / event chip icon = the bar pins' disc (navy, foam ring, glyph) ---------- */
    if (ONLY.test("z10")) {
      const { ctx, page, errs } = await open(b, { width: 412, height: 860 });
      const r = await page.evaluate(() => {
        const s = window.PNPINS && PNPINS.discSVG ? PNPINS.discSVG("hockey", 20) : "", box = document.createElement("div"); box.innerHTML = s;
        const sv = box.querySelector("svg"), fills = sv ? [...sv.querySelectorAll("circle")].map((c) => (c.getAttribute("fill") || "").toLowerCase()) : [];
        const T = window.PNTOKENS && PNTOKENS.col;
        return { w: sv ? +sv.getAttribute("width") : 0, glyph: sv ? sv.querySelectorAll("g path").length : 0, navy: !!T && fills.some((f) => f === String(T.navy).toLowerCase() || /url\(/.test(f)),
          ring: !!T && fills.includes(String(T.foam).toLowerCase()) };
      });
      // a chip on the map (Ludvika has an arena; the quiet chip shows from z15)
      await view(page, LUD, 15, 2500);
      const chips = await page.evaluate(() => { try { ARENAPIN._draw(true); } catch (e) {} return [...document.querySelectorAll(".ap-pin .ap-i")].map((e) => !!e.querySelector("svg.pni-disc")); });
      console.log("I-10 disc " + JSON.stringify(r) + " chips " + JSON.stringify(chips));
      ok(r.w === 20 && r.glyph >= 1 && r.navy && r.ring, "I-10 PNPINS.discSVG('hockey') = a 20 px pin disc: navy body, foam ring, the hockey glyph " + JSON.stringify(r));
      ok(chips.every(Boolean), "I-10 every arena / event chip on the map uses the pin disc (" + chips.length + " chips)");
      ok(errs.length === 0, "I-10 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "mapzoom-" + TAG + "-z10");
    }

    /* ---------- I-06: the Hemzon mini map has the main map's navy look (still the free raster: no Mapbox map load) ---------- */
    if (ONLY.test("z06")) {
      const { ctx, page, errs } = await open(b, { width: 412, height: 860 });
      await idle(page, 1500);
      const loads0 = await page.evaluate(() => BASEMAP.mapboxLoads());
      await page.evaluate(() => HOMEZONE.open()); await wait(page, 2000);
      const r = await page.evaluate(() => { const el = document.querySelector(".hz-map"); if (!el) return null;
        const tp = el.querySelector(".leaflet-tile-pane"), f = tp ? getComputedStyle(tp).filter : "", bg = getComputedStyle(el).backgroundColor;
        const srcs = [...el.querySelectorAll("img.leaflet-tile")].map((i) => /Reference/.test(i.src) ? "ref" : /Base/.test(i.src) ? "base" : "?");
        return { mini: el.classList.contains("pn-mini"), f, bg, base: srcs.includes("base"), ref: srcs.includes("ref"), loads: BASEMAP.mapboxLoads() }; });
      console.log("I-06 " + JSON.stringify(r));
      await page.screenshot({ path: shotDir + "mapzoom-" + TAG + "-z06-hemzon.png" });
      ok(!!r && r.mini && /sepia/.test(r.f) && /hue-rotate/.test(r.f) && r.bg === "rgb(61, 68, 115)", "I-06 the Hemzon mini map is tinted to the main map's navy (" + JSON.stringify(r && { f: r.f, bg: r.bg }) + ")");
      ok(!!r && r.ref, "I-06 the Hemzon mini map shows street / place names like the main map (reference tiles)");
      ok(!!r && r.loads === loads0, "I-06 no extra Mapbox map load for the mini map (" + loads0 + " → " + (r && r.loads) + ")");
      ok(errs.length === 0, "I-06 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "mapzoom-" + TAG + "-z06");
    }

    /* ---------- I-11: Nordic zoom = one chip per country with people out; the län chips only from a closer zoom ---------- */
    if (ONLY.test("z11")) {
      const { ctx, page, errs } = await open(b, { width: 412, height: 915 });
      const lc = (ls) => page.evaluate((ls) => { const g = __mz.gm(); return g.queryRenderedFeatures({ layers: ls.filter((l) => g.getLayer(l)) }).map((f) => f.properties.c || f.properties.l); }, ls);
      await view(page, [62.0, 16.0], 4.2, 600);
      await page.waitForFunction(() => window.ZONES && ZONES._counts() && ZONES._geo().l, null, { timeout: 30000 }).catch(() => console.log("no counts / borders"));
      await page.waitForFunction(() => { const g = __mz.gm(); return g.getLayer("olnu-zc-lbl") && g.queryRenderedFeatures({ layers: ["olnu-zc-lbl"] }).length > 0; }, null, { timeout: 10000 }).catch(() => {});
      const far = { ctry: await lc(["olnu-zc-lbl"]), lan: await lc(["olnu-zl-lblc", "olnu-zl-lblq"]), rows: await page.evaluate(() => ZONES._ctry ? ZONES._ctry().rows : null) };
      await page.screenshot({ path: shotDir + "mapzoom-" + TAG + "-z11-nordic.png" });
      await view(page, [62.6, 16.4], 5.0, 600);
      await page.waitForFunction(() => { const g = __mz.gm(); return g.queryRenderedFeatures({ layers: ["olnu-zl-lblc", "olnu-zl-lblq"].filter((l) => g.getLayer(l)) }).length >= 3; }, null, { timeout: 10000 }).catch(() => {});
      const near = { ctry: await lc(["olnu-zc-lbl"]), lan: await lc(["olnu-zl-lblc", "olnu-zl-lblq"]) };
      console.log("I-11 far " + JSON.stringify(far) + " near " + JSON.stringify(near));
      ok(far.ctry.length === 1 && far.ctry[0] === "SE" && far.lan.length === 0, "I-11 z4.2 (Nordic): one country chip 'Sverige' and no län chips (" + JSON.stringify(far) + ")");
      ok(!!far.rows && far.rows.length === 1 && /^23 ute/.test(far.rows[0].t), "I-11 the country chip = the zone_counts total ('" + (far.rows && far.rows[0] && far.rows[0].t) + "')");
      ok(near.ctry.length === 0 && near.lan.length >= 3, "I-11 z5.0 (Sweden): the län chips are back, no country chip (" + JSON.stringify(near) + ")");
      ok(errs.length === 0, "I-11 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "mapzoom-" + TAG + "-z11");
    }
  } catch (e) { ok(false, "crash: " + (e && e.stack || e)); }
  await b.close();
  console.log("mapzoom " + TAG + " (" + MODE + "): " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
