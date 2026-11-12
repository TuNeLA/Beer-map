// alive-pw.js — lane alive (13 Nov 2026): "Levande karta" (docs/js/alive.js). Each effect appears with mocked data
// (🍻 clink at a bar with skål taps and >= 3 people, 📅 pulse at an event tonight, ✨ sparks at a bar with >= 5 people,
// 🌙 static night glow at quiet bars in its own GL layer), none with reduced motion, the 12-marker cap, pause on movestart,
// the off switch, and the raster fallback (no token: DOM glows, <= 6).
// Real Mapbox when MAPBOX_TEST_TOKEN is set (CI). Without it: a STUB Mapbox (blank style), the SAME GL layers run.
// node alive-pw.js <port> [tag]
const { H, TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2];
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const BAR = { parma: [60.15124, 15.18797], pitch: [60.14997, 15.18679], lobby: [60.15098, 15.18663], grek: [60.15205, 15.18059] };
const LUD = [60.1505, 15.1872];
const iso = (min) => new Date(Date.now() + min * 60e3).toISOString();
let id = 9000;
const P = (ll, o = {}) => ({ id: id++, lat: ll[0], lng: ll[1], beer_count: 2, precise: true, created_at: iso(-30), is_mine: false, friend_name: null,
  skal_count: o.sk || 0, i_skaled: false, shot_count: 0 });
// La Parma: 4 people, 3 skål taps -> clink. Pitchers: 6 people, no skål -> sparks. Lobbybaren: event tonight -> pulse. Grekiska: 1 -> nothing.
const BEERS = [P(BAR.parma, { sk: 2 }), P(BAR.parma, { sk: 1 }), P(BAR.parma), P(BAR.parma),
  P(BAR.pitch), P(BAR.pitch), P(BAR.pitch), P(BAR.pitch), P(BAR.pitch), P(BAR.pitch), P(BAR.grek)];
const EV = [{ id: 501, title: "Pubquiz", kind: "quiz", starts_at: iso(30), ends_at: iso(180), place: "Lobbybaren", bar_id: "x-lobbybaren-ludvika",
  lat: BAR.lobby[0], lng: BAR.lobby[1], km: 0.1 }];

async function open(b, o = {}) {
  const { ctx, page } = await H.ctxFor(b, { width: 390, height: 780 }, { reduced: !!o.reduced });
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: o.noToken ? "" : (TOKEN || STUB_TOKEN) }));
  await page.route(/rest\/v1\/rpc\/live_beers\b/, (r) => J(r, BEERS));
  await page.route(/rest\/v1\/rpc\/(events_near2|events_near3)\b/, (r) => J(r, { v: 1, server_time: new Date().toISOString(), events: EV }));
  await page.route(/rest\/v1\/rpc\/events_near\b/, (r) => J(r, EV));
  if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
      await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
    } catch (e) { r.abort().catch(() => {}); }
  });
  const errs = []; page.on("pageerror", (e) => { if (/alive|ALIVE/.test(e.message + (e.stack || ""))) errs.push(e.message); });
  const url = "https://tunela.github.io/Beer-map/";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(async () => { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); });
  if (!o.noToken) await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  await page.waitForFunction(() => window.ALIVE && window.__map && window.BARS && BARS.byId("n3472634175"), null, { timeout: 30000 }).catch(() => console.log("no ALIVE / bars"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate((ll) => { __map.closePopup(); __map.setView(ll, 16, { animate: false }); }, LUD);
  await page.waitForFunction(() => (window.PN && PN.s.beers || []).length >= 10 && window.EVSHEET && EVSHEET._cache().rows.length > 0, null, { timeout: 20000 }).catch(() => console.log("no beers / events"));
  await wait(page, 800);
  return { ctx, page, errs };
}
const kinds = (page) => page.evaluate(() => { const n = (k) => document.querySelectorAll(".al-m.al-" + k).length;
  return { skal: n("skal"), event: n("event"), lively: n("lively"), glow: n("glow"), state: ALIVE._run() && ALIVE._state() }; });
const anim = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); const a = e ? e.getAnimations() : []; return a.length ? a[0].playState : "none"; }, sel);

