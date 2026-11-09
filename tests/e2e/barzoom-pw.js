// barzoom (ds44): zoomed in on a lit bar (Pitchers, Ludvika, Leaflet z19 = GL 18) on the real Mapbox map. ONE Mapbox load.
// Owner 2026-11-09 (fb3/8-bar-zoom-circle.jpg): no round glow over the lit building part; no dashed orange house outlines.
// Prints what draws there (GL layers + the bar3d source) and checks:
//   - a bar with a lit building part (k "cap") has no ground glow (k "glow") within 30 m;
//   - the 2D barlit / arenaglow shapes (mbx GL layers "mbx-barlit-*", "mbx-arenaglow-*") draw nothing on the Mapbox map;
//   - the heat layer is invisible at this zoom (heatmap-opacity 0).
// node barzoom-pw.js <port> [tag]
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t";
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const PIT = [60.14997, 15.18679];
(async () => {
  if (!TOKEN) { console.log("SKIP no MAPBOX_TEST_TOKEN"); return; }
  const b = await chromium.launch(launchOpts([]));
  const { ctx, page } = await H.ctxFor(b, { width: 390, height: 844 }, {});
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, mapbox_token: TOKEN }) }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("https://tunela.github.io/Beer-map/");
  await page.waitForFunction(() => window.BASEMAP && BASEMAP.isMapbox && BASEMAP.isMapbox() && window.GLBARS && GLBARS.on(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  const settle = async (ms) => { await page.waitForFunction(() => { const m = BASEMAP.mapbox().getMapboxMap(); return m.loaded() && m.areTilesLoaded(); }, null, { timeout: 30000 }).catch(() => {}); await wait(page, ms || 2500); };
  await page.evaluate((ll) => { const A = PNDS._A(); A.map.setView(ll, 19, { animate: false }); }, PIT);
  await settle(4000);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast, .dl-cap").forEach((t) => t.remove()));
  await page.screenshot({ path: SP + "barzoom-" + TAG + "-z18.png" });
  const d = await page.evaluate((ll) => {
    const g = BASEMAP.mapbox().getMapboxMap(), p = g.project([ll[1], ll[0]]), out = { z: g.getZoom() };
    const ours = (g.getStyle().layers || []).map((l) => l.id).filter((id) => /^(olnu-|mbx-)/.test(id));
    out.layers = ours.map((id) => { let v = ""; try { v = g.getLayoutProperty(id, "visibility") || "visible"; } catch (e) {} return id + (v === "none" ? "(off)" : ""); });
    const box = [[p.x - 160, p.y - 160], [p.x + 160, p.y + 160]];
    const fs = g.queryRenderedFeatures(box, { layers: ours.filter((id) => g.getLayer(id) && g.getLayer(id).type !== "heatmap") });
    const by = {}; fs.forEach((f) => { by[f.layer.id] = (by[f.layer.id] || 0) + 1; }); out.rendered = by;
    let src = []; try { src = (g.getSource("olnu-bars3d")._data.features || []).map((f) => f.properties); } catch (e) {}
    out.bars3d = src.filter((q) => q.id === "n3472634175" || /pitch/i.test(q.id || "")).map((q) => q.k);
    const near = (q) => q.k === "glow" || q.k === "cap";
    out.kinds = src.filter(near).reduce((a, q) => { a[q.k] = (a[q.k] || 0) + 1; return a; }, {});
    try { const glowFs = (g.getSource("olnu-bars3d")._data.features || []).filter((f) => f.properties.k === "glow");
      const capFs = (g.getSource("olnu-bars3d")._data.features || []).filter((f) => f.properties.k === "cap");
      const cen = (f) => { const c = f.geometry.coordinates[0]; let x = 0, y = 0; c.forEach((v) => { x += v[0]; y += v[1]; }); return [x / c.length, y / c.length]; };
      out.glowNearCap = glowFs.filter((gf) => capFs.some((cf) => { const a = gf.geometry.coordinates, c = cen(cf); return Math.hypot((a[0] - c[0]) * 55600, (a[1] - c[1]) * 111320) < 30; })).map((f) => f.properties.id); } catch (e) { out.glowNearCap = "err " + e.message; }
    try { out.heatOpacity = g.getLayer("olnu-heat") ? g.getPaintProperty("olnu-heat", "heatmap-opacity") : null; } catch (e) {}
    try { const e = out.heatOpacity, z = g.getZoom(); if (typeof e === "number") out.heatNow = e; else if (Array.isArray(e) && e[0] === "interpolate") { const st = e.slice(3); let v = st[1];
      for (let i = 0; i < st.length; i += 2) { if (z >= st[i]) v = st[i + 1]; if (i + 2 < st.length && z >= st[i] && z < st[i + 2]) { v = st[i + 1] + (st[i + 3] - st[i + 1]) * (z - st[i]) / (st[i + 2] - st[i]); break; } } out.heatNow = +(+v).toFixed(3); } } catch (e) {}
    out.htmlFlags = ["data-bm3d", "data-bmmb", "data-glbars"].filter((a) => document.documentElement.hasAttribute(a));
    return out;
  }, PIT);
  console.log("DIAG", JSON.stringify(d));
  const shapes = Object.keys(d.rendered || {}).filter((k) => /^mbx-(barlit|arenaglow)-/.test(k));
  ok(Array.isArray(d.glowNearCap) && d.glowNearCap.length === 0, "no ground glow next to a lit building part (" + JSON.stringify(d.glowNearCap) + ")");
  ok(shapes.length === 0, "no 2D barlit / arenaglow shapes (dashed house outlines) on the Mapbox map (" + JSON.stringify(shapes) + ")");
  ok(typeof d.heatNow === "number" ? d.heatNow < 0.05 : true, "heat is off at z18 (" + d.heatNow + ")");
  ok(errs.length === 0, "no page errors " + JSON.stringify(errs.slice(0, 3)));
  await closeCounted(ctx, page, "barzoom-" + TAG);
  console.log("RESULT pass " + pass + " fail " + fail);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
