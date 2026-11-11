// lane heat (0485 + 0486, owner 11 Nov 21:05 "Bars + town centre"): the client draws what the server answers, and with the
// new server answers there is no double glow for my own pin or my group mate's pin, and no glow near a village home.
// Mocked Supabase (ds-helpers). The answers are REAL server output for one viewer, made on a local Postgres copy by
// supabase/tests/heat-0485-fixture.sql (tests/e2e/fixtures/heat-0485.json: "old" = before 0485/0486, "new" = after).
// usage: node heat-pw.js <port>          HEAT_FIXTURE=old node heat-pw.js <port>  (old server answers: the glow checks FAIL)
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const FX = require("./fixtures/heat-0485.json");
const PORT = process.argv[2] || 8871;
const WHICH = process.env.HEAT_FIXTURE === "old" ? "old" : "new";
const D = FX[WHICH];
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const m = (a, b) => Math.hypot((a[0] - b[0]) * 111195, (a[1] - b[1]) * 111195 * Math.cos(a[0] * Math.PI / 180));
const near = (pts, spot, r) => pts.filter((p) => m(p, spot) <= r);

(async () => {
  console.log("server answers: " + WHICH + " (" + D.server + ")");
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, { checkin: false });
    // own routes after the helper's: they win
    await page.route(/rest\/v1\/rpc\/live_beers/, (r) => J(r, D.live_beers.map((b) => Object.assign({ created_at: new Date(Date.now() - 30 * 60e3).toISOString() }, b))));
    await page.route(/rest\/v1\/rpc\/live_others/, (r) => J(r, []));
    await page.route(/rest\/v1\/rpc\/live_checkins/, (r) => J(r, []));
    await page.route(/rest\/v1\/rpc\/heat_points/, (r) => J(r, D.heat_points || []));
    await ctx.addInitScript(() => {
      try { localStorage.setItem("olnu.heat", "1"); } catch (e) {}
      // what renderHeat hands to the GL heat layer (Mapbox map); the Leaflet path is read from the heat layer itself
      let g;
      Object.defineProperty(window, "GLBARS", { configurable: true, get() { return g; }, set(v) {
        if (v && typeof v.heat === "function" && !v.__heatHook) { const h = v.heat; v.heat = function (p) { window.__heatIn = p; return h.apply(this, arguments); }; v.__heatHook = 1; }
        g = v; } });
    });
    await H.boot(page);
    const drawn = () => page.evaluate(() => {
      let ll = null;
      if (window.__map) window.__map.eachLayer((l) => { if (l._heat && l._latlngs) ll = l._latlngs; });
      const src = (window.__heatIn && window.__heatIn.length) ? window.__heatIn : ll;
      return (src || []).map((p) => Array.isArray(p) ? [+p[0], +p[1], +p[2]] : [+p.lat, +p.lng, +(p.alt != null ? p.alt : 1)]);
    });
    const want = D.live_beers.length + (D.heat_points || []).length;
    await page.waitForFunction((n) => {
      let ll = null; if (window.__map) window.__map.eachLayer((l) => { if (l._heat && l._latlngs) ll = l._latlngs; });
      const src = (window.__heatIn && window.__heatIn.length) ? window.__heatIn : ll; return src && src.length >= n;
    }, want, { timeout: 45000 }).catch(() => console.log("heat: not all points drawn in 45 s"));
    const pts = await drawn();
    console.log("drawn", JSON.stringify(pts));
    const S = D.spots;
    ok(pts.length === want, "client draws every pin + every server heat point (" + pts.length + " / " + want + ")");
    ok((D.heat_points || []).every((h) => pts.some((p) => m(p, [h.lat, h.lng]) < 1 && Math.abs(p[2] - h.w * 0.3) < 0.01)),
      "each server heat point is drawn at its place with trail weight 0.3 × w");
    ok(near(pts, S.me, 50).length === 1, "own pin: one glow only (pin), no anonymous heat on top (" + near(pts, S.me, 50).length + " within 50 m)");
    ok(near(pts, S.mate, 50).length === 1, "group mate's pin: one glow only (" + near(pts, S.mate, 50).length + " within 50 m)");
    ok(near(pts, S.village_home, 2000).length === 0, "village home: no glow within 2 km (" + near(pts, S.village_home, 2000).length + ")");
    ok(near(pts, S.stranger_bar, 1).length >= 1, "stranger at a bar: glow at the bar");
    if (WHICH === "new") ok(near(pts, S.town, 1).length >= 1, "home beers of strangers: glow at the Ludvika town centre");
    await H.shot(page, "heat-" + WHICH).catch(() => {});
    await ctx.close();
  } catch (e) { ok(false, "error " + (e && e.message)); }
  await browser.close();
  console.log("heat-pw: " + pass + " PASS, " + fail + " FAIL");
  process.exit(fail ? 1 : 0);
})();
