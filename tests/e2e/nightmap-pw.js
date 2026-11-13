// nightmap-pw.js — lane nightmap (owner 13 Nov 17:17-17:22): I-78 friends' live pins at EVERY zoom (avatar dot, stacked chip
// "Ida +2" when close at low zoom, tap = zoom to them), I-83 a town chip tap fits the friends of that chip, I-81 the arena chip
// at Marnäs is a round disc (no stretched pill), I-85 "N vänner ute nu" shows the real avatar (letter as fallback).
// Real Mapbox when MAPBOX_TEST_TOKEN is set (CI). Without it: a STUB Mapbox (fake pk token, blank style), so the SAME GL zone
// layers run on any machine (as mapzoom-pw.js). Mocked Supabase (d2-helpers), page served as tunela.github.io/Beer-map/.
// node nightmap-pw.js <port> [tag] [only: regex of sections i78|i83|i81|i85]
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t", ONLY = new RegExp(process.argv[4] || ".");
const MODE = TOKEN ? "real" : "stub";
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const ZC = { v: 1, at: new Date().toISOString(), k: 3, total: 9, some: true,
  kommun: [{ c: "2085", n: 4 }, { c: "1482" }], lan: [{ c: "20", n: 4, top: "2085" }, { c: "14" }] };
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
const DUB = [53.3438, -6.2546], KUN = [57.8742, 11.9690], KUN2 = [57.8601, 11.9921], LUD = [60.1505, 15.1872], HIT = [60.1512, 15.20877];
const SPEC = { v: 1, sk: 1, fs: 2, ey: 2, br: 4, mt: 1, hr: 4, hc: 3, fh: 5, hw: 0, gl: 0, up: 1, uc: 0, bg: 8 };
let pid = 9100;
const P = (ll, n, o = {}) => ({ id: pid++, lat: ll[0], lng: ll[1], beer_count: n, other_count: 0, precise: o.precise !== false, created_at: iso(o.m || 30),
  is_mine: !!o.mine, friend_name: o.f || null, skal_count: 0, i_skaled: false });
const PINS = [P(LUD, 3, { mine: 1 }), P(DUB, 4, { f: "Ida" }), P(KUN, 2, { f: "Enberg" }), P(KUN2, 1, { f: "Kalle" }), P([60.152, 15.19], 2), P([60.149, 15.185], 1)];
const shotDir = SP + "logs/";

