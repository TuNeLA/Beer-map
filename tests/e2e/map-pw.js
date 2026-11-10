// map-pw.js — lane "map" (2026-11-10): B9 icon size by screen position, B8 a tap goes to the nearest bar icon,
// M1 no all-kommun border lines (counts stay), M3 pills / markers out of the UI-safe areas, M4 no simulated crowd.
// Real Mapbox when MAPBOX_TEST_TOKEN is set. Without it: a STUB Mapbox (fake pk token; api.mapbox.com answered here with a
// blank style), so the SAME GL bar / zone layers run on any machine (no basemap tiles, no Mapbox load counted).
// node map-pw.js <port> [tag] [only: regex of sections b9|b8|m1|m3|m4]
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t", ONLY = new RegExp(process.argv[4] || ".");
const MODE = TOKEN ? "real" : "stub";
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const ZC = { v: 1, at: new Date().toISOString(), k: 3, total: 23, some: true,
  kommun: [{ c: "0180", n: 15 }, { c: "2061" }, { c: "2080" }, { c: "2085", n: 5, bar: "n3472634175" }, { c: "1480", n: 3 }],
  lan: [{ c: "01", n: 15, top: "0180" }, { c: "14", n: 3, top: "1480" }, { c: "20", n: 8, top: "2085" }] };
const PIT = "n3472634175", LUD = [60.15005, 15.18640];
const shotDir = SP + "logs/";

