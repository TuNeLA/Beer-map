// map4 test: 🏙️ 3D houses + 3D-lit bars / arenas on the Mapbox styles, slate roads, Mapbox 3D from zoom 14, tap → sheet.
// ONE Mapbox load. node map4-pw.js <port> [tag] [noshots|shotsonly]
//   shots: Ludvika centre (Pitchers / La Parma / Lobbybaren) + Hitachi Arena at zoom 14–17 in Skymning / Dag / Natt.
//   "shotsonly" = only the shots (use on the unpatched copy for the "before" set).
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "after", MODE = process.argv[4] || "";
const J = (r, b, s) => r.fulfill({ status: s || 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const now = Date.now(), at = (h) => new Date(now + h * 3600e3).toISOString();
const HIT = [60.1512, 15.20877], CENTRE = [60.15065, 15.1874];
const E = (o) => Object.assign({ ends_at: null, url: null, source: "user", is_mine: false, pending: false, km: 0.3, sport: null, league: null, home: null, away: null, tv: false, town: "Ludvika", bar_id: null, ticket_url: null }, o);
const EV2 = [E({ id: 21, title: "Ludvika HF – Björbo IF", kind: "sport", starts_at: at(0.75), place: "Hitachi Arena", lat: HIT[0], lng: HIT[1], km: 1.2,
  sport: "hockey", league: "HockeyTrean", home: "Ludvika HF", away: "Björbo IF", source: "swehockey" })];

async function page4(b, style) {
  const { ctx, page } = await H.ctxFor(b, { width: 412, height: 915 }, {});
  await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem("m4")) { sessionStorage.setItem("m4", 1); localStorage.setItem("olnu.mapStyle", s); } } catch (e) {} }, style);
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN }));
  await page.route(/rest\/v1\/rpc\/(events_near2|events_near)\b/, (r) => /events_near2/.test(r.request().url()) ? J(r, { v: 1, server_time: new Date().toISOString(), events: EV2 }) : J(r, EV2));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("https://tunela.github.io/Beer-map/");
  await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => console.log("no pills"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  return { ctx, page, errs };
}
async function settle(page, ms) {
  await page.waitForFunction(() => { if (!BASEMAP.isMapbox()) return true; const m = BASEMAP.mapbox().getMapboxMap(); return BASEMAP.loaded() && m.loaded() && m.areTilesLoaded(); }, null, { timeout: 30000 }).catch(() => {});
  await wait(page, ms || 2200);
}
async function setStyle(page, s) {
  await page.evaluate((s) => BASEMAP.set(s), s);
  await page.waitForFunction((s) => BASEMAP.current() === s && (s === "classic" || BASEMAP.loaded()), s, { timeout: 40000 }).catch(() => console.log("not loaded", s));
  await settle(page, 1500);
}
async function view(page, ll, z) { await page.evaluate(([c, z]) => window.__map.setView(c, z, { animate: false }), [ll, z]); await settle(page); }
async function shots(page, tag) {
  for (const st of ["mb-dusk", "mb-night"]) {   // glfix: only Skymning + Natt exist (KARTSTIL 5)
    await setStyle(page, st);
    for (const [loc, ll] of [["centre", CENTRE], ["arena", HIT]]) for (const z of [14, 15, 16, 17]) {
      await view(page, ll, z);
      await page.screenshot({ path: SP + "map4-" + tag + "-" + st.slice(3) + "-" + loc + "-z" + z + ".png", timeout: 120000 }).catch((e) => console.log("shot failed", e.message.slice(0, 60)));
    }
  }
}