async function open(b, vp, o = {}) {
  const { ctx, page } = await H.ctxFor(b, vp, o.h || {});
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: o.raster ? "" : (TOKEN || STUB_TOKEN) }));
  await page.route(/rest\/v1\/rpc\/zone_counts/, (r) => J(r, ZC));
  await page.route(/rest\/v1\/rpc\/(live_beers|live_others|live_checkins)\b/, (r) => J(r, /live_beers/.test(r.request().url()) ? (o.pins || PINS) : []));
  await page.route(/rest\/v1\/rpc\/avatars_for\b/, (r) => J(r, { v: 1, people: [{ k: "me", name: "Anton", is_me: true },
    { k: "k-enberg", name: "Enberg", is_me: false, seed: "0b77aa10", a: SPEC, r: 13, md: [] }, { k: "k-ida", name: "Ida", is_me: false }, { k: "k-kalle", name: "Kalle", is_me: false }] }));
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
  if (o.raster) await page.waitForFunction(() => window.__map && window.U, null, { timeout: 45000 }).catch(() => console.log("no map"));
  else await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.waitForFunction(() => window.PN && PN.s && PN.s.beers && PN.s.beers.length >= 4, null, { timeout: 30000 }).catch(() => console.log("no pins"));
  return { ctx, page, errs };
}
async function idle(page, ms) {
  await page.waitForFunction(() => { try { const g = BASEMAP.isMapbox() && BASEMAP.mapbox().getMapboxMap(); return !g || (g.loaded() && !g.isMoving()); } catch (e) { return true; } }, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  if (ms) await wait(page, ms);
}
async function view(page, ll, z, ms) { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await idle(page, ms == null ? 1500 : ms); }
// visible friend markers (any kind: the normal pin, a cluster with a face, or the far-out friend dot) inside the map viewport
function friendsShown(page) {
  return page.evaluate(() => {
    const vis = (e) => { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
    const out = [];
    document.querySelectorAll(".leaflet-marker-icon.pp-f, .leaflet-marker-icon.nm-fd-mk, .leaflet-marker-icon.olnu-cl.cl-f").forEach((m) => { let ok = vis(m) || [...m.querySelectorAll("*")].some(vis); let p = m; while (ok && p && p !== document.body) { if (getComputedStyle(p).display === "none") ok = false; p = p.parentElement; } if (ok) out.push((m.textContent || "").trim().slice(0, 24) || (m.getAttribute("aria-label") || "")); });
    return out;
  });
}

(async () => {
  console.log("MODE " + MODE);
  const b = await chromium.launch(launchOpts([]));
  try {
    /* ---------- I-78: a friend in Dublin shows over Europe (z4); 2 friends close at low zoom = one chip "Enberg +1"; tap = zoom to her ---------- */
    if (ONLY.test("i78")) {
      const { ctx, page, errs } = await open(b, { width: 390, height: 844 });
      await view(page, [54.5, 4], 4, 2500);
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-zones"), null, { timeout: 15000 }).catch(() => console.log("zones not on"));
      await wait(page, 3000);   // characters load (avpins), the dots redraw
      const shown = await friendsShown(page), zon = await page.evaluate(() => document.documentElement.hasAttribute("data-zones"));
      const chip = await page.evaluate(() => { const e = [...document.querySelectorAll(".nm-fd")].find((x) => /Enberg|Kalle/.test(x.textContent)); return e ? { t: e.textContent, n: +e.getAttribute("data-n"), img: !!e.querySelector("img") } : null; });
      console.log("I-78 z4 zones=" + zon + " shown " + JSON.stringify(shown) + " chip " + JSON.stringify(chip));
      await page.screenshot({ path: shotDir + "nightmap-" + TAG + "-i78-europe.png" });
      ok(zon && shown.some((t) => /Ida/.test(t)), "I-78 z4 over Europe (zones on): the friend in Dublin shows (" + JSON.stringify(shown) + ")");
      ok(!!chip && chip.n === 2 && /^Enberg \+1$/.test(chip.t) && chip.img, "I-78 two friends close together at z4 = ONE chip 'Enberg +1' with Enberg's character (" + JSON.stringify(chip) + ")");
      const r1 = await page.evaluate(() => { const e = [...document.querySelectorAll(".nm-fd")].find((x) => /Ida/.test(x.textContent)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + 15, y: r.top + r.height / 2 }; });
      if (r1) { await page.mouse.click(r1.x, r1.y); await wait(page, 2200); await idle(page, 300); }
      const after = await page.evaluate(() => ({ z: __map.getZoom(), c: __map.getCenter() }));
      console.log("I-78 tap " + JSON.stringify(after));
      ok(!!r1 && after.z >= 14 && Math.abs(after.c.lat - 53.3438) < 0.02 && Math.abs(after.c.lng + 6.2546) < 0.03, "I-78 tap on Ida's dot = zoom to Ida in Dublin (" + JSON.stringify(after) + ")");
      await view(page, [58.4, 12.9], 7.2, 2500);
      const z7 = await friendsShown(page);
      await page.screenshot({ path: shotDir + "nightmap-" + TAG + "-i78-z7.png" });
      ok(z7.some((t) => /Enberg/.test(t)), "I-78 z7.2 over Västra Götaland: Enberg's dot shows (" + JSON.stringify(z7) + ")");
      ok(errs.length === 0, "I-78 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "nightmap-" + TAG + "-i78");
    }

    /* ---------- I-83: a tap on the town chip "Kungälv · Enberg" leaves Enberg's pin in view (not the Stenungsund view) ---------- */
    if (ONLY.test("i83")) {
      const { ctx, page, errs } = await open(b, { width: 390, height: 844 });
      await view(page, [58.25, 12.3], 7.2, 2500);
      await page.waitForFunction(() => { const g = BASEMAP.mapbox().getMapboxMap(); return g.getLayer("olnu-zk-lbl") && g.queryRenderedFeatures({ layers: ["olnu-zk-lbl"] }).some((f) => String(f.properties.k) === "1482"); }, null, { timeout: 20000 }).catch(() => console.log("no Kungälv chip"));
      // the chip's centre: scan from its town point in the chip's side direction (an), take the middle of the hits
      const pt = await page.evaluate(() => {
        const g = BASEMAP.mapbox().getMapboxMap(), f = g.queryRenderedFeatures({ layers: ["olnu-zk-lbl"] }).find((x) => String(x.properties.k) === "1482"); if (!f) return null;
        const an = f.properties.an || "bottom", q = g.project(f.geometry.coordinates), d = { bottom: [0, -1], top: [0, 1], left: [1, 0], right: [-1, 0] }[an] || [0, -1], hits = [];
        for (let s = 10; s < 140; s += 3) { const x = q.x + d[0] * s, y = q.y + d[1] * s; if (g.queryRenderedFeatures([[x - 1, y - 1], [x + 1, y + 1]], { layers: ["olnu-zk-lbl"] }).some((h) => String(h.properties.k) === "1482")) hits.push([x, y]); }
        if (!hits.length) return null; const m = hits[Math.floor(hits.length / 2)], cv = g.getCanvas().getBoundingClientRect();
        const ll = __map.containerPointToLatLng([m[0] + cv.left - __map.getContainer().getBoundingClientRect().left, m[1] + cv.top - __map.getContainer().getBoundingClientRect().top]);
        return { x: m[0] + cv.left, y: m[1] + cv.top, an, under: ZONES._zoneAt(ll.lat, ll.lng).k };
      });
      console.log("I-83 chip " + JSON.stringify(pt));
      await page.screenshot({ path: shotDir + "nightmap-" + TAG + "-i83-before.png" });
      if (pt) { await page.mouse.click(pt.x, pt.y); await wait(page, 2500); await idle(page, 500); }
      const r = await page.evaluate(([a, b2]) => { const ct = __map.getContainer().getBoundingClientRect(), p = (ll) => { const q = __map.latLngToContainerPoint(ll); return { x: Math.round(q.x + ct.left), y: Math.round(q.y + ct.top) }; };
        return { z: +__map.getZoom().toFixed(2), en: p(a), ka: p(b2), tap: ZONES.stats.lastTap, fit: ZONES.stats.fitFr, pill: (document.getElementById("live-count") || {}).textContent }; }, [KUN, KUN2]);
      console.log("I-83 after " + JSON.stringify(r));
      await page.screenshot({ path: shotDir + "nightmap-" + TAG + "-i83-after.png" });
      const inView = (q) => q.x >= 8 && q.x <= 390 - 8 && q.y >= 140 && q.y <= 844 - 190;
      ok(!!pt && inView(r.en), "I-83 town chip tap: Enberg's pin is inside the free map area (below the top bar, above the dock) " + JSON.stringify(r.en) + " tap=" + r.tap);
      ok(!!pt && inView(r.ka) && r.z <= 15.01, "I-83 the chip's other friend (Kalle) in view too, zoom <= 15 (z " + r.z + ")");
      ok(errs.length === 0, "I-83 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "nightmap-" + TAG + "-i83");
    }

    /* ---------- I-81: the arena chip (Hitachi Arena, Marnäs) is a round disc at every zoom it shows (no stretched pill) ---------- */
    if (ONLY.test("i81")) {
      const { ctx, page, errs } = await open(b, { width: 390, height: 844 });
      const res = [];
      for (const z of [12, 13, 13.5, 14, 15, 16]) {
        await view(page, HIT, z, 1500);
        await page.evaluate(() => { try { ARENAPIN._draw(true); } catch (e) {} });
        const r = await page.evaluate(() => [...document.querySelectorAll(".leaflet-arenapins-pane .ap-pin")].filter((e) => getComputedStyle(e.closest(".leaflet-pane")).display !== "none").map((e) => {
          const a = e.getBoundingClientRect(), d = e.querySelector(".ap-i svg, .ap-i .ic-disc") || e.querySelector(".ap-i"), q = d ? d.getBoundingClientRect() : a;
          const inside = q.left >= a.left - 1 && q.right <= a.right + 1 && q.top >= a.top - 1 && q.bottom <= a.bottom + 1;
          return { w: Math.round(a.width), h: Math.round(a.height), ar: +(a.width / Math.max(1, a.height)).toFixed(2), inside, txt: e.textContent.trim().length, c: e.className.replace(/\s+/g, " ") };
        }));
        res.push({ z, r });
        if (z === 13.5) await page.screenshot({ path: shotDir + "nightmap-" + TAG + "-i81-z135.png" });
      }
      console.log("I-81 " + JSON.stringify(res));
      const icon = res.flatMap((x) => x.r.filter((c) => !c.txt).map((c) => Object.assign({ z: x.z }, c)));
      ok(icon.length > 0, "I-81 the quiet arena chip (icon only) shows at Marnäs (" + icon.length + " seen)");
      ok(icon.length > 0 && icon.every((c) => c.ar >= 0.85 && c.ar <= 1.18 && c.inside), "I-81 icon-only arena chip = a round disc (aspect ~1, the disc inside it) at every zoom " + JSON.stringify(icon.map((c) => [c.z, c.w, c.h, c.inside])));
      ok(errs.length === 0, "I-81 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "nightmap-" + TAG + "-i81");
    }

    /* ---------- I-85: Grupper "2 vänner ute nu" shows Enberg's real character (letter cap only for Ida, who has none) ---------- */
    if (ONLY.test("i85")) {
      const { ctx, page, errs } = await open(b, { width: 390, height: 844 });
      await view(page, LUD, 15, 3500);   // the map pins load the characters (avpins)
      await page.evaluate(() => document.getElementById("btn-groups").click()); await wait(page, 2200);
      const r = await page.evaluate(() => { const c = document.querySelector("#inv-pane-g > .pn-out"); if (!c) return null; const f = [...c.querySelectorAll(".pn-out-faces > span")];
        return { t: c.textContent.replace(/\s+/g, " ").trim().slice(0, 60), faces: f.map((s) => s.querySelector("img") ? "img" : s.querySelector("svg") ? "svg" : "?"), w: f[0] ? Math.round(f[0].getBoundingClientRect().width) : 0 }; });
      console.log("I-85 " + JSON.stringify(r));
      await page.screenshot({ path: shotDir + "nightmap-" + TAG + "-i85-grupper.png" });
      ok(!!r && /vänner ute nu/.test(r.t) && r.faces.filter((x) => x === "img").length === 1 && r.faces.includes("svg"), "I-85 'vänner ute nu': Enberg = his character image, the others keep the letter cap " + JSON.stringify(r));
      ok(errs.length === 0, "I-85 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "nightmap-" + TAG + "-i85");
    }
  } catch (e) { ok(false, "crash: " + (e && e.stack || e)); }
  await b.close();
  console.log("nightmap " + TAG + " (" + MODE + "): " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