async function open(b, vp, o = {}) {
  const { ctx, page } = await H.ctxFor(b, vp, {});
  if (o.init) await ctx.addInitScript(o.init);
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify(Object.assign({ v: 1, mapbox_token: TOKEN || STUB_TOKEN }, o.cfg || {})) }));
  await page.route(/rest\/v1\/rpc\/zone_counts/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZC) }));
  if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  // CI: the full "load" event can wait long on remote fonts / CDN: DOM ready is enough (GL is waited for below); one retry
  const url = "https://tunela.github.io/Beer-map/" + (o.q || "");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(async (e) => { console.log("goto retry: " + e.message.split("\n")[0]); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); });
  await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => {
    window.__mpw = {
      gm: () => BASEMAP.mapbox().getMapboxMap(),
      // the icon disc of a bar as GL draws it now (rendered features only: a symbol hidden by collision does not count)
      drawn(id) {
        const g = this.gm(), mk = GLBARS._marker(id); if (!mk) return { kind: "none", why: "no marker" };
        const ll = mk.getLatLng(), p = g.project([ll.lng, ll.lat]);
        const lays = GLBARS._layers().filter((l) => /bar-(full|dot|dote|cdot|cdote|cdotf)$/.test(l) && g.getLayer(l));
        const fs = g.queryRenderedFeatures([[p.x - 2, p.y - 2], [p.x + 2, p.y + 2]], { layers: lays }).filter((f) => String(f.properties.id) === String(id));
        const full = fs.find((f) => /bar-full$/.test(f.layer.id)), dot = fs.find((f) => !/bar-full$/.test(f.layer.id));
        if (full) { const im = GLBARS._img(id), ico = im && im.parts.find((q) => q.sel === ".bar-ico"), fz = full.layer.layout && full.layer.layout["icon-size"];
          return { kind: "full", d: ico ? +((ico.bb[2] - ico.bb[0]) * (typeof fz === "number" ? fz : (+full.properties.sz || 1))).toFixed(2) : -1, x: p.x, y: p.y }; }
        if (dot) {
          const di = String(dot.properties.di || ""), m = /^dot-([\w-]+)-(quiet|busy|lit)$/.exec(di);
          let r = 0;
          if (m) { const st = m[2], s = { k: m[1] }; if (st === "busy") { s.p = {}; s.hot = true; } if (st === "lit") s.lit = true;
            const ico = PNPINS.barOps(s, "d", false).parts.find((q) => q.sel === ".bar-ico"); r = ico ? ico.bb[2] - ico.bb[0] : 0; }
          const sz = dot.layer.layout && dot.layer.layout["icon-size"];
          return { kind: "dot", d: +(r * (typeof sz === "number" ? sz : 1)).toFixed(2), di, x: p.x, y: p.y };
        }
        return { kind: "none", x: p.x, y: p.y };
      },
      title() { const t = document.querySelector(".olnu-sheet .pp-title, .leaflet-popup .pp-title, #sheet .pp-title"); return t ? t.textContent.trim() : ""; },
    };
  });
  return { ctx, page, errs };
}
async function idle(page, ms) {
  await page.waitForFunction(() => { const g = __mpw.gm(); return g.loaded() && !g.isMoving(); }, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  if (ms) await wait(page, ms);
}
async function view(page, ll, z, ms) { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await idle(page, ms == null ? 900 : ms); }
// put the bar at container point (x, y): one short pan (moveend → tier pass + GL sync), like a slow finger pan
async function barTo(page, id, x, y) {
  await page.evaluate(([id, x, y]) => {
    const mk = GLBARS._marker(id); if (!mk) return;
    const p = __map.latLngToContainerPoint(mk.getLatLng()), s = __map.getSize();
    __map.setView(__map.containerPointToLatLng([s.x / 2 + (p.x - x), s.y / 2 + (p.y - y)]), __map.getZoom(), { animate: false });
  }, [id, x, y]);
  await idle(page, 260);   // > the 180 ms symbol fade (M2): a tier change cross-fades pill and dot
}
async function closeAll(page) {
  await page.evaluate(() => { try { const c = document.querySelector("#sheet-close"); if (c && c.offsetParent) c.click(); } catch (e) {} __map.closePopup(); });
  await wait(page, 500);
}

(async () => {
  console.log("MODE " + MODE + (MODE === "stub" ? " (no MAPBOX_TEST_TOKEN: blank stub basemap, real GL layers)" : ""));
  const b = await chromium.launch(launchOpts([]));
  try {
    /* ---------- B9: one bar panned across the whole viewport keeps one icon size (± 1 px) ---------- */
    if (ONLY.test("b9")) for (const vp of [{ width: 390, height: 844 }]) {
      const { ctx, page, errs } = await open(b, vp);
      // the bars to pan: one quiet and one busy bar that are NOT "mine" (my / friends' bars always get the full pill)
      await view(page, LUD, 17, 2500);
      const pick = await page.evaluate(() => {
        const mine = (window.MYPINS && MYPINS.ids && MYPINS.ids()) || {}, vs = (GLBARS._view() || []).filter((v) => !mine[v.id] && !v.friend && !v.sel);
        const bar = (v) => { const b = BARS.byId(v.id); return b && !b.place && /^(pub|bar|biergarten|nightclub)$/.test(b.type || "pub"); };
        const q = vs.filter((v) => bar(v) && !v.n)[0], h = vs.filter((v) => bar(v) && v.n > 0)[0];
        return [q && q.id, h && h.id].filter(Boolean);
      });
      console.log("B9 bars " + JSON.stringify(pick));
      ok(pick.length >= 1, "B9 found a quiet / busy bar that is not mine in Ludvika (" + pick.join(", ") + ")");
      for (const [id, z] of pick.map((id) => [id, 18]).concat(pick.slice(0, 1).map((id) => [id, 16]))) {
        await view(page, LUD, z, 1500);
        await page.waitForFunction((id) => !!GLBARS._marker(id), id, { timeout: 15000 }).catch(() => {});
        const S = await page.evaluate(() => { const s = __map.getSize(); return { w: s.x, h: s.y }; });
        const rows = [], seen = {}; let lo = 1e9, hi = -1e9, none = 0, n = 0;
        for (let y = 24; y <= S.h - 24; y += 52) {
          const xs = []; for (let x = 16; x <= S.w - 16; x += 38) xs.push(x);
          if ((rows.length & 1)) xs.reverse();   // a slow zig-zag pan over the whole screen
          let line = "";
          for (const x of xs) {
            await barTo(page, id, x, y);
            const d = await page.evaluate((id) => __mpw.drawn(id), id); n++;
            if (d.kind === "none") { none++; line += "  -- "; continue; }
            lo = Math.min(lo, d.d); hi = Math.max(hi, d.d); seen[d.kind + ":" + d.d] = (seen[d.kind + ":" + d.d] || 0) + 1;
            line += String(Math.round(d.d)).padStart(4) + (d.kind === "full" ? "f" : "d");
          }
          rows.push("y" + String(y).padStart(4) + line);
        }
        console.log("B9 " + id + " z" + z + " icon diameter per screen position (f = full, d = dot):\n" + rows.join("\n"));
        await barTo(page, id, S.w * 0.6, 150); await page.screenshot({ path: shotDir + "map-" + TAG + "-b9-" + id + "-z" + z + "-top.png" });
        ok(hi - lo <= 1 && none === 0, "B9 z" + z + ": " + id + " keeps ONE icon size at all " + n + " screen positions (min " + lo + ", max " + hi + ", hidden " + none + ", " + JSON.stringify(seen) + ")");
      }
      ok(errs.length === 0, "B9 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-b9");
    }

    /* ---------- shots (no checks): B9 view at 360 / 390 / 430 (Lobbybaren in the top band), Stockholm z15 density ---------- */
    if (ONLY.test("sh")) for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
      const { ctx, page } = await open(b, vp);
      await view(page, LUD, 18, 2500);
      await barTo(page, "x-lobbybaren-ludvika", vp.width * 0.55, 140); await idle(page, 800);
      const d = await page.evaluate(() => __mpw.drawn("x-lobbybaren-ludvika"));
      console.log("SHOT b9 " + vp.width + " " + JSON.stringify(d));
      await page.screenshot({ path: shotDir + "map-" + TAG + "-sh-b9-" + vp.width + ".png" });
      await view(page, [59.3165, 18.0720], 15, 3500);
      const n = await page.evaluate(() => { const v = GLBARS._view() || []; return { inView: v.length, shown: v.filter((x) => x.shown).length, full: v.filter((x) => x.full).length }; });
      console.log("SHOT sthlm-z15 " + vp.width + " " + JSON.stringify(n));
      await page.screenshot({ path: shotDir + "map-" + TAG + "-sh-sthlm-z15-" + vp.width + ".png" });
      await closeCounted(ctx, page, "map-" + TAG + "-sh");
    }

    /* ---------- M2: a full zoom sweep (Leaflet 18 → 11.5 in 0.1 steps) has no size jumps; symbols fade ---------- */
    if (ONLY.test("m2")) {
      const { ctx, page, errs } = await open(b, { width: 390, height: 844 });
      await view(page, LUD, 18, 2500);
      const ids = [PIT, "x-lobbybaren-ludvika", "x-la-parma-ludvika"], series = {}; ids.forEach((id) => (series[id] = []));   // La Parma: a full pill down to the town view
      for (let z10 = 180; z10 >= 115; z10--) {
        const z = z10 / 10;
        await page.evaluate(([ll, z]) => { __map.setView(ll, z, { animate: false }); }, [LUD, z]);
        await idle(page, 140);
        const d = await page.evaluate((ids) => ids.map((id) => __mpw.drawn(id)), ids);
        ids.forEach((id, i) => series[id].push([z, d[i].kind, d[i].d]));
      }
      for (const id of ids) {
        const sr = series[id]; let worst = 0, at = "", n = 0;
        for (let i = 1; i < sr.length; i++) { const a = sr[i - 1], c = sr[i]; if (a[1] === "none" || c[1] === "none" || !(a[2] > 0) || !(c[2] > 0)) continue; n++;
          const j = Math.abs(c[2] - a[2]) / a[2]; if (j > worst) { worst = j; at = a[0] + "→" + c[0] + " (" + a[1] + " " + a[2] + " → " + c[1] + " " + c[2] + ")"; } }
        console.log("M2 " + id + " " + sr.filter((x, i) => i % 5 === 0).map((x) => x[0] + ":" + x[1][0] + Math.round(x[2])).join(" "));
        if (id === "x-la-parma-ludvika") ok(sr.filter((x) => x[1] !== "none").map((x) => x[0]).some((z) => z <= 12.5), "M2 La Parma is drawn down to the town view (Leaflet <= 12.5) (" + sr.filter((x) => x[1] !== "none").length + " zooms)");
        ok(n >= 20 && worst <= 0.06, "M2 " + id + ": no size jump > 6 % between 0.1 zoom steps (" + n + " pairs, worst " + (worst * 100).toFixed(1) + " % at " + at + ")");
      }
      const fade = await page.evaluate(() => { const g = __mpw.gm(); return g._fadeDuration != null ? g._fadeDuration : (g.style && g.style.fadeDuration); });
      ok(fade >= 100, "M2: symbols fade in / out (fadeDuration " + fade + " ms), clusters do not pop");
      for (const z of [12, 14, 15.5, 17]) { await view(page, LUD, z, 1200); await page.screenshot({ path: shotDir + "map-" + TAG + "-m2-z" + z + ".png" }); }
      ok(errs.length === 0, "M2 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-m2");
    }

    /* ---------- BR1: venue types (classifier, glyphs at 24 px, all 14 on the map, name badges) ---------- */
    if (ONLY.test("br1")) {
      const { ctx, page, errs } = await open(b, { width: 390, height: 844 }, { init: () => { try { localStorage.setItem("olnu.map.ute", "1"); } catch (e) {} } });
      const has = await page.evaluate(() => !!window.PNVTYPE);
      ok(has, "BR1: the venue type classifier (window.PNVTYPE) is there");
      if (has) {
        const CASES = [
          [{ amenity: "bar" }, "Badhytten", "bar"], [{ amenity: "pub" }, "Shakespeare Pub", "pub"], [{ amenity: "bar", cocktails: "yes" }, "X", "cocktail"],
          [{ amenity: "bar" }, "Cocktailbaren", "cocktail"], [{ amenity: "bar", "drink:wine": "yes" }, "Y", "vinbar"], [{ amenity: "bar" }, "Vinbaren", "vinbar"],
          [{ amenity: "bar", bar: "wine_bar" }, "F", "vinbar"], [{ amenity: "bar" }, "Vincents", "bar"], [{ amenity: "pub", microbrewery: "yes" }, "Z", "olbar"],
          [{ amenity: "pub" }, "Ludvika Bryggeri", "olbar"], [{ amenity: "bar" }, "BrewDog Stockholm", "olbar"], [{ amenity: "nightclub" }, "Solo", "nattklubb"],
          [{ amenity: "bar", sport: "soccer" }, "A", "sportbar"], [{ amenity: "pub" }, "Sportbaren", "sportbar"], [{ amenity: "bar" }, "Karaoke Kungen", "karaoke"],
          [{ amenity: "bar", karaoke: "yes" }, "B", "karaoke"], [{ amenity: "music_venue" }, "Musikens Hus", "livescen"], [{ amenity: "pub" }, "Jazzklubben Fasching", "livescen"],
          [{ amenity: "pub", live_music: "yes" }, "Kvarnen", "pub"], [{ amenity: "pub" }, "Liverpool Pub", "pub"], [{ amenity: "bar" }, "Shuffle Bar", "spelbar"],
          [{ amenity: "bar" }, "Boulebar Rålis", "spelbar"], [{ amenity: "pub" }, "Västgöta Nation", "nation"], [{ amenity: "bar" }, "Lobbybaren (Grand Hotel Elektra)", "hotellbar"],
          [{ amenity: "bar", tourism: "hotel" }, "C", "hotellbar"], [{ amenity: "biergarten" }, "D", "oltradgard"], [{ amenity: "restaurant_bar" }, "E", "restbar"], [{ amenity: "restaurant" }, "Blackstone Steakhouse", "restaurant"],
          [{ amenity: "pub" }, "Pitchers", "pub"], [{ amenity: "bar" }, "Speakeasy 23", "cocktail"], [{ amenity: "bar" }, "Sky Bar", "bar"]];
        const res = await page.evaluate((C) => C.map((c) => [c[1], c[2], PNVTYPE.classify(c[0], c[1])]), CASES);
        const wrong = res.filter((r) => r[1] !== r[2]);
        ok(wrong.length === 0, "BR1: classifier gives the right type for " + res.length + " cases (wrong: " + JSON.stringify(wrong) + ")");
        const fl = await page.evaluate(() => [PNVTYPE.flags({ live_music: "yes" }).live, PNVTYPE.flags({ lgbtq: "primary" }).lgbtq, PNVTYPE.flags({ outdoor_seating: "roof" }).roof, PNVTYPE.flags({ name: "Sky Bar" }).roof]);
        ok(fl.every((x) => x === 1), "BR1: badge flags from tags: live music, HBTQ+, rooftop (" + JSON.stringify(fl) + ")");
        const spread = await page.evaluate(async () => { const r = await fetch("./bars.json"); const list = await r.json(); const o = {}; list.forEach((x) => { const k = PNVTYPE.of(x); o[k] = (o[k] || 0) + 1; }); return o; });
        console.log("BR1 bars.json types " + JSON.stringify(spread));
        ok((spread.cocktail || 0) < 60 && (spread.bar || 0) > 250, "BR1: OSM 'bar' is the generic Bar now, not a martini (cocktail " + (spread.cocktail || 0) + ", bar " + (spread.bar || 0) + ")");
        // glyphs at a 24 px disc (glyph 13.5 px): tint contrast >= 3:1 on navy, coverage 12–75 %, distinct shapes (mask IoU < 0.8)
        const gl = await page.evaluate(() => {
          const G = PNGLYPHS, T = PNTOKENS, P = PNPINS, cats = G.CATS.concat(G.PLACES), px = 27, out = { cats, low: [], cov: {}, iou: [], miss: [] };
          const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
          const navy = lum(T.col.navy), masks = {};
          cats.forEach((k) => {
            if (!G.G[k]) { out.miss.push(k); return; }
            const t = T.tint[k] || "#FFFAF0", L1 = Math.max(lum(t), navy), L2 = Math.min(lum(t), navy); if ((L1 + 0.05) / (L2 + 0.05) < 3) out.low.push(k);
            const r = P.raster([{ o: "rr", x: -9, y: -9, w: 18, h: 18, r: 0, fill: "#000000" }, { o: "g", n: k, x: -9, y: -9, s: 18, fg: "#FFFFFF", bg: "#000000" }], px / 18, [-9, -9, 9, 9]);
            const d = r.canvas.getContext("2d").getImageData(0, 0, r.canvas.width, r.canvas.height).data, m = [];
            for (let i = 0; i < d.length; i += 4) m.push(d[i] > 128 ? 1 : 0);
            masks[k] = m; out.cov[k] = +(m.reduce((a, b) => a + b, 0) / m.length).toFixed(2);
          });
          const ks = Object.keys(masks);
          for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const a = masks[ks[i]], c = masks[ks[j]]; let I = 0, U = 0; for (let q = 0; q < a.length; q++) { I += a[q] & c[q]; U += a[q] | c[q]; } const v = U ? I / U : 0; if (v >= 0.8) out.iou.push(ks[i] + "~" + ks[j] + " " + v.toFixed(2)); }
          // contact sheet: every type as a dot (24 px) and a full pill disc (32 px), on the page
          const box = document.createElement("div"); box.id = "br1-sheet"; box.style.cssText = "position:fixed;left:0;top:120px;right:0;z-index:99999;background:#2b3260;padding:8px;display:grid;grid-template-columns:repeat(6,1fr);gap:6px;font:11px sans-serif;color:#fff";
          cats.forEach((k) => { const cell = document.createElement("div"); cell.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px";
            [24, 32].forEach((dpx) => { const ops = G.PLACES.indexOf(k) >= 0 ? P.placeOps(k).ops : P.barOps({ k: k }, "d", false).ops, rr = P.raster(ops, 2 * dpx / 32); rr.canvas.style.width = (rr.canvas.width / 2) + "px"; cell.appendChild(rr.canvas); });
            const t = document.createElement("span"); t.textContent = k; cell.appendChild(t); box.appendChild(cell); });
          document.body.appendChild(box);
          return out;
        });
        console.log("BR1 glyphs " + JSON.stringify(gl));
        ok(gl.miss.length === 0 && gl.cats.length >= 18, "BR1: all glyphs exist (14 bar types + 4 places: " + gl.cats.join(", ") + "; missing " + JSON.stringify(gl.miss) + ")");
        ok(gl.low.length === 0, "BR1: every tint has >= 3:1 contrast on the navy disc (" + JSON.stringify(gl.low) + ")");
        const badCov = Object.keys(gl.cov).filter((k) => gl.cov[k] < 0.12 || gl.cov[k] > 0.75);
        ok(badCov.length === 0, "BR1: every glyph fills 12–75 % of its box at 24 px (" + JSON.stringify(gl.cov) + ")");
        ok(gl.iou.length === 0, "BR1: no two glyphs look the same at 24 px (mask IoU >= 0.8: " + JSON.stringify(gl.iou) + ")");
        await page.screenshot({ path: shotDir + "map-" + TAG + "-br1-sheet.png" });
        await page.evaluate(() => document.getElementById("br1-sheet").remove());
        // all 14 types on the map (an empty spot, Leaflet z17), with their own glyph; one bar with name badges
        const P0 = await page.evaluate(() => { for (const c of [[60.1660, 15.2290], [60.1395, 15.1580], [60.1720, 15.1500]]) { const a = BARS.around(c[0], c[1], 400); if (!a.bars.length && !a.places.length) return c; } return [60.1660, 15.2290]; });
        await view(page, P0, 17, 300);
        const ids = await page.evaluate((p) => {
          const keys = PNVTYPE.ORDER.filter((k) => k !== "restbar").concat(["restbar"]), o = [], c0 = __map.latLngToContainerPoint(p);
          keys.forEach((k, i) => { const col = i % 3, row = Math.floor(i / 3), ll = __map.containerPointToLatLng([c0.x - 120 + col * 120, c0.y - 230 + row * 92]);
            const b = { id: "x-br1-" + k, name: PNVTYPE.LABEL[k], lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), type: k === "pub" ? "pub" : k === "nattklubb" ? "nightclub" : "bar", vt: k };
            if (k === "pub") { b.outdoor = 1; b.live = 1; } BARS.addUser(b); o.push([b.id, k]); });
          return o;
        }, P0);
        await view(page, P0, 17, 2500);
        const on = await page.evaluate((ids) => ids.map(([id, k]) => { const v = GLBARS._vt(id); const cat = PNPINS.cat(k); return [k, v ? v.k : null, v ? v.at : null, cat]; }), ids);
        console.log("BR1 map " + JSON.stringify(on));
        await page.screenshot({ path: shotDir + "map-" + TAG + "-br1-map-z17.png" });
        ok(on.length === 14 && on.every((x) => x[1] === x[0]), "BR1: all 14 bar types drawn on the map with their own glyph (" + on.filter((x) => x[1] !== x[0]).map((x) => x[0]).join(",") + ")");
        ok(on.some((x) => x[0] === "pub" && x[2] === "sn"), "BR1: name badges uteservering + live music in front of the name (" + JSON.stringify(on.filter((x) => x[0] === "pub")) + ")");
      }
      ok(errs.length === 0, "BR1 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-br1");
    }

    /* ---------- R1 map items: 2-line names (R1-33), arena chip tap box (R1-34), ⓘ credit line (R1-36), Kartstil control (R1-16) ---------- */
    if (ONLY.test("r1")) {
      const { ctx, page, errs } = await open(b, { width: 360, height: 780 });
      const nm = await page.evaluate(() => { const name = "La Parma Pub & Restaurang", x = PNPINS.labelOps(name), t = x.ops.filter((o) => o.o === "t").map((o) => o.t);
        return { t, whole: t.join(" ").replace(/\s+/g, " ") === name && !t.some((s) => /…/.test(s)) }; });
      ok(nm.whole, "R1-33: a long bar name is drawn whole (" + JSON.stringify(nm.t) + ")");
      await view(page, LUD, 17, 2500);
      await page.screenshot({ path: shotDir + "map-" + TAG + "-r1-33-names-360.png" });
      // R1-34: Hitachi Arena chip, Leaflet z16: a tap 18 px off its centre (all 4 sides) still hits the chip
      await view(page, [60.1512, 15.20877], 16, 2500);
      await page.waitForFunction(() => !!document.querySelector(".ap-pin"), null, { timeout: 10000 }).catch(() => console.log("no arena chip"));
      const hb = await page.evaluate(() => { const e = [...document.querySelectorAll(".ap-pin")].find((x) => /Hitachi/.test(x.textContent)) || document.querySelector(".ap-pin"); if (!e) return null;
        const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, hit = (x, y) => { const t = document.elementFromPoint(x, y); return !!(t && t.closest(".ap-pin") === e); };
        return { box: [Math.round(r.width), Math.round(r.height)], txt: e.textContent.trim(), sides: [hit(cx - 21, cy), hit(cx + 21, cy), hit(cx, cy - 21), hit(cx, cy + 21)] }; });
      console.log("R1-34 " + JSON.stringify(hb));
      await page.screenshot({ path: shotDir + "map-" + TAG + "-r1-34-arena-360.png" });
      ok(hb && hb.sides.every(Boolean), "R1-34: the arena chip takes a tap 21 px from its centre on all 4 sides (44 px box) (" + JSON.stringify(hb) + ")");
      // R1-36: the SCB credit sits on the map credit's line, not alone after the legend
      const cr = await page.evaluate(() => { document.getElementById("btn-attrib").click(); const pop = document.getElementById("attrib-pop"), z = pop.querySelector(".zn-credit");
        const p = z && z.previousElementSibling; return { prev: p ? p.className : null, text: pop.textContent.replace(/\s+/g, " ").slice(0, 300) }; });
      await wait(page, 300);
      await page.screenshot({ path: shotDir + "map-" + TAG + "-r1-36-info-360.png" });
      console.log("R1-36 " + JSON.stringify(cr));
      ok(cr.prev === "bm-credit", "R1-36: '| Gränser: SCB' follows the map credit on its line (" + JSON.stringify(cr.prev) + ")");
      await page.evaluate(() => { const p = document.getElementById("attrib-pop"); p.hidden = true; });
      // R1-16: Kartstil = the one segmented control; the tip badge >= 12 px; items >= 44 px
      const ks = await page.evaluate(() => { const sh = document.createElement("div"); sh.className = "sheet"; sh.id = "r1-ks"; sh.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:16px;background:var(--ds-sheet,#121a2a)";
        const body = document.createElement("div"); sh.appendChild(body); document.body.appendChild(sh); BASEMAP.settingsSheet(body);
        const seg = body.querySelector("[role=radiogroup]"), bs = seg ? [...seg.querySelectorAll("button")] : [], tip = seg && seg.querySelector(".bm-b");
        return { cls: seg ? seg.className : null, n: bs.length, h: bs.map((x) => Math.round(x.getBoundingClientRect().height)), tipPx: tip ? parseFloat(getComputedStyle(tip).fontSize) : null }; });
      await wait(page, 300);
      await page.screenshot({ path: shotDir + "map-" + TAG + "-r1-16-kartstil-360.png" });
      console.log("R1-16 " + JSON.stringify(ks));
      ok(/\bds-seg\b/.test(ks.cls || "") && ks.n >= 2 && ks.h.every((h) => h >= 44) && ks.tipPx >= 12, "R1-16: Kartstil is the segmented control, items >= 44 px, 'Chefens val' >= 12 px (" + JSON.stringify(ks) + ")");
      ok(errs.length === 0, "R1 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-r1");
    }

    /* ---------- town zoom (owner 10 Nov green-bar.jpg): a bar with friends = ONE visible pill, nothing peeking out behind it ---------- */
    if (ONLY.test("tz")) for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
      const { ctx, page, errs } = await open(b, vp);
      for (const z of [10.8, 11.6]) {
        await view(page, LUD, z, 2500);
        await page.waitForFunction(() => !!document.querySelector(".leaflet-mypins-pane .mp-pin"), null, { timeout: 8000 }).catch(() => console.log("no my-pin chip"));
        await wait(page, 1600);   // mypins re-checks people under its chips at least every 1.5 s
        const d = await page.evaluate(() => {
          const out = { chips: [], bad: [] };
          document.querySelectorAll(".leaflet-mypins-pane .mp-pin").forEach((e) => {
            const r = e.getBoundingClientRect(), af = getComputedStyle(e, "::after"), bw = parseFloat(af.borderTopWidth) || 0;
            out.chips.push(e.textContent.trim() + " " + [r.left, r.top, r.width, r.height].map(Math.round).join(","));
            if (bw > 0 && af.borderTopColor !== "rgba(0, 0, 0, 0)") out.bad.push(e.textContent.trim() + ": a " + bw + " px band (::after border) around the chip");
            document.querySelectorAll(".leaflet-marker-icon > .pn-cl, .leaflet-marker-icon > .pn-p").forEach((p) => {
              const q = p.getBoundingClientRect(), st = getComputedStyle(p.parentNode); if (!q.width || st.visibility === "hidden" || st.display === "none" || getComputedStyle(p).visibility === "hidden") return;
              if (q.left < r.right && q.right > r.left && q.top < r.bottom + 8 && q.bottom > r.top - 8) out.bad.push(e.textContent.trim() + ": a people " + (p.classList.contains("pn-cl") ? "cluster" : "pin") + " peeks out behind it " + JSON.stringify({ chip: [r.left, r.top, r.right, r.bottom].map(Math.round), it: [q.left, q.top, q.right, q.bottom].map(Math.round), cls: p.parentNode.className, under: document.querySelectorAll(".mp-under").length }));
            });
          });
          return out;
        });
        console.log("TZ " + vp.width + " z" + z + " " + JSON.stringify(d));
        const c = await page.evaluate(() => { const e = document.querySelector(".leaflet-mypins-pane .mp-pin"); const r = e ? e.getBoundingClientRect() : null; return r ? { x: Math.max(0, r.left - 60), y: Math.max(0, r.top - 60), width: Math.min(innerWidth - Math.max(0, r.left - 60), r.width + 120), height: r.height + 120 } : null; });
        await page.screenshot(Object.assign({ path: shotDir + "map-" + TAG + "-tz-" + vp.width + "-z" + z + ".png" }, c ? { clip: c } : {}));
        ok(d.chips.length > 0 && d.bad.length === 0, "town zoom " + vp.width + " z" + z + ": a bar with friends = one visible pill, nothing peeking out behind it (" + JSON.stringify(d.bad) + ")");
      }
      ok(errs.length === 0, "town zoom " + vp.width + " no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-tz");
    }

    /* ---------- B8: 2 close bars; A's long name points at B; a tap near B's icon opens B (3 zooms) ---------- */
    if (ONLY.test("b8")) {
      const { ctx, page, errs } = await open(b, { width: 390, height: 844 });
      // an empty spot (no bar or place within 300 m)
      const P0 = await page.evaluate(() => {
        for (const c of [[60.1660, 15.2290], [60.1395, 15.1580], [60.1720, 15.1500], [60.1300, 15.2400]]) {
          const a = BARS.around(c[0], c[1], 300); if (!a.bars.length && !a.places.length) return c;
        }
        return [60.1660, 15.2290];
      });
      const NA = "Gamla Bryggeriets Ölstuga och Nattklubb";
      await page.evaluate(([p, na]) => { BARS.addUser({ id: "x-mpw-a", name: na, lat: p[0], lng: p[1], type: "pub" }); }, [P0, NA]);
      for (const z of [16, 17, 18]) {
        await view(page, P0, z, 400);
        // B sits right of A and a bit lower: at A's name row (the name runs from A towards B's icon)
        const idB = "x-mpw-b" + z, NB = { 16: "Tullen", 17: "Sjöboden", 18: "Hamnkrogen" }[z];   // different first words (BARS de-duplicates similar names)
        await page.evaluate(([p, idB, nb]) => {
          const a = __map.latLngToContainerPoint(p), ll = __map.containerPointToLatLng([a.x + 40, a.y + 24]);
          BARS.closeIds(["x-mpw-b16", "x-mpw-b17", "x-mpw-b18"].filter((x) => x < idB));   // only the earlier B (a closed id never comes back)
          BARS.addUser({ id: idB, name: nb, lat: +ll.lat.toFixed(7), lng: +ll.lng.toFixed(7), type: "bar" });
        }, [P0, idB, NB]);
        await view(page, P0, z, 1600);
        const st = await page.evaluate(([idB]) => ({ a: __mpw.drawn("x-mpw-a"), b: __mpw.drawn(idB),
          lblA: (GLBARS._view() || []).filter((v) => v.id === "x-mpw-a").map((v) => v.lbl)[0] }), [idB]);
        console.log("B8 z" + z + " " + JSON.stringify(st));
        await page.screenshot({ path: shotDir + "map-" + TAG + "-b8-z" + z + ".png" });
        let good = 0, tries = 0; const got = [];
        for (const [dx, dy] of [[0, 0], [-7, 0], [-5, 5], [0, 7], [6, -4]]) {
          await closeAll(page);
          const pt = await page.evaluate(([idB, dx, dy]) => { const mk = GLBARS._marker(idB) || null, g = __mpw.gm(), c = g.getCanvas().getBoundingClientRect();
            const ll = mk ? mk.getLatLng() : null, q = ll ? g.project([ll.lng, ll.lat]) : null; return q ? { x: c.left + q.x + dx, y: c.top + q.y + dy } : null; }, [idB, dx, dy]);
          if (!pt) { tries++; got.push("no B marker"); continue; }
          await page.touchscreen.tap(Math.round(pt.x), Math.round(pt.y));
          await page.waitForFunction(() => !!__mpw.title(), null, { timeout: 4000 }).catch(() => {});
          const t = await page.evaluate(() => __mpw.title()); tries++; got.push(dx + "," + dy + "→" + (t || "nothing"));
          if (t === NB) good++;
        }
        ok(st.b.kind !== "none", "B8 z" + z + ": B's icon is drawn although A's long name runs into it (" + st.b.kind + ")");
        ok(good === tries, "B8 z" + z + ": a tap on / next to B's icon (" + tries + " points, A's long name runs into it) opens B: " + got.join(" | "));
        await closeAll(page);
      }
      ok(errs.length === 0, "B8 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-b8");
    }

    /* ---------- M1: no all-kommun border lines zoomed out; zone counts + soft fill stay ---------- */
    if (ONLY.test("m1")) for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
      const { ctx, page, errs } = await open(b, vp);
      await view(page, [60.15, 15.19], 8, 600);
      await page.waitForFunction(() => window.ZONES && ZONES._geo && ZONES._geo().k && ZONES._counts(), null, { timeout: 30000 }).catch(() => console.log("zones late"));
      await page.waitForFunction(() => __mpw.gm().getLayer("olnu-zk-fill") && __mpw.gm().queryRenderedFeatures({ layers: ["olnu-zk-fill"] }).length > 0, null, { timeout: 20000 }).catch(() => console.log("no kommun fill yet"));
      await idle(page, 1500);
      await page.screenshot({ path: shotDir + "map-" + TAG + "-m1-z8-" + vp.width + ".png" });
      const d = await page.evaluate(() => {
        const g = __mpw.gm(), ids = (g.getStyle().layers || []).map((l) => l.id).filter((id) => /^olnu-zk/.test(id));
        const r = (id) => (g.getLayer(id) ? g.queryRenderedFeatures({ layers: [id] }).length : -1);
        const lines = ids.filter((id) => g.getLayer(id).type === "line");
        const out = { ids, lines: {}, fill: r("olnu-zk-fill"), lbl: r("olnu-zk-lbl"), pill: (document.getElementById("live-count") || {}).textContent || "" };
        // a kommun line layer that draws (opacity > 0) for more than one kommun = "all-kommun lines"
        lines.forEach((id) => { const fs = g.queryRenderedFeatures({ layers: [id] }); const ks = new Set(fs.map((f) => f.id)); let op = 1; try { const v = fs[0] && fs[0].layer.paint["line-opacity"]; if (typeof v === "number") op = v; } catch (e) {} out.lines[id] = { kommuner: ks.size, op: +(+op).toFixed(2), glow: /glow/.test(id) }; });
        return out;
      });
      console.log("M1 " + vp.width + " " + JSON.stringify(d));
      const many = Object.keys(d.lines).filter((id) => !d.lines[id].glow && d.lines[id].kommuner > 1 && d.lines[id].op > 0.02);
      ok(many.length === 0, "M1 " + vp.width + ": no kommun border line layer draws more than 1 kommun at kommun zoom (" + JSON.stringify(d.lines) + ")");
      ok(d.fill > 0, "M1 " + vp.width + ": the soft fill for kommuner with people out is still drawn (" + d.fill + ")");
      ok(d.lbl > 0 && /(Ludvika|Dalarna) · (\d+|några|lugnt)/.test(d.pill), "M1 " + vp.width + ": zone counts stay (kommun labels " + d.lbl + ", top pill '" + d.pill + "')");
      ok(errs.length === 0, "M1 " + vp.width + " no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-m1");
    }
    // M1 version (b) for the owner: one faint outline, the kommun you are in (zones.js KOMMUN_OUTLINE = "mine")
    if (ONLY.test("m1")) for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
      const { ctx, page, errs } = await open(b, vp, { init: () => { try { localStorage.setItem("olnu.map.kline", "mine"); } catch (e) {} } });
      const has = await page.evaluate(() => !!(window.ZONES && ZONES._outline));
      if (!has) { console.log("M1b skip: no KOMMUN_OUTLINE switch in this build"); await ctx.close(); break; }
      await view(page, [60.15, 15.19], 8, 600);
      await page.waitForFunction(() => __mpw.gm().getLayer("olnu-zk-you-line") && __mpw.gm().queryRenderedFeatures({ layers: ["olnu-zk-you-line"] }).length > 0, null, { timeout: 25000 }).catch(() => console.log("no own outline yet"));
      await idle(page, 1500);
      await page.screenshot({ path: shotDir + "map-" + TAG + "-m1b-z8-" + vp.width + ".png" });
      const d = await page.evaluate(() => { const g = __mpw.gm(), fs = g.getLayer("olnu-zk-you-line") ? g.queryRenderedFeatures({ layers: ["olnu-zk-you-line"] }) : [];
        return { mode: ZONES._outline(), kommuner: new Set(fs.map((f) => f.properties.k)).size, all: g.getLayer("olnu-zk-line") ? 1 : 0, pill: (document.getElementById("live-count") || {}).textContent || "" }; });
      console.log("M1b " + vp.width + " " + JSON.stringify(d));
      ok(d.mode === "mine" && d.kommuner === 1 && !d.all, "M1b " + vp.width + ": version (b) draws ONE faint outline (the kommun I am in), no all-kommun lines (" + JSON.stringify(d) + ")");
      ok(errs.length === 0, "M1b " + vp.width + " no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-m1b");
    }

    /* ---------- M3: zone labels, my-pin chips and bar pills stay out of the UI-safe areas (icons keep their size) ---------- */
    if (ONLY.test("m3")) for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
      const { ctx, page, errs } = await open(b, vp);
      const UI = ".topbar, .ticker, .hud-left > *, .pn-rail, #btn-more, #btn-locate, #btn-attrib, #other-wrap, .dock";
      for (const [nm, ll, z] of [["falun", [60.40, 15.30], 8.6], ["smedjebacken", [60.14, 15.42], 9.2], ["dalarna-e", [60.45, 15.75], 8.4], ["ludvika-edge", [60.16, 15.42], 9.8]]) {
        await view(page, ll, z, 500);
        await page.waitForFunction(() => window.ZONES && ZONES._geo().k && ZONES._counts() && __mpw.gm().getLayer("olnu-zk-lbl"), null, { timeout: 30000 }).catch(() => console.log("zones late"));
        await page.evaluate(() => { __map.panBy([1, 0], { animate: false }); }); await idle(page, 1800);   // one more moveend (labels placed after the chips)
        const d = await page.evaluate((UI) => {
          const g = __mpw.gm(), cv = g.getCanvas().getBoundingClientRect(), R = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
          const ui = [...document.querySelectorAll(UI)].filter((e) => { const r = e.getBoundingClientRect(), st = getComputedStyle(e); return r.width > 4 && r.height > 4 && st.visibility !== "hidden" && st.display !== "none" && +st.opacity > 0.1; })
            .map((e) => Object.assign(R(e.getBoundingClientRect()), { n: e.id || String(e.className).split(" ")[0] }));
          const pins = [...document.querySelectorAll(".mp-pin")].map((e) => Object.assign(R(e.getBoundingClientRect()), { n: "pin " + e.textContent }));
          const lays = ["olnu-zk-lbl", "olnu-zl-lbl", "olnu-zl-lblq", "olnu-zl-lblc"].filter((l) => g.getLayer(l));
          const labels = g.queryRenderedFeatures({ layers: lays }).map((f) => {
            const q = g.project(f.geometry.coordinates), lay = f.layer.layout || {}, id = lay["icon-image"] && (lay["icon-image"].name || lay["icon-image"]);
            let w = 100, h = 48, src = "guess"; try { const im = g.style.getImage(String(id)); if (im && im.data) { w = im.data.width / (im.pixelRatio || 1); h = im.data.height / (im.pixelRatio || 1); src = "img"; } } catch (e) {}
            const an = lay["icon-anchor"] || "bottom", off = lay["icon-offset"] || [0, -10], ox = q.x + cv.left + off[0], oy = q.y + cv.top + off[1];
            const box = an === "top" ? { l: ox - w / 2, t: oy, r: ox + w / 2, b: oy + h } : an === "left" ? { l: ox, t: oy - h / 2, r: ox + w, b: oy + h / 2 } : an === "right" ? { l: ox - w, t: oy - h / 2, r: ox, b: oy + h / 2 } : { l: ox - w / 2, t: oy - h, r: ox + w / 2, b: oy };
            return Object.assign(box, { n: (f.properties.k || f.properties.l) + ":" + an, src });
          });
          const hit = (a, c) => a.l < c.r - 1 && a.r > c.l + 1 && a.t < c.b - 1 && a.b > c.t + 1;
          const bad = []; labels.forEach((L) => ui.concat(pins).forEach((u) => { if (hit(L, u)) bad.push(L.n + " × " + u.n); }));
          // owner 10 Nov (green-bar.jpg): no zone box half off screen
          labels.forEach((L) => { if (L.l < cv.left - 2 || L.r > cv.left + cv.width + 2 || L.t < cv.top - 2 || L.b > cv.top + cv.height + 2) bad.push(L.n + " off screen"); });
          return { labels: labels.map((L) => L.n + "/" + L.src), pins: pins.length, bad };
        }, UI);
        console.log("M3 " + vp.width + " " + nm + " " + JSON.stringify(d));
        await page.screenshot({ path: shotDir + "map-" + TAG + "-m3-" + nm + "-" + vp.width + ".png" });
        ok(d.labels.length > 0 && d.bad.length === 0, "M3 " + vp.width + " " + nm + ": no zone label under the top bar / ticker / chips / rail / dock, on a my-pin chip or half off screen (" + JSON.stringify(d.bad) + ")");
      }
      // a bar with friends ("mine": always the full pill) panned under the right rail: no pill there, the icon keeps its size
      await view(page, LUD, 16, 1500);
      const rail = await page.evaluate(() => { const e = [...document.querySelectorAll("#pn-ghost, .pn-rail, #btn-ghostpins")].find((x) => x.getBoundingClientRect().width > 10); const r = e && e.getBoundingClientRect(); const c = __map.getContainer().getBoundingClientRect();
        return r ? { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top } : null; });
      if (rail) {
        await barTo(page, PIT, rail.x, rail.y + 6); await idle(page, 600);
        const under = await page.evaluate((id) => __mpw.drawn(id), PIT);
        await page.screenshot({ path: shotDir + "map-" + TAG + "-m3-rail-" + vp.width + ".png" });
        await barTo(page, PIT, vp.width / 2, vp.height / 2); await idle(page, 600);
        const mid = await page.evaluate((id) => __mpw.drawn(id), PIT);
        console.log("M3 rail " + JSON.stringify({ under, mid }));
        ok(under.kind === "dot" && mid.kind === "full" && Math.abs(under.d - mid.d) <= 1, "M3 " + vp.width + ": Pitchers under the right rail shows no pill (" + under.kind + " " + under.d + " px), mid screen the full pill (" + mid.kind + " " + mid.d + " px), same icon size");
      }
      ok(errs.length === 0, "M3 " + vp.width + " no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-m3");
    }

    // M3 Sweden view (the zones-pw case, also at its 412 x 915): the busy län chips 01 / 14 / 20 all stay on the map
    if (ONLY.test("m3sw")) for (const vp of [{ width: 390, height: 844 }, { width: 412, height: 915 }]) {
      const { ctx, page, errs } = await open(b, vp);
      await page.evaluate(() => document.querySelectorAll("style").forEach((s) => { if (s.textContent === "#toasts{display:none !important}") s.remove(); }));   // toasts on, as in zones-pw
      // Sweden view (zones-pw case): the busy län chips (01 Stockholm, 14 Västra Götaland, 20 Dalarna) all stay on the map
        await view(page, [62.6, 16.4], 4.4, 600);
        await page.waitForFunction(() => { const m = __mpw.gm(); const l = m.queryRenderedFeatures({ layers: ["olnu-zl-lblc", "olnu-zl-lblq"].filter((x) => m.getLayer(x)) }).map((f) => f.properties.l);
          return ["01", "14", "20"].every((c) => l.includes(c)); }, null, { timeout: 12000 }).catch(() => {});
        const sw = await page.evaluate(() => { const m = __mpw.gm(), lays = ["olnu-zl-lblc", "olnu-zl-lblq"].filter((x) => m.getLayer(x));
          let src = []; try { src = (m.getSource("olnu-zl-pt")._data.features || []).filter((f) => ["01", "14", "20"].includes(f.properties.l)).map((f) => { const q = m.project(f.geometry.coordinates); return f.properties.l + ":" + (f.properties.an || "-") + (f.properties.hid ? "/hid" : "") + "@" + Math.round(q.x) + "," + Math.round(q.y); }); } catch (e) {}
          return { shown: m.queryRenderedFeatures({ layers: lays }).map((f) => f.properties.l), src, ui: window.ZONES && ZONES._uiRects ? ZONES._uiRects().map((r) => [r.l, r.t, r.r, r.b].map(Math.round).join(",")) : null }; });
        console.log("M3 sweden " + vp.width + " " + JSON.stringify(sw));
        await page.screenshot({ path: shotDir + "map-" + TAG + "-m3-sweden-" + vp.width + ".png" });
        ok(["01", "14", "20"].every((c) => sw.shown.includes(c)), "M3 " + vp.width + " Sweden view: the busy län chips 01 / 14 / 20 all stay on the map (" + JSON.stringify(sw.shown) + ")");
      ok(errs.length === 0, "M3 Sweden " + vp.width + " no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-m3sw");
    }

    /* ---------- M4: no simulated crowd (Stockholm / Göteborg / Malmö), even with the server flag "on" ---------- */
    if (ONLY.test("m4")) {
      const { ctx, page, errs } = await open(b, { width: 390, height: 844 }, { cfg: { visning: "on" }, q: "?visning=1" });
      await wait(page, 2500);
      await page.evaluate(() => { try { if (window.DEMO && DEMO._setNow) { const d = new Date(); d.setHours(23, 30, 0, 0); DEMO._setNow(d.getTime()); } } catch (e) {} });
      const out = [];
      for (const [nm, ll] of [["Stockholm", [59.3326, 18.0649]], ["Göteborg", [57.7065, 11.9670]], ["Malmö", [55.6050, 13.0038]]]) {
        await view(page, ll, 15, 2500);
        const v = await page.evaluate(() => { const vs = GLBARS._view() || []; return { people: vs.reduce((s, x) => s + (x.n || 0), 0), withPeople: vs.filter((x) => x.n > 0).length, demo: !!(window.DEMO && DEMO.on && DEMO.on()) }; });
        out.push(nm + " " + JSON.stringify(v));
        ok(v.people === 0 && !v.demo, "M4 " + nm + " z15: no simulated people at the bars (" + JSON.stringify(v) + ")");
      }
      await page.screenshot({ path: shotDir + "map-" + TAG + "-m4-malmo.png" });
      const chip = await page.evaluate(() => { const d = document.querySelector(".gw-demo"); return !!(d && !d.hidden); });
      ok(!chip, "M4: no 'Demo · påhittat folk' chip (the simulation is gone)");
      ok(errs.length === 0, "M4 no page errors " + JSON.stringify(errs.slice(0, 3)));
      await closeCounted(ctx, page, "map-" + TAG + "-m4");
    }
  } catch (e) { console.log("FAIL crash " + (e && e.stack)); fail++; }
  await b.close();
  console.log("RESULT pass " + pass + " fail " + fail);
  process.exit(fail ? 1 : 0);
})();