(async () => {
  const b = await chromium.launch(launchOpts());
  try {
    /* ---------- 1. GL map: the three animated effects, pause, cap, night glow layer, off switch ---------- */
    {
      const { ctx, page, errs } = await open(b);
      await page.evaluate(() => ALIVE._run());
      const k = await kinds(page);
      ok(k.skal === 1, "clink at La Parma (4 people, 3 skål taps)", k);
      ok(k.lively === 1, "sparks at Pitchers (6 people, no skål)", k);
      ok(k.event === 1, "event pulse at Lobbybaren (quiz in 30 min)", k);
      const ids = k.state.anim.join();
      ok(/skal:x-la-parma-ludvika/.test(ids) && /lively:n3472634175/.test(ids) && /event:x-lobbybaren-ludvika/.test(ids), "each effect sits at the right bar: " + ids);
      ok(!/n3777|grek/i.test(ids) && k.state.anim.length === 3, "no effect at a bar with 1 person (k rule)", k.state.anim);
      ok(await anim(page, ".al-skal .al-gl") === "running", "clink animates (CSS, running)");
      const pe = await page.evaluate(() => getComputedStyle(document.querySelector(".al-m")).pointerEvents);
      ok(pe === "none", "effects never take a tap (pointer-events none)", pe);

      // pause: movestart -> paused; moveend -> running again
      await page.evaluate(() => __map.fire("movestart"));
      const st1 = await anim(page, ".al-lively i"), cls = await page.evaluate(() => __map.getPane("alive").classList.contains("al-move"));
      ok(st1 === "paused" && cls, "movestart pauses every effect", { st1, cls });
      await page.evaluate(() => __map.fire("moveend"));
      await wait(page, 500);
      ok(await anim(page, ".al-lively i") === "running", "moveend resumes the effects");
      // a real pan: paused while it moves
      const mid = await page.evaluate(() => new Promise((res) => { __map.panBy([120, 0], { animate: true, duration: 0.8 });
        setTimeout(() => { const e = document.querySelector(".al-event i"); res({ c: __map.getPane("alive").classList.contains("al-move"), s: e ? e.getAnimations()[0].playState : "none" }); }, 250); }));
      ok(mid.c && mid.s === "paused", "a real pan: paused in the middle of the move", mid);
      await wait(page, 1200);
      await page.evaluate((ll) => __map.setView(ll, 16, { animate: false }), LUD);
      await wait(page, 600);

      // cap: 30 + 30 + 30 fed signals -> 12 markers at most (clink 3, event 5)
      const cap = await page.evaluate((ll) => {
        const rows = (n, d) => Array.from({ length: n }, (_, i) => ({ lat: ll[0] + ((i % 6) - 3) * 4e-4 + d, lng: ll[1] + (Math.floor(i / 6) - 2) * 6e-4, bar_id: "t" + d + "_" + i }));
        ALIVE.feed("skal", rows(30, 1e-5)); ALIVE.feed("event", rows(30, 2e-5)); ALIVE.feed("lively", rows(30, 3e-5)); ALIVE._run();
        const n = (k) => document.querySelectorAll(".al-m.al-" + k).length;
        const out = { all: document.querySelectorAll(".al-m:not(.al-glow)").length, skal: n("skal"), event: n("event"), lively: n("lively") };
        ALIVE.feed("skal", []); ALIVE.feed("event", []); ALIVE.feed("lively", []); ALIVE._run();
        return out;
      }, LUD);
      ok(cap.all === 12 && cap.skal === 3 && cap.event === 5, "cap: 12 animated markers at most (clink 3, event 5)", cap);

      // 🌙 night glow: own GL source + layer under the bar layers; none by day
      const night = await page.evaluate(() => { ALIVE._clock(Date.parse("2026-11-13T21:00:00Z")); ALIVE._run();
        const g = BASEMAP.mapbox().getMapboxMap(), st = ALIVE._state(), lay = g.getStyle().layers.map((l) => l.id);
        const src = g.getSource(st.src), n = src && src._data && src._data.features ? src._data.features.length : -1;
        const gi = lay.indexOf(st.layer), bi = lay.findIndex((x) => /^olnu-/.test(x));
        return { gl: st.gl, glow: st.glow, n, under: gi >= 0 && (bi < 0 || gi < bi), night: st.night, dom: document.querySelectorAll(".al-glow").length }; });
      ok(night.gl && night.glow > 0 && night.n === night.glow && night.dom === 0, "night: quiet bars glow in the own GL layer (no DOM glows)", night);
      ok(night.under, "the glow layer is under the olnu bar layers", night);
      const day = await page.evaluate(() => { ALIVE._clock(Date.parse("2026-11-13T11:00:00Z")); ALIVE._run(); return ALIVE._state().glow; });
      ok(day === 0, "day: no glow", day);

      // off switch (settings row): nothing at all; on again: back
      const off = await page.evaluate(() => { ALIVE._clock(Date.parse("2026-11-13T21:00:00Z")); const row = ALIVE.settingsRow(); document.body.appendChild(row);
        const sw = row.querySelector("[role=switch]"), a0 = sw.getAttribute("aria-checked"); sw.click(); ALIVE._run();
        const r = { a0, a1: sw.getAttribute("aria-checked"), ls: localStorage.getItem("pn_alive_off"), n: document.querySelectorAll(".al-m").length, glow: ALIVE._state().glow };
        ALIVE._clock(null); sw.click(); ALIVE._run(); r.back = document.querySelectorAll(".al-m:not(.al-glow)").length; row.remove(); return r; });
      ok(off.a0 === "true" && off.a1 === "false" && off.ls === "1" && off.n === 0 && off.glow === 0, "Levande karta off: no effect, no glow", off);
      ok(off.back === 3, "Levande karta on again: the 3 effects are back", off);
      ok(!errs.length, "no page error from alive.js", errs);
      await ctx.close().catch(() => {});
    }
    /* ---------- 2. reduced motion: no animated marker, even with fed data ---------- */
    {
      const { ctx, page } = await open(b, { reduced: true });
      const r = await page.evaluate((ll) => { ALIVE.feed("skal", [{ lat: ll[0], lng: ll[1], bar_id: "x" }]); ALIVE._run();
        return { n: document.querySelectorAll(".al-m:not(.al-glow)").length, skip: ALIVE._state().skip, run: document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(".al-m")).length }; }, LUD);
      ok(r.n === 0 && r.skip === "reduced" && r.run === 0, "reduced motion: no animated effect at all", r);
      await ctx.close().catch(() => {});
    }
    /* ---------- 3. raster fallback (no Mapbox token): effects + at most 6 static DOM glows ---------- */
    {
      const { ctx, page } = await open(b, { noToken: true });
      const r = await page.evaluate(() => { ALIVE._clock(Date.parse("2026-11-13T21:00:00Z")); ALIVE._run(); const st = ALIVE._state();
        const g = document.querySelectorAll(".al-glow"); return { gl: st.gl, glow: g.length, anim: st.anim.length, still: g.length ? g[0].firstChild.getAnimations().length : 0 }; });
      ok(!r.gl && r.glow >= 1 && r.glow <= 6 && r.still === 0, "raster fallback: 1–6 static DOM glows (no GL)", r);
      ok(r.anim >= 2, "raster fallback: the animated effects still show", r);
      await ctx.close().catch(() => {});
    }
  } catch (e) { console.log("ERR " + e.stack); fail++; }
  await b.close();
  console.log((fail ? "FAIL " : "OK ") + pass + " pass, " + fail + " fail"); process.exit(fail ? 1 : 0);
})();
