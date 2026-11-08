// tiers 3: heat floor — Falun, 2 people, z8/10/12/14 on Klassisk + Skymning (one Mapbox load).
// node tiers3-pw.js <port> <tag> [before]   → tiers3-<tag>-<style>-falun-z<z>.png
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const { glHeat } = require("./glfix-gllib.js");   // glfix: heat is a GL layer now (classic is gone: Skymning + Natt)
const PORT = process.argv[2], TAG = process.argv[3] || "after", BEFORE = process.argv[4] === "before";
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0; const ok = (c, m) => { if (BEFORE) return console.log("INFO " + m); console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString(), at = (m) => new Date(now + m * 60e3).toISOString();
const PIT = [60.14997, 15.18679], PARMA = [60.15124, 15.18797];
let id = 7000;
const P = (ll, n, f) => ({ id: id++, lat: ll[0], lng: ll[1], beer_count: n, precise: true, created_at: iso(40), is_mine: false, friend_name: f || null, skal_count: 0, i_skaled: false, shot_count: 0, bar_id: null });
const FAL = [60.6065, 15.6355];
const beers = [P(FAL, 1), P(FAL, 2)];
[].forEach((c) => { for (let i = 0; i < 6; i++) beers.push(P([c[0] + i * 0.002, c[1] + i * 0.003], 2)); });
(async () => {
  const b = await chromium.launch(launchOpts());
  const nc = b.newContext.bind(b); b.newContext = (o) => nc({ ...o, serviceWorkers: "block" });
  const { ctx, page } = await H.ctxFor(b, { width: 412, height: 915 }, { checkin: false });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("t3")) { sessionStorage.setItem("t3", 1); localStorage.setItem("olnu.mapStyle", "mb-dusk"); localStorage.setItem("olnu.heat", "1"); } } catch (e) {} });
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN }));
  await page.route(/rest\/v1\/rpc\/live_beers/, (r) => J(r, beers));
  await page.route(/rest\/v1\/rpc\/(live_checkins|my_rallies|group_etas|ghost_points2?)\b/, (r) => J(r, []));
  await page.route(/rest\/v1\/rpc\/heat_points/, (r) => J(r, []));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("https://tunela.github.io/Beer-map/");
  await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length >= 1, null, { timeout: 40000 }).catch(() => {});
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.waitForFunction(() => { if (window.GLBARS && GLBARS.on()) return GLBARS.stats.heatPts > 0; let n = 0; __map.eachLayer((l) => { if (l._heat && l._latlngs) n = l._latlngs.length; }); return n > 0; }, null, { timeout: 90000 }).catch(() => console.log("heat: no data"));
  await wait(page, 3000);
  const settle = async () => { await page.waitForFunction(() => { if (!BASEMAP.isMapbox()) return true; const m = BASEMAP.mapbox().getMapboxMap(); return BASEMAP.loaded() && m.loaded() && m.areTilesLoaded(); }, null, { timeout: 40000 }).catch(() => {}); await wait(page, 1800); };
  // heat alpha at the point and at 20 / 28 / 34 px east of it; the pill / chip of the 2 people there (its box)
  const probe = async () => {
    if (await page.evaluate(() => !!(window.GLBARS && GLBARS.on()))) {
      const h = await glHeat(page, [60.6065, 15.6355], [0, 20, 28, 34], 0);
      const chipW = await page.evaluate(() => { const p = __map.latLngToContainerPoint([60.6065, 15.6355]);
        const c = [...document.querySelectorAll(".pill")].map((e) => e.getBoundingClientRect()).filter((r) => r.width && Math.abs(r.left + r.width / 2 - p.x) < 40 && Math.abs(r.top + r.height / 2 - p.y) < 50)[0]; return c ? Math.round(c.width) : null; });
      return { z: h.z, R: h.rPx, op: h.op, a0: h.d[0], a20: h.d[1], a28: h.d[2], a34: h.d[3], chipW, gl: 1 };
    }
    return probe0();
  };
  const probe0 = () => page.evaluate(() => {
    let h = null; __map.eachLayer((l) => { if (l._heat) h = l; }); if (!h || !h._canvas) return null;
    const c = h._canvas, g = c.getContext("2d"), hs = h._hs || 1, p = __map.latLngToContainerPoint([60.6065, 15.6355]);
    const a = (dx) => g.getImageData(Math.round((p.x + dx) * hs), Math.round(p.y * hs), 1, 1).data[3];
    const chip = [...document.querySelectorAll(".pill")].map((e) => e.getBoundingClientRect()).filter((r) => Math.abs(r.left + r.width / 2 - p.x) < 40 && Math.abs(r.top + r.height / 2 - p.y) < 50)[0];
    return { z: __map.getZoom(), R: +(h._rNow / hs).toFixed(1), op: +c.style.opacity, a0: a(0), a20: a(20), a28: a(28), a34: a(34), chipW: chip ? Math.round(chip.width) : null };
  });
  for (const st of ["mb-dusk", "mb-night"]) {
    if (st !== "mb-dusk") { await page.evaluate((s) => BASEMAP.set(s), st); await page.waitForFunction((s) => BASEMAP.current() === s && BASEMAP.loaded(), st, { timeout: 90000 }).catch(() => console.log("mapbox not loaded")); }
    const sn = st.slice(3);
    for (const z of [8, 10, 12, 14]) {
      await page.evaluate(([c, z]) => __map.setView(c, z, { animate: false }), [FAL, z]); await settle();
      let r = await probe(); if (r && !r.a0) { await wait(page, 2000); r = await probe(); }
      console.log("PROBE", sn, JSON.stringify(r));
      await page.screenshot({ path: SP + "tiers3-" + TAG + "-" + sn + "-falun-z" + z + ".png", timeout: 90000 }).catch(() => {});
      // suite: MBX declutter (CONTRACT KARTSTIL 6): while zones show the GL heat fades to 0.12 (glmap.js heatmap-opacity 0.12 at GL z ≤ 8.4 = app z ≤ 9.4),
      // so at app z8 the heat must be there but faint (≈ 12 % of the z10 alpha); from z10 the old rule holds.
      const faded = z < 9.4;
      ok(r && r.R >= 40 && (faded ? r.gl && r.a20 > 3 && r.a20 < 25 : r.gl ? r.a20 > 25 && r.a28 > 8 : r.a0 > 60 && r.a28 > 25), (faded ? "[faded under zones] " : "") + sn + " z" + z + ": Falun 2 people — heat radius " + (r && r.R) + " px (≥ 40), red visible outside the chip (alpha at 0 / 20 / 28 / 34 px: " + (r && [r.a0, r.a20, r.a28, r.a34].join(" / ")) + ", chip " + (r && r.chipW) + " px wide)");
    }
  }
  if (!BEFORE) {
    const fl = await page.evaluate(() => { const A = TIERS._app, o = []; for (let z = 3; z <= 19; z++) o.push(z + ":" + A.heatPx(z, 60.6, 2).toFixed(0)); return o; });
    console.log("HEAT PX (peak 2)", fl.join(" "));
    ok(fl.every((s) => +s.split(":")[1] >= 40), "heat ≥ 40 px at every zoom (peak 2): " + fl.join(" "));
    const m = await page.evaluate(() => { const A = TIERS._app, o = []; for (let z = 2; z <= 20; z += 0.5) o.push(A.heatMeters(z)); return o.every((x) => x >= 10 && x <= 500); });
    ok(m, "metres curve still 10–500 m");
    const big = await page.evaluate(() => [TIERS._app.heatPx(8, 60.6, 1), TIERS._app.heatPx(8, 60.6, 20)].map((x) => +x.toFixed(1)));
    ok(big[0] >= 40 && big[1] <= 46 && big[1] > big[0], "floor grows a little with people: peak 1 → " + big[0] + " px, peak 20 → " + big[1] + " px (max 46)");
    ok(errs.length === 0, "no page errors " + JSON.stringify(errs.slice(0, 3)));
  }
  await closeCounted(ctx, page, "tiers3-" + TAG);
  await b.close();
  console.log("DONE pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", e && e.stack); process.exit(1); });
