// mbx copy of zones-pw.js: a friend / me cluster is marked .cl-f on the marker (new .pn-cl markup)
// 🗺️ KARTZONER test: lazy borders, län / kommun layers, counts (mocked zone_counts), "några", top bar line, tap = zoom in,
// handover to bars at z ≥ 10.5, Mapbox loads = 1. Mocked server (d2-helpers) + the real Mapbox token origin (map3-lib).
// node zones-pw.js <port> [tag]   → zones-<tag>-*.png
const { chromium } = require("playwright");
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const PORT = process.argv[2], TAG = process.argv[3] || "t";
const ZC = { v: 1, at: new Date().toISOString(), k: 3, total: 23, some: true,
  kommun: [{ c: "0180", n: 15 }, { c: "2061" }, { c: "2080" }, { c: "2085", n: 5, bar: "n3472634175" }, { c: "1480", n: 3 }],
  lan: [{ c: "01", n: 15, top: "0180" }, { c: "14", n: 3, top: "1480" }, { c: "20", n: 8, top: "2085" }] };
let fails = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(launchOpts([]));
  const nc = b.newContext.bind(b); b.newContext = (o) => nc({ ...o, serviceWorkers: "block" });
  const { ctx, page } = await H.ctxFor(b, { width: 412, height: 915 }, {});
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("m3")) { sessionStorage.setItem("m3", 1); localStorage.setItem("olnu.mapStyle", "mb-dusk"); } } catch (e) {} });
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, mapbox_token: TOKEN }) }));
  const zc = []; let geoReq = [];
  await page.route(/rest\/v1\/rpc\/zone_counts/, (r) => { zc.push({ t: Date.now(), body: r.request().postData() }); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZC) }); });
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    if (/\/zones\//.test(p)) geoReq.push({ p, t: Date.now() });
    const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("https://tunela.github.io/Beer-map/");
  await page.waitForFunction(() => window.__map && window.BASEMAP && BASEMAP.isMapbox() && BASEMAP.loaded(), null, { timeout: 45000 }).catch(() => console.log("mapbox not loaded"));
  await H.wait(page, 3000);
  ok(geoReq.length === 0, "no border file at boot (zoom 14)", geoReq.map((x) => x.p));
  ok(zc.length === 0, "no zone_counts at boot (zoom 14)", zc.length);
  const pill = () => page.evaluate(() => document.getElementById("live-count").textContent);
  const shot = (n) => page.screenshot({ path: SP + "zones-" + TAG + "-" + n + ".png" }).then(() => console.log("shot", SP + "zones-" + TAG + "-" + n + ".png"));
  const view = (ll, z) => page.evaluate(([ll, z]) => new Promise((res) => { __map.once("moveend", () => setTimeout(res, 50)); __map.setView(ll, z, { animate: false }); setTimeout(res, 3000); }), [ll, z]);
  const rendered = (layers) => page.evaluate((ls) => { const m = BASEMAP.mapbox().getMapboxMap(); return m.queryRenderedFeatures({ layers: ls.filter((l) => m.getLayer(l)) }).length; }, layers);

  // 1) whole Sweden
  await view([62.6, 16.4], 4.4);
  await page.waitForFunction(() => ZONES._counts() && ZONES._geo().l && ZONES._geo().k, null, { timeout: 45000 }).catch(() => console.log("counts / borders late"));
  await H.wait(page, 1500);
  const g = await page.evaluate(() => ZONES._geo());
  ok(g.l && g.k, "borders loaded after zoom-out", g);
  ok(zc.length === 1, "one zone_counts call", zc.length);
  ok(/Sverige · 23 ute( ikväll)?$/.test(await pill()), "top bar Sverige", await pill());
  ok((await rendered(["olnu-zl-fill"])) >= 15, "län fills drawn", await rendered(["olnu-zl-fill"]));
  // suite: the busy labels are images drawn at run time; under load they are placed a few seconds after the fills. Poll ≤ 10 s (same rule).
  await page.waitForFunction(() => { const m = BASEMAP.mapbox().getMapboxMap(); const l = m.queryRenderedFeatures({ layers: ["olnu-zl-lblc", "olnu-zl-lblq"] }).map((f) => f.properties.l);
    return ["01", "14", "20"].every((c) => l.includes(c)) && l.length >= 6; }, null, { timeout: 10000 }).catch(() => {});
  const ll = await page.evaluate(() => { const m = BASEMAP.mapbox().getMapboxMap(); return m.queryRenderedFeatures({ layers: ["olnu-zl-lblc", "olnu-zl-lblq"] }).map((f) => f.properties.l); });
  ok(["01", "14", "20"].every((c) => ll.includes(c)) && ll.length >= 6, "län labels: all busy ones + some quiet names", ll);
  const st = await page.evaluate(() => { const m = BASEMAP.mapbox().getMapboxMap(); return [1, 14, 20, 25].map((id) => (m.getFeatureState({ source: "olnu-zl", id }) || {}).lv); });
  ok(st[0] === 3 && st[1] === 2 && st[2] === 2 && st[3] === 0, "län levels Stockholm 15=3, VG 3=2, Dalarna 8=2, Norrbotten 0", st);
  await shot("sverige");
  // 2) Dalarna (län level)
  await view([60.75, 14.9], 6.2); await H.wait(page, 1500);
  ok(/Dalarna · 8 ute( ikväll)?$/.test(await pill()), "top bar Dalarna", await pill());
  const cl = await page.evaluate(() => { const v = [...document.querySelectorAll(".olnu-cl")].filter((e) => e.offsetParent); return { shown: v.length, stranger: v.filter((e) => !e.querySelector(".pf,.pm") && !e.classList.contains("cl-f")).length, all: document.querySelectorAll(".olnu-cl").length }; });
  ok(cl.stranger === 0 && cl.all > 0, "zones on: stranger count circles hidden, friends / me kept", cl);
  await shot("dalarna");
  // 3) kommun level at Ludvika
  await view([60.2, 15.15], 8.2); await H.wait(page, 2500);
  ok(/Ludvika · 5 ute( ikväll)?$/.test(await pill()), "top bar Ludvika", await pill());
  const kl = await rendered(["olnu-zk-lbl"]);
  ok(kl >= 2, "kommun labels (Ludvika + some)", kl);
  ok((await rendered(["olnu-zl-lbl", "olnu-zl-lblq"])) === 0, "län labels gone at kommun level");
  const wide = await page.evaluate(() => { const e = document.getElementById("live-count"); return e.scrollWidth <= e.clientWidth + 1; });
  ok(wide, "top bar line fits (no ellipsis) for Ludvika");
  await shot("ludvika-z8");
  await view([60.135, 15.42], 8.2); await H.wait(page, 1200);
  ok(/Smedjebacken · några( ute)?( ikväll)?$/.test(await pill()), "några (1–2) shown as words", await pill());
  // 4) handover: z 11 = world counter, zones invisible
  await view([60.15, 15.187], 11); await H.wait(page, 2500);
  ok(/dricker|ute i världen|^\d+\s*ute$/.test((await pill()).replace(/\u00a0/g, " ").trim()), "zoomed in: world counter back", await pill());   // pnds: the world pill says "N ute"
  const cl11 = await page.evaluate(() => [...document.querySelectorAll(".olnu-cl")].filter((e) => e.offsetParent).length);
  ok(cl11 > 0 && !(await page.evaluate(() => document.documentElement.hasAttribute("data-zones"))), "z11: count circles back", cl11);
  ok((await rendered(["olnu-zk-fill", "olnu-zk-lbl", "olnu-zl-fill"])) === 0, "no zone layers at z11");
  await view([60.15, 15.187], 10); await H.wait(page, 2000);
  await shot("handover-z10");
  // 5) tap a län = zoom to it; tap a kommun = zoom in
  await view([62.6, 16.4], 4.4); await H.wait(page, 1500);
  const pt = await page.evaluate(() => { const p = __map.latLngToContainerPoint([61.7, 13.3]); return { x: p.x, y: p.y }; });
  const settle = () => page.evaluate(() => new Promise((res) => { let t = setTimeout(res, 8000); __map.once("moveend", () => { clearTimeout(t); setTimeout(res, 600); }); }));
  let st1 = settle(); await page.mouse.click(pt.x, pt.y); await st1;
  const z1 = await page.evaluate(() => ({ z: __map.getZoom(), c: __map.getCenter(), last: ZONES.stats.lastTap }));
  ok(z1.z >= 6.6 && z1.last === "Dalarna", "tap Dalarna → kommun level", z1);
  // a point in Ludvika kommun, at least 60 px from the town (its people pins / 📍 chip are DOM and take the tap)
  const pt2 = await page.evaluate(() => { const t = __map.latLngToContainerPoint([60.15, 15.19]);
    for (let la = 60.0; la <= 60.42; la += 0.03) for (let ln = 14.15; ln <= 15.25; ln += 0.05) { const z = ZONES._zoneAt(la, ln), p = __map.latLngToContainerPoint([la, ln]);
      if (z.k === "Ludvika" && Math.hypot(p.x - t.x, p.y - t.y) > 60 && p.y > 330 && p.y < 1300 / 2 + 300) return { x: p.x, y: p.y, la, ln }; } return null; });
  console.log("tap point", JSON.stringify(pt2));
  st1 = settle(); await page.mouse.click(pt2.x, pt2.y); await st1;
  const z2 = await page.evaluate(() => ({ z: __map.getZoom(), last: ZONES.stats.lastTap }));
  ok(z2.z > z1.z + 0.5 && z2.last === "Ludvika", "tap Ludvika → zoom in", z2);
  await shot("tap-ludvika");
  // 6) counts are cached: moving around within 60 s asks no more; hidden = no ask
  const n0 = zc.length;
  await view([59.33, 18.06], 8); await view([57.7, 11.97], 8); await H.wait(page, 1000);
  const gaps = zc.slice(1).map((x, i) => x.t - zc[i].t);
  ok(gaps.every((g) => g >= 55000), "zone_counts at most once per 60 s (shared cache)", { calls: zc.length, gapsS: gaps.map((g) => Math.round(g / 1000)) });
  await view([59.33, 18.06], 8.4); await H.wait(page, 1500); await shot("stockholm-z8");
  const sz = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => /\/zones\//.test(e.name)).map((e) => ({ n: e.name.split("/").pop(), kb: Math.round((e.encodedBodySize || e.transferSize) / 1024) })));
  console.log("border files", JSON.stringify(sz), "gzip on GitHub Pages ≈ 51 + 13 KB");
  const credit = await page.evaluate(() => (document.querySelector("#attrib-pop .zn-credit") || {}).textContent || "");
  ok(/SCB/.test(credit), "SCB credit in ⓘ", credit);
  ok(!errs.length, "no page errors", errs.slice(0, 3));
  console.log("loads", await closeCounted(ctx, page, "zones-" + TAG));
  await b.close();
  console.log(fails ? "FAILS " + fails : "ALL PASS");
})();
