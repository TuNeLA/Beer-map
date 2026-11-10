// mbx test: ONE Mapbox GL map, no Leaflet. node mbx-pw.js <port> [tag]   (2 Mapbox map loads: Ludvika + Stockholm page)
// Mocked data (d2-helpers: a busy Friday in Ludvika). Checks: no Leaflet on the page, L = js/mbx.js, one GL map object, DOM
// markers only where GL cannot draw, bar = disc + count badge (no long pill, 99+ cap), one type per place at every zoom
// (Blackstone = restaurant), labels right under the disc, people pins = face + badge, clusters small, zones declutter,
// heat fades under the zones, popups / sheets / fly-to / fit, the raster mini-map engine, MBX.nearbyPlaces.
const { H, TOKEN, launchOpts, ghPage, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t";
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 400))); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const LUD = [60.1503, 15.1876], STH = [59.3326, 18.0649];
async function settle(page, ms) {
  await page.waitForFunction(() => { try { const m = BASEMAP.mapbox().getMapboxMap(); return BASEMAP.loaded() && m.loaded() && m.areTilesLoaded(); } catch (e) { return true; } }, null, { timeout: 40000 }).catch(() => {});
  await wait(page, ms || 1500);
}
async function view(page, ll, z) { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await settle(page, 2200); }
(async () => {
  const b = await chromium.launch(launchOpts());
  const { ctx, page, errs } = await ghPage(b, PORT, { style: "mb-dusk" });
  await settle(page, 2500);
  await page.addStyleTag({ content: "#toasts,#pnlog-note{display:none !important}" }).catch(() => {});   // lane main R1-03: the beta note is a caption in the toast column now (it can sit on a tapped badge)

  // ---------- 1. engine ----------
  const eng = await page.evaluate(() => ({
    leafletScripts: [...document.scripts].filter((s) => /leaflet/i.test(s.src)).length,
    leafletCss: [...document.querySelectorAll("link[rel=stylesheet]")].filter((l) => /leaflet|markercluster/i.test(l.href)).length,
    L: L.version, gl: __map.isGL(), same: BASEMAP.mapbox().getMapboxMap() === __map.getMapboxMap(), loads: BASEMAP.mapboxLoads(),
    canvases: document.querySelectorAll("#map canvas.mapboxgl-canvas").length, inCanvas: !!document.querySelector(".mapboxgl-canvas-container > .leaflet-map-pane"),
    zoomScale: +(__map.getZoom() - __map.getMapboxMap().getZoom()).toFixed(3), csc: __map.getMapboxMap()._crossSourceCollisions,
    virtual: __map.isVirtualPane("bars") && __map.isVirtualPane("hotbars"), barDom: document.querySelectorAll("#map .cm[data-bar]").length }));
  ok(eng.leafletScripts === 0 && eng.leafletCss === 0 && eng.L === "mbx-1", "no Leaflet script / CSS on the page, L = js/mbx.js", eng);
  ok(eng.gl && eng.same && eng.loads === 1 && eng.canvases === 1, "ONE Mapbox GL map drives the map (1 map load, 1 canvas)", eng);
  ok(eng.inCanvas, "DOM marker panes live inside the GL canvas container (a drag on a pin pans the map)");
  ok(eng.zoomScale === 1, "zoom numbers stay on the old scale (app zoom = GL zoom + 1)", eng.zoomScale);
  ok(eng.csc !== false, "our symbols collide with Mapbox labels (crossSourceCollisions on)", eng.csc);
  ok(eng.virtual && eng.barDom === 0, "bars are GL only: their DOM twins are never in the DOM", eng);

  // ---------- 2. bar markers: disc + count badge ----------
  await view(page, LUD, 17);
  const bars = await page.evaluate(() => {
    const out = {};
    ["x-la-parma-ludvika", "n3472634175", "x-lobbybaren-ludvika"].forEach((id) => { const im = GLBARS._img(id); if (!im) return; const f = GLBARS._feats().find((p) => p.id === id) || {};
      out[id] = { full: f.t === 1, w: +(f.t === 1 ? (im.parts.reduce((a, p) => Math.max(a, p.bb[2]), -99) - im.parts.reduce((a, p) => Math.min(a, p.bb[0]), 99)) : 0).toFixed(1),
        badge: (im.parts.find((p) => p.sel === ".pill") || {}).bb || null, li: f.li || "" }; });
    return { out, cap: PNPINS.countText({ n: "150" }), one: PNPINS.countText({ n: "7" }) };
  });
  const parma = bars.out["x-la-parma-ludvika"] || {};
  ok(parma.full && parma.badge && parma.badge[0] >= 0 && parma.badge[3] <= 2, "busy bar = disc + round badge at its TOP-RIGHT", parma);
  ok(Object.values(bars.out).every((x) => !x.full || x.w < 85), "no long pill: every full bar marker < 85 px wide (with its side chips)", bars.out);
  ok(bars.cap === "99+" && bars.one === "7", "badge count caps at 99+", bars);
  // tap the badge → the bar sheet with the people fold open
  const pt = await page.evaluate(() => { const g = __map.getMapboxMap(), cv = g.getCanvas().getBoundingClientRect(), im = GLBARS._img("x-la-parma-ludvika"), mk = GLBARS._marker("x-la-parma-ludvika");
    if (!im || !mk) return null; const ll = mk.getLatLng(), q = g.project([ll.lng, ll.lat]), bb = im.parts.find((p) => p.sel === ".pill").bb; return { x: cv.left + q.x + (bb[0] + bb[2]) / 2, y: cv.top + q.y + (bb[1] + bb[3]) / 2 }; });
  if (pt && pt.y > 230 && pt.y < 590) {
    await page.touchscreen.tap(Math.round(pt.x), Math.round(pt.y));
    await page.waitForFunction(() => !!document.querySelector(".olnu-sheet .bs"), null, { timeout: 6000 }).catch(() => {});
    const sh = await page.evaluate(() => ({ t: (document.querySelector(".olnu-sheet .pp-title") || {}).textContent, here: !!document.querySelector('.olnu-sheet details[data-fold="here"][open]') }));
    ok(/La Parma/.test(sh.t || "") && sh.here, "tap the count badge → bar sheet with 🍺 Folk här open", sh);
    await page.evaluate(() => { const x = document.querySelector(".olnu-sheet .leaflet-popup-close-button"); if (x) x.click(); else __map.closePopup(); }); await wait(page, 800);
  } else ok(false, "badge tap point in view", pt);
  // labels: right under the disc, visible
  const lbl = await page.evaluate(() => { const v = GLBARS._view() || []; return v.filter((x) => x.full).map((x) => ({ id: x.id, lbl: x.lbl })); });
  const lo = await page.evaluate(() => GLBARS._feats().filter((p) => p.t === 1 && p.li).map((p) => p.lo));
  ok(lbl.some((x) => x.lbl), "bar names placed by GL collision at z17", lbl);

  // ---------- 3. one type per place at every zoom (owner: Blackstone beer zoomed out, restaurant zoomed in) ----------
  const types = {};
  for (const z of [13.6, 15, 17]) {
    await view(page, [60.15038, 15.18507], z);
    types[z] = await page.evaluate(() => { const f = GLBARS._feats().find((p) => p.id === "x-blackstone-ludvika"); return f ? { di: f.di, t: f.t, k: (GLBARS._view() || []).length } : null; });
  }
  const st = await page.evaluate(() => { const P = PNPINS; return { cat: P.cat("restaurant"), sprite: GLBARS.stats.sprite, has: !!__map.getMapboxMap().hasImage("dot-restaurant-quiet") && !!__map.getMapboxMap().hasImage("dot-cafe-quiet") && !!__map.getMapboxMap().hasImage("dot-fastfood-quiet") }; });
  ok(Object.values(types).every((x) => x && /^dot-restaurant-/.test(x.di)) && st.cat === "restaurant" && st.has, "Blackstone (restaurant) is a restaurant dot at every zoom (no beer fallback); dots exist for every type", { types, st });

  // ---------- 4. people pins + clusters ----------
  await view(page, LUD, 15.5);
  const pp = await page.evaluate(() => [...document.querySelectorAll(".leaflet-marker-pane .pn-p")].map((e) => { const r = e.getBoundingClientRect(), c = e.querySelector(".pn-c"), cr = c && c.getBoundingClientRect();
    return { w: Math.round(r.width), cls: e.className, n: c ? c.textContent : null, badgeTR: cr ? cr.left > r.left + r.width / 2 && cr.top < r.top + r.height / 2 : null }; }));
  ok(pp.length > 0 && pp.every((x) => x.w <= 34), "people pins = a round face ≤ 34 px (no pill)", pp.slice(0, 6));
  ok(pp.filter((x) => x.n).every((x) => x.badgeTR), "people count = a small badge at the face's top-right", pp.filter((x) => x.n).slice(0, 4));
  ok(pp.some((x) => /pn-s/.test(x.cls)) && (pp.some((x) => /pn-f|pn-m/.test(x.cls)) || !!(await page.$(".pn-cl.pn-f"))), "friends / me pins are their own look (pn-f / pn-m)", pp.map((x) => x.cls).slice(0, 6));
  await view(page, LUD, 12);
  const cl = await page.evaluate(() => [...document.querySelectorAll(".leaflet-marker-pane .pn-cl")].map((e) => ({ w: Math.round(e.getBoundingClientRect().width), t: e.textContent })));
  ok(cl.every((x) => x.w <= 72), "people clusters stay small (≤ 72 px incl. faces)", cl);

  // ---------- 5. zoomed out: zones declutter, heat fades, few DOM nodes ----------
  await view(page, [61.2, 15.0], 5.5);
  await wait(page, 2500);
  const zo = await page.evaluate(() => { const g = __map.getMapboxMap(); return { zones: document.documentElement.hasAttribute("data-zones"),
    arena: (document.querySelector(".leaflet-arenapins-pane") ? getComputedStyle(document.querySelector(".leaflet-arenapins-pane")).display : "none"),
    heatOp: g.getPaintProperty("olnu-heat", "heatmap-opacity"), dom: MBX.domStats(), mp: [...document.querySelectorAll(".mp-pin b")].filter((x) => x.offsetParent).length }; });
  ok(zo.zones && zo.arena === "none" && zo.mp === 0, "zones on: arena chips hidden, my-place pins icon only", zo);
  ok(Array.isArray(zo.heatOp) && zo.heatOp[3] <= 8.5 && zo.heatOp[4] <= 0.2, "heat fades to ≤ 0.2 while the zones carry the counts", zo.heatOp);
  await view(page, STH, 15);
  const sd = await page.evaluate(() => MBX.domStats());
  ok(sd.map < 400, "Stockholm z15: < 400 DOM nodes in the map (was 2261 with Leaflet)", sd);

  // ---------- 6. API: popups, fly-to, fit, project ----------
  const api = await page.evaluate(async () => {
    const out = {}; const m = __map;
    const pop = L.popup({ className: "mbx-t" }).setLatLng(m.getCenter()).setContent("<b>hej</b>").openOn(m);
    out.popup = !!document.querySelector(".leaflet-popup.mbx-t .leaflet-popup-content b") && m._popup === pop; m.closePopup(); out.closed = !document.querySelector(".leaflet-popup.mbx-t");
    const c0 = m.getCenter(), p = m.latLngToContainerPoint(c0), back = m.containerPointToLatLng(p); out.round = Math.abs(back.lat - c0.lat) < 1e-6 && Math.abs(back.lng - c0.lng) < 1e-6;
    out.center = Math.abs(p.x - m.getSize().x / 2) < 1 && Math.abs(p.y - m.getSize().y / 2) < 1;
    m.fitBounds([[60.14, 15.17], [60.16, 15.20]], { padding: [20, 20] }); const bb = m.getBounds(); out.fit = bb.contains([60.14, 15.17]) && bb.contains([60.16, 15.20]) && m.getZoom() > 12;
    await new Promise((r) => { m.once("moveend", r); m.flyTo([60.1503, 15.1876], 15, { duration: 0.5 }); }); out.fly = Math.abs(m.getZoom() - 15) < 0.01;
    const mk = L.marker([60.1503, 15.1876], { icon: L.divIcon({ className: "mbx-tm", html: "x", iconSize: [10, 10] }) }).addTo(m); let clicks = 0; mk.on("click", () => clicks++);
    mk.getElement().click(); out.mkClick = clicks === 1; out.mkPos = Math.abs(mk.getElement()._leaflet_pos.x - m.getSize().x / 2) <= 1; m.removeLayer(mk); out.mkGone = !document.querySelector(".mbx-tm");
    const circ = L.circle([60.1503, 15.1876], { radius: 100, color: "#f00" }).addTo(m); await new Promise((r) => setTimeout(r, 400));
    out.circle = !!m.getMapboxMap().getSource("mbx-overlayPane"); m.removeLayer(circ);
    return out;
  });
  ok(Object.values(api).every(Boolean), "L API on GL: popup open / close, project round trip, fitBounds, flyTo, marker click + position, circle in GL", api);

  // ---------- 6b. 🆘 Hämta mig request pin (SKJUTS rows; the poll is stubbed here) ----------
  const pk = await page.evaluate(async () => {
    if (!window.SKJUTS) return { skip: true };
    const o = SKJUTS._poll; SKJUTS._poll = () => ({ incoming: [{ id: 77, live: true, lat: 60.1503, lng: 15.1876, kind: "hamta", name: "Lisa" }] });
    const n = GLBARS._pkSync(); await new Promise((r) => setTimeout(r, 200));
    const el = document.querySelector(".leaflet-pickup-pane .pk-pin"), t = el ? el.textContent : "";
    SKJUTS._poll = () => ({ incoming: [] }); GLBARS._pkSync(); const gone = !document.querySelector(".pk-pin"); SKJUTS._poll = o;
    return { n, t, gone };
  });
  ok(pk.skip || (pk.n === 1 && /Lisa/.test(pk.t) && pk.gone), "🆘 Hämta mig request = a pin on the map (and gone when it ends)", pk);

  // ---------- 7. MBX.nearbyPlaces (bars + restaurants near a spot, from loaded data) ----------
  const np = await page.evaluate(async () => { const r = await MBX.nearbyPlaces(60.1503, 15.1876, { maxM: 800, max: 40 }); return { n: r.length, bars: r.filter((x) => !x.place).length, places: r.filter((x) => x.place).length, first: r[0] && r[0].bar.name, sorted: r.filter((x) => !x.place).every((x, i, a) => !i || a[i - 1].d <= x.d) }; });
  ok(np.bars > 0 && np.places > 0 && np.sorted, "MBX.nearbyPlaces: bars + restaurants near Ludvika centre, nearest first", np);

  ok(errs.length === 0, "no page errors (GL page)", errs.slice(0, 3));
  await closeCounted(ctx, page, "mbx-pw-" + TAG);

  // ---------- 8. the raster engine (no token: fallback + mini maps; 0 Mapbox loads) ----------
  const o2 = await ghPage(b, PORT, { style: "mb-dusk", noToken: true });
  await wait(o2.page, 4000);
  const ras = await o2.page.evaluate(async () => {
    const out = { cur: BASEMAP.current(), gl: __map.isGL(), loads: BASEMAP.mapboxLoads(), tiles: document.querySelectorAll("#map img.leaflet-tile").length, barsDom: document.querySelectorAll("#map .cm[data-bar]").length };
    const d = document.createElement("div"); d.style.cssText = "position:fixed;left:10px;top:200px;width:300px;height:200px;z-index:99999"; document.body.appendChild(d);
    const mini = L.map(d, { zoomControl: false }); L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16 }).addTo(mini);
    mini.setView([60.15, 15.19], 14); let got = null; mini.on("click", (e) => { got = e.latlng; });
    L.circle([60.15, 15.19], { radius: 200, color: "#f5a623" }).addTo(mini); L.circleMarker([60.15, 15.19], { radius: 6 }).addTo(mini);
    await new Promise((r) => setTimeout(r, 300));
    out.miniTiles = d.querySelectorAll("img.leaflet-tile").length; out.miniSvg = d.querySelectorAll("svg.mbx-svg path, svg.mbx-svg circle").length;
    const r = d.getBoundingClientRect();
    ["pointerdown", "pointerup"].forEach((t) => d.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: r.left + 150, clientY: r.top + 100, pointerId: 7, isPrimary: true })));
    out.click = got && Math.abs(got.lat - 60.15) < 0.002 && Math.abs(got.lng - 15.19) < 0.003;
    mini.fitBounds([[60.14, 15.17], [60.16, 15.21]]); out.fit = mini.getBounds().contains([60.16, 15.21]);
    mini.remove(); d.remove();
    return out;
  });
  ok(ras.cur === "classic" && !ras.gl && ras.loads === 0 && ras.tiles > 0 && ras.barsDom > 0, "no token: raster engine (free tiles, DOM bars), 0 Mapbox loads", ras);
  ok(ras.miniTiles > 0 && ras.miniSvg >= 2 && ras.click && ras.fit, "mini map (homezone / near / passport): raster tiles, SVG circle, tap → latlng, fitBounds", ras);
  ok(o2.errs.length === 0, "no page errors (raster page)", o2.errs.slice(0, 3));
  await closeCounted(o2.ctx, o2.page, "mbx-pw-raster-" + TAG);
  await b.close();
  console.log("DONE pass=" + pass + " fail=" + fail);
})().catch((e) => { console.log("FAIL crash", e && e.stack); process.exit(1); });
