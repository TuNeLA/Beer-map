// tiers 2: heat + clouds in metres, 📍 my bars at every zoom. ONE Mapbox load (Dag, then Skymning).
// node tiers2-pw.js <port> <tag> [before]   → tiers2-<tag>-<style>-pitchers-z17|18|19.png, -ludvika-z12.png, -sweden-z5.png
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const { glHeat } = require("./glfix-gllib.js");   // glfix: heat is a GL layer now
const PORT = process.argv[2], TAG = process.argv[3] || "after", BEFORE = process.argv[4] === "before";
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0; const ok = (c, m) => { if (BEFORE) return console.log("INFO " + m); console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString(), at = (m) => new Date(now + m * 60e3).toISOString();
const PIT = [60.14997, 15.18679], PARMA = [60.15124, 15.18797];
let id = 7000;
const P = (ll, n, f) => ({ id: id++, lat: ll[0], lng: ll[1], beer_count: n, precise: true, created_at: iso(40), is_mine: false, friend_name: f || null, skal_count: 0, i_skaled: false, shot_count: 0, bar_id: null });
const beers = [P(PIT, 2, "Ida"), P(PIT, 3), P(PIT, 1)];
[[59.3293, 18.0686], [59.335, 18.06], [57.7089, 11.9746], [55.605, 13.0038], [59.8586, 17.6389]].forEach((c) => { for (let i = 0; i < 6; i++) beers.push(P([c[0] + i * 0.002, c[1] + i * 0.003], 2)); });
(async () => {
  const b = await chromium.launch(launchOpts());
  const nc = b.newContext.bind(b); b.newContext = (o) => nc({ ...o, serviceWorkers: "block" });
  const { ctx, page } = await H.ctxFor(b, { width: 412, height: 915 }, { checkin: false });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("t2")) { sessionStorage.setItem("t2", 1); localStorage.setItem("olnu.mapStyle", "mb-dusk"); localStorage.setItem("olnu.heat", "1"); } } catch (e) {} });
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN }));
  await page.route(/rest\/v1\/rpc\/live_beers/, (r) => J(r, beers));
  await page.route(/rest\/v1\/rpc\/(live_checkins|my_rallies)\b/, (r) => J(r, []));
  await page.route(/rest\/v1\/rpc\/heat_points/, (r) => J(r, []));
  await page.route(/rest\/v1\/rpc\/group_etas/, (r) => J(r, [{ id: 31, is_me: true, name: "Anton", bar_id: "x-la-parma-ludvika", bar_name: "La Parma Pub & Restaurang",
    lat: PARMA[0], lng: PARMA[1], eta_at: at(15), created_at: iso(2), arrived: false, arrived_at: null, rally_id: null }]));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("https://tunela.github.io/Beer-map/");
  await page.waitForFunction(() => window.__map && window.BASEMAP, null, { timeout: 40000 }).catch(() => {});
  await page.waitForFunction(() => BASEMAP.current() === "mb-dusk" && BASEMAP.loaded(), null, { timeout: 90000 }).catch(() => console.log("mapbox not loaded"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await wait(page, 5000);
  const settle = async () => { await page.waitForFunction(() => { if (!BASEMAP.isMapbox()) return true; const m = BASEMAP.mapbox().getMapboxMap(); return m.loaded() && m.areTilesLoaded(); }, null, { timeout: 40000 }).catch(() => {}); await wait(page, 2200); };
  const view = async (c, z) => { await page.evaluate(([c, z]) => __map.setView(c, z, { animate: false }), [c, z]); await settle(); };
  const shot = (n) => page.screenshot({ path: SP + "tiers2-" + TAG + "-" + n + ".png", timeout: 90000 }).catch((e) => console.log("shot fail", n, e.message.slice(0, 50)));
  // heat glow at the bar: alpha of the heat canvas at Pitchers + 25 m east, and the radius in metres
  // glfix: GL heat (Skymning / Natt): radius + opacity from the layer, glow = pixel difference heat on / off at 0, ½ and 1.6 radius
  const heatAt = async () => {
    if (await page.evaluate(() => !!(window.GLBARS && GLBARS.on()))) {
      const z = await page.evaluate(() => __map.getZoom()), A = await page.evaluate((z) => ({ m: +TIERS._app.heatMeters(z).toFixed(1), px: +TIERS._app.heatPx(z, 60.14997).toFixed(1) }), z);
      const mpp = 156543.03 * Math.cos(60.14997 * Math.PI / 180) / Math.pow(2, z), r = A.m / mpp;
      const h = await glHeat(page, [60.14997, 15.18679], [0, r * 0.5, r * 1.6], 0);
      return { z, m: A.m, px: A.px, glR: h.rPx, op: h.op, a0: h.d[0], aHalf: h.d[1], aOut: h.d[2], gl: 1 };
    }
    return heatAt0();
  };
  const heatAt0 = () => page.evaluate(() => {
    let h = null; __map.eachLayer((l) => { if (l._heat) h = l; }); if (!h || !h._canvas) return null;
    const c = h._canvas, g = c.getContext("2d"), hs = h._hs || 1, z = __map.getZoom(), lat = 60.14997;
    const a = (ll) => { const p = __map.latLngToContainerPoint(ll); const d = g.getImageData(Math.round(p.x * hs), Math.round(p.y * hs), 1, 1).data; return d[3]; };
    const A = window.TIERS && TIERS._app, m = A && A.heatMeters ? +A.heatMeters(z).toFixed(1) : null;
    return { z, m, px: A && A.heatPx ? +A.heatPx(z, lat).toFixed(1) : null, op: +c.style.opacity, a0: a([60.14997, 15.18679]), aHalf: m ? a([60.14997, 15.18679 + m * 0.5 / 55600]) : null, aOut: m ? a([60.14997, 15.18679 + m * 1.6 / 55600]) : null };
  });
  // heat has its data (first poll answered) before the first measurement
  await page.waitForFunction(() => { if (window.GLBARS && GLBARS.on()) return GLBARS.stats.heatPts > 0; let n = 0; __map.eachLayer((l) => { if (l._heat && l._latlngs) n = l._latlngs.length; }); return n > 0; }, null, { timeout: 60000 }).catch(() => console.log("heat: no data"));
  for (const st of ["mb-dusk", "mb-night"]) {
    if (st !== "mb-dusk") { await page.evaluate((s) => BASEMAP.set(s), st); await page.waitForFunction((s) => BASEMAP.current() === s && BASEMAP.loaded(), st, { timeout: 60000 }).catch(() => {}); }
    const sn = st.slice(3);
    for (const z of [17, 18, 19]) {
      await view(PIT, z); let h = await heatAt();
      if (h && !h.a0) { await wait(page, 2500); h = await heatAt(); } console.log("HEAT", sn, JSON.stringify(h)); await shot(sn + "-pitchers-z" + z);
      ok(h && h.m >= 10 && h.m <= 45 && h.op >= 0.5 && (h.gl ? h.a0 > 25 && h.aHalf > 8 && Math.abs(h.glR - h.px) <= Math.max(2, h.px * 0.08) : h.a0 > 60 && h.aHalf > 20), sn + " z" + z + ": heat glow ≈ " + (h && h.m) + " m around Pitchers (" + (h && h.px) + " px), opacity " + (h && h.op) + ", alpha centre / half radius / 1.6× radius " + (h && [h.a0, h.aHalf, h.aOut].join(" / ")));
    }
    await view([60.1496, 15.1878], 12); await shot(sn + "-ludvika-z12");
    if (st === "mb-dusk") {
      const pin = await page.evaluate(() => [...document.querySelectorAll(".leaflet-mypins-pane .mp-pin")].map((e) => e.textContent));
      ok(pin.some((t) => /🏃/.test(t) && /La Parma/.test(t)), "z12: 🏃 på väg pin at La Parma (no bar marker there yet) " + JSON.stringify(pin));
      const pitFull = await page.evaluate(() => { if (window.GLBARS && GLBARS.on()) { const v = (GLBARS._view() || []).find((x) => x.id === "n3472634175"); return !!(v && v.full); }
        const ic = document.querySelector('.cm[data-bar="n3472634175"]'); return ic && ic.classList.contains("cm-full"); });
      ok(pitFull, "z12: Pitchers (friend Ida there) = full pill");
    }
    await view([62.0, 16.0], 5); await shot(sn + "-sweden-z5");
    if (st === "mb-dusk" && !BEFORE) {
      const r = await page.evaluate(() => { const pins = [...document.querySelectorAll(".leaflet-mypins-pane .mp-pin")];
        const z = (s) => +getComputedStyle(document.querySelector(s)).zIndex;
        return { pins: pins.map((e) => e.textContent), chips: document.querySelectorAll(".leaflet-marker-pane .pill").length, zPin: z(".leaflet-mypins-pane"), zChip: z(".leaflet-marker-pane") }; });
      ok(r.pins.some((t) => /🏃/.test(t)) && r.pins.some((t) => /👥/.test(t) || /\+1/.test(t)) && r.zPin > r.zChip, "Sweden z5: 🏃 på väg + 👥 friends pins above the count chips " + JSON.stringify(r));
      if (!BEFORE) {
      const m = await page.evaluate(() => { const A = TIERS._app, out = []; for (let z = 2; z <= 20; z += 0.5) out.push(+A.heatMeters(z).toFixed(1)); return out; });
      ok(m.every((x) => x >= 10 && x <= 500), "heat radius in metres within 10–500 at every zoom z2–20: " + m.join(","));
      const px = await page.evaluate(() => { const A = TIERS._app, o = []; for (let z = 3; z <= 19; z++) o.push(z + ":" + A.heatPx(z, 60.15).toFixed(0)); return o; });
      console.log("HEAT PX", px.join(" "));
      ok(px.every((s) => +s.split(":")[1] >= 9), "heat ≥ 9 px floor far out (no vanishing), no big discs: " + px.slice(0, 6).join(" "));
      const cm = await page.evaluate(() => { const o = []; for (let z = 3; z <= 20; z++) o.push(+CLOUDS.cloudM(z, 4).toFixed(1)); return o; });
      ok(cm.every((x) => x >= 10 && x <= 300), "cloud radius in metres within 10–300: " + cm.join(","));
      // tap the pin → zoom in, sheet opens
      await page.evaluate(() => { const p = [...document.querySelectorAll(".leaflet-mypins-pane .leaflet-marker-icon")].find((e) => /🏃/.test(e.textContent)); if (p) p.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await settle(); await wait(page, 1200);
      const t = await page.evaluate(() => ({ z: __map.getZoom(), sheet: document.body.classList.contains("barsheet-open") || !!document.querySelector(".leaflet-popup .bs") }));
      ok(t.z >= 16 && t.sheet, "tap 🏃 pin → zoom ≥ 16 + bar sheet " + JSON.stringify(t));
      await page.evaluate(() => __map.closePopup());
      }
    }
  }
  if (!BEFORE) ok(errs.length === 0, "no page errors " + JSON.stringify(errs.slice(0, 3)));
  await closeCounted(ctx, page, "tiers2-" + TAG);
  await b.close();
  console.log("DONE pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", e && e.stack); process.exit(1); });