(async () => {
  const b = await chromium.launch(launchOpts());
  const nc = b.newContext.bind(b); b.newContext = (o) => nc({ ...o, serviceWorkers: "block" });
  const { ctx, page, errs } = await page4(b, "mb-dusk");
  await page.waitForFunction(() => BASEMAP.current() === "mb-dusk" && BASEMAP.loaded(), null, { timeout: 40000 }).catch(() => console.log("dusk not loaded"));
  if (MODE === "shotsonly") { await shots(page, TAG); console.log("loads", await closeCounted(ctx, page, "map4-shots-" + TAG)); await b.close(); return; }

  // 1. On Skymning: 3D layers, the 2D lit outlines / arena glow hidden
  await view(page, CENTRE, 16); await wait(page, 1500);
  // glfix: a busy machine: wait for the 3D data (houses + bar states from the first poll), max 40 s, not a fixed pause
  await page.waitForFunction(() => { const s = MAP3D._stats(); return s.on && s.houses > 1000 && s.bars.length > 0; }, null, { timeout: 40000 }).catch(() => console.log("3D data late"));
  let s = await page.evaluate(() => MAP3D._stats());
  console.log("stats", JSON.stringify(s).slice(0, 700));
  ok(s.on && s.layers.indexOf("olnu-houses-3d") >= 0 && s.layers.indexOf("olnu-bars-3d") >= 0 && s.layers.indexOf("olnu-arena-3d") >= 0, "Skymning: 3D layers in the Mapbox map " + s.layers.join(","));
  ok(s.houses > 1000, "Ludvika houses loaded from docs/buildings3d: " + s.houses);
  const ids = s.bars.map((x) => x.split(":")[1]);
  ok(["n3472634175", "x-la-parma-ludvika", "x-lobbybaren-ludvika"].every((id) => ids.indexOf(id) >= 0 || s.mbHas.indexOf(id) >= 0), "Pitchers, La Parma, Lobbybaren: our 3D house or Mapbox's own highlighted (" + s.mbHas.join(",") + ")");
  const hl = await page.evaluate((ids) => { const m = BASEMAP.mapbox().getMapboxMap(); return ids.map((id) => { const c = MAP3D._cand(id); const p = m.project(c.c);
    const f = m.queryRenderedFeatures([[p.x - 2, p.y - 2], [p.x + 2, p.y + 2]], { target: { featuresetId: "buildings", importId: "basemap" } })[0]; return f ? id + ":" + JSON.stringify(m.getFeatureState(f)) : id + ":none"; }); }, s.mbHas);
  ok(hl.every((x) => /highlight":true/.test(x)), "Mapbox houses under bars: feature-state highlight " + hl.join(" "));
  ok(s.bars.some((x) => /^cap:/.test(x)) && s.bars.every((x) => +x.split(":")[3] >= 8), "big houses: dim house + glowing roof slab, every bar house ≥ 8 m");
  ok(s.bars.some((x) => /:f:/.test(x)) && s.bars.some((x) => /:(l|h):/.test(x)), "bar states from the poll (friend / busy) " + s.bars.filter((x) => !/:q:/.test(x)).length);
  const panes = await page.evaluate(() => [getComputedStyle(document.querySelector(".leaflet-barlit-pane")).display, (document.querySelector(".leaflet-arenaglow-pane") ? getComputedStyle(document.querySelector(".leaflet-arenaglow-pane")).display : "none"), document.documentElement.hasAttribute("data-bm3d")]);
  ok(panes[0] === "none" && panes[1] === "none" && panes[2], "2D barlit outlines + arena glow hidden on Mapbox " + panes.join(","));
  // arena with a match in 45 min
  await view(page, HIT, 15); await wait(page, 1500);
  await page.waitForFunction(() => MAP3D._stats().arenas.length > 0, null, { timeout: 30000 }).catch(() => console.log("arena state late"));   // glfix: busy machine
  s = await page.evaluate(() => MAP3D._stats());
  ok(s.arenas.some((x) => /^a-hitachi-arena:hockey:day$/.test(x)), "Hitachi Arena extruded icy blue on match day " + s.arenas.join(","));
  ok(await page.evaluate(() => !!document.querySelector(".ap-pin")), "arena chip still shown");
  // 2. zoom thresholds
  const z = await page.evaluate(() => { const m = BASEMAP.mapbox().getMapboxMap(), fr = m.style.getFragmentStyle("basemap");
    return { houses: m.getLayer("olnu-houses-3d").minzoom, mb3d: fr._layers["3d-building"].minzoom, mb2d: fr._layers["2d-building"].minzoom,
      op: JSON.stringify(m.getPaintProperty("olnu-houses-3d", "fill-extrusion-opacity")) }; });
  ok(z.houses <= 12.5 && z.mb3d === 13 && z.mb2d === 13, "3D from Leaflet zoom 13.5 (ours) / 14 (Mapbox's), was 16: " + JSON.stringify(z));
  // 3. roads: no amber on the base map
  const rd = await page.evaluate(() => { const m = BASEMAP.mapbox().getMapboxMap(); const c = m.getConfig ? m.getConfig("basemap") : {}; const fr = m.style.getFragmentStyle("basemap");
    return { mw: c.colorMotorways, tr: c.colorTrunks, line: JSON.stringify(fr.getPaintProperty("roads", "line-color")).slice(0, 200), w: JSON.stringify(fr.getPaintProperty("roads", "line-width")).slice(0, 120) }; });
  const amber = /#f5a623|#ffb347|#ffb340|#e8992a|#f7b955|#d9a56a/i;
  ok(!amber.test(rd.mw + rd.tr + rd.line) && /\["\*"/.test(rd.w), "Skymning roads slate + thinner " + rd.mw + " " + rd.tr);
  // 4. tap a lit 3D house → that bar's sheet
  await view(page, [60.14997, 15.18679], 17);
  await page.evaluate(() => { document.querySelectorAll(".leaflet-marker-pane, .leaflet-bars-pane, .leaflet-hotbars-pane").forEach((p) => p.style.visibility = "hidden"); });
  const tap = await page.evaluate(() => {
    const k = MAP3D._cand("n3472634175"); if (!k) return null; const c = k.c;
    let opened = null; const o = BARLIT.open; BARLIT.open = (id) => { opened = id; return true; };
    window.__map.fire("click", { latlng: L.latLng(c[1], c[0]), containerPoint: window.__map.latLngToContainerPoint([c[1], c[0]]) });
    BARLIT.open = o; return opened;
  });
  ok(tap === "n3472634175", "tap on the 3D house opens that bar: " + tap);
  await page.evaluate(() => { document.querySelectorAll(".leaflet-marker-pane, .leaflet-bars-pane, .leaflet-hotbars-pane").forEach((p) => p.style.visibility = ""); });
  // 5. Dag / Natt (setConfig) keep the layers, house colour follows; Gator (setStyle) re-adds them + Mapbox's own 3D
  await view(page, CENTRE, 16);
  for (const st of ["mb-night", "mb-dusk"]) {
    await setStyle(page, st);
    // busy machine: wait until the 3D data is back after the style switch (max 20 s) instead of a fixed pause
    await page.waitForFunction((min) => { const s = MAP3D._stats(); return s.on && s.layers.length >= 4 && s.houses > min; }, st === "mb-streets" ? 200 : 1000, { timeout: 20000 }).catch(() => {});
    const r = await page.evaluate(() => { const m = BASEMAP.mapbox().getMapboxMap(), s = MAP3D._stats(); return { on: s.on, layers: s.layers, col: m.getLayer("olnu-houses-3d") && m.getPaintProperty("olnu-houses-3d", "fill-extrusion-color"), n: s.houses }; });
    ok(r.on && r.layers.length >= 4 && r.n > (st === "mb-streets" ? 200 : 1000) && (st !== "mb-streets" || r.layers.indexOf("olnu-mb3d") >= 0), st + ": 3D layers " + r.layers.join(",") + " colour " + r.col + " houses " + r.n + " on " + r.on);
  }
  // 6. Klassisk / free style: 2D outlines back, no data-bm3d
  // glfix: the free styles are gone; the silent raster fallback (forced) = 2D lit outlines back, MAP3D off
  await setStyle(page, "classic"); await view(page, CENTRE, 16);
  const back = await page.evaluate(() => [document.documentElement.hasAttribute("data-bm3d"), getComputedStyle(document.querySelector(".leaflet-barlit-pane")).display, BARLIT._stats().polys]);
  ok(!back[0] && back[1] !== "none" && back[2] > 0, "raster fallback: 2D lit outlines as before " + back.join(","));
  ok(await page.evaluate(() => !document.documentElement.hasAttribute("data-bm3d") && !MAP3D._on()), "raster fallback: MAP3D off");
  await setStyle(page, "mb-dusk");
  await page.waitForFunction(() => MAP3D._on(), null, { timeout: 20000 }).catch(() => {});
  const bk = await page.evaluate(() => [MAP3D._on(), BASEMAP.mapboxLoads(), BASEMAP.current(), BASEMAP.loaded()]);
  ok(bk[0] && bk[1] === 1, "back on Skymning: on again, still ONE Mapbox map object " + bk.join(","));
  // 7. perf: houses setData cost
  const perf = await page.evaluate(async () => { const t = performance.now(); MAP3D._sync(); return Math.round(performance.now() - t); });
  ok(perf < 400, "rebuild of all 3D data " + perf + " ms");
  if (MODE !== "noshots") await shots(page, TAG);
  const real = errs.filter((m) => !/reading 'update'/.test(m));
  ok(real.length === 0, "no page errors " + JSON.stringify(real.slice(0, 3)));
  console.log("loads", await closeCounted(ctx, page, "map4-pw-" + TAG));
  console.log(pass + " PASS, " + fail + " FAIL");
  await b.close();
})();
