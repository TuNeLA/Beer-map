// seasons-pw.js — lane seasons (owner 15 Nov 2026, I-115 / I-117 / I-120): the season look.
//  cal    each season starts and ends on the right dates (?date= / ?season= test hook, _force): dress, colour, GLÖGG, tap family
//  dress  the dressed ÖL! button: the piece is on the top-right rim (not on the label / Annat), GLÖGG is still ONE drink
//         (the same post_beer_v2 call as ÖL!), "Ångra" works and the timer runs while dressed, the "Vilken sort?" strip ends
//         above Annat
//  tap    the tap effect: today's family, behind the number, never the same one twice in a row, gone after its time;
//         reduced motion = no motion (one still mark); store build (OLNU_STORE) = no tap effect at all
//  map    GL: Christmas decorations are there and NOTHING covers a pin (bounding boxes of every drawn piece vs every bar icon,
//         bar name, my marker and DOM pin); the snow canvas has a hole at every pin; the 3D tree only in the tilted view;
//         store build keeps the map decorations; "Levande karta: av" = none
//  ends   every motion ends: snow 30 s, map twinkle 40 s, fireworks ~46 s (page clock)
// GL path: MAPBOX_TEST_TOKEN = the real Standard style; else a STUB Mapbox (like maplight-pw.js) + the __PN_SEASON_TILES hook
// (streets, a church, a park near the test bars). usage: node seasons-pw.js <port> [sections regex]
const { H, TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], ONLY = new RegExp(process.argv[3] || ".");
const BASE = "http://127.0.0.1:" + PORT + "/";
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 700))); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const BAR = { parma: [60.15124, 15.18797], pitch: [60.14997, 15.18679], lobby: [60.15098, 15.18663], grek: [60.15205, 15.18059] };
const LUD = [60.1505, 15.1872];
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let nid = 9000;
const P = (ll, o = {}) => ({ id: nid++, lat: ll[0], lng: ll[1], beer_count: 1, precise: true, created_at: iso(30), is_mine: !!o.mine, friend_name: o.f || null, skal_count: 0, i_skaled: false, shot_count: 0 });
const crowd = () => { const b = []; for (let i = 0; i < 16; i++) b.push(P(BAR.parma, i === 0 ? { f: "Oskar" } : {})); for (let i = 0; i < 9; i++) b.push(P(BAR.pitch, i === 1 ? { f: "Ida" } : {})); for (let i = 0; i < 4; i++) b.push(P(BAR.lobby)); return b; };
// the town for the stub style: Storgatan through the bars (+ a side street), a church, a park
const TILES = () => (sl) => {
  const L = (c, name, cls) => ({ properties: { name, class: cls }, geometry: { type: "LineString", coordinates: c } });
  if (sl === "road") return [L([[15.1840, 60.1488], [15.1868, 60.1499], [15.1883, 60.1510], [15.1900, 60.1522]], "Storgatan", "pedestrian"), L([[15.1830, 60.1517], [15.1920, 60.1495]], "Eriksgatan", "street")];
  if (sl === "poi_label") return [{ properties: { maki: "religious-christian", name: "Kyrkan", class: "religion" }, geometry: { type: "Point", coordinates: [15.1883, 60.1532] } }];
  if (sl === "landuse") return [{ properties: { class: "park" }, geometry: { type: "Polygon", coordinates: [[[15.1795, 60.1470], [15.1825, 60.1470], [15.1825, 60.1484], [15.1795, 60.1484], [15.1795, 60.1470]]] } }];
  return [];
};

async function open(b, mode, o = {}) {
  const { ctx, page } = await H.ctxFor(b, { width: 390, height: 844 }, { reduced: !!o.reduced, checkin: o.checkin });
  if (o.clock) await page.clock.install();
  const S = { beers: crowd(), posts: [], undos: 0 };
  await ctx.setGeolocation({ latitude: 60.14997, longitude: 15.18679 });   // at Pitchers (checked in there: no where-sheet)
  await page.route(/rest\/v1\/rpc\/live_beers/, (r) => J(r, S.beers));
  await page.route(/rest\/v1\/rpc\/live_others/, (r) => J(r, []));
  await page.route(/rest\/v1\/rpc\/post_beer_v2/, (r) => { S.posts.push(r.request().postDataJSON() || {}); J(r, { accepted: true, beer_count: 3, drinks: 3, lat: 60.14997, lng: 15.18679, precise: true,
    expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() }); });
  await page.route(/rest\/v1\/rpc\/undo_beer/, (r) => { S.undos++; J(r, { ok: true, undone: true }); });
  if (mode === "gl" && !TOKEN) await ctx.addInitScript(`window.__PN_SEASON_TILES = (${TILES.toString()})();`);
  const q = o.query || "";
  let url = BASE + q;
  if (mode === "gl") {
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN || STUB_TOKEN }));
    if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
    await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
      const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
      try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
        await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
      } catch (e) { r.abort().catch(() => {}); }
    });
    url = "https://tunela.github.io/Beer-map/" + q;
  } else await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: "" }));
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message.slice(0, 200)); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (mode === "gl") await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  else await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill, .cm").length > 2, null, { timeout: 30000 }).catch(() => console.log("no pins"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => { window.__gm = () => BASEMAP.mapbox().getMapboxMap(); }).catch(() => {});
  await wait(page, 1500);
  return { ctx, page, errs, S };
}
const view = async (page, ll, z, ms) => { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await wait(page, ms || 1500); };
const force = (page, o) => page.evaluate((o) => PNSeason._force(o), o);
const inter = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/* ---------- cal + dress + tap (raster map: no Mapbox needed) ---------- */
async function runUI(b) {
  if (ONLY.test("cal")) {
    const { ctx, page, errs } = await open(b, "fb", { query: "?date=2026-12-13T20:00" });
    const st = () => page.evaluate(() => { const s = PNSeason.now(); return { key: s.key, tap: s.tap, dress: PNDress.state().dress, color: PNDress.state().color, glogg: PNDress.state().glogg, label: PNDress.state().label, lucia: s.map.lucia, adv: s.map.advent, fw: s.map.fireworks, fire: s.map.fire, cls: document.body.className }; });
    let s = await st();
    ok(s.key === "lucia" && s.lucia && s.adv === 3 && s.dress === "santa" && s.glogg && s.label === "GLÖGG" && /ss-c-xmas/.test(s.cls), "?date=2026-12-13T20:00: Lucia, 3rd Advent, Santa hat, the Christmas colour, GLÖGG", s);
    const C = [["2026-11-30T23:00", { key: "normal", dress: "", color: "", glogg: false, label: "ÖL!" }], ["2026-12-01T00:30", { key: "xmas", dress: "santa", glogg: true }],
      ["2026-12-27T20:00", { key: "xmas", dress: "santa", glogg: false, label: "ÖL!" }], ["2026-12-31T18:30", { key: "newyear", dress: "party", color: "newyear", glogg: false }],
      ["2027-01-01T00:05", { key: "newyear", fw: true }], ["2027-01-01T03:05", { key: "xmas", fw: false }], ["2027-01-14T20:00", { key: "winter", dress: "", tap: "normal" }],
      ["2027-04-30T19:00", { key: "valborg", dress: "cap", color: "valborg", fire: true, tap: "valborg" }], ["2027-05-02T20:00", { key: "spring", dress: "", tap: "spring" }],
      ["2027-06-25T22:00", { key: "midsummer", dress: "crown", color: "midsummer", tap: "midsummer" }], ["2026-10-10T20:00", { key: "autumn", dress: "leaves", color: "autumn", tap: "autumn" }]];
    for (const [d, want] of C) { await force(page, { date: d, wx: "none" }); await wait(page, 150); s = await st();
      const bad = Object.keys(want).filter((k) => s[k] !== want[k]); ok(!bad.length, "date " + d + ": " + JSON.stringify(want), { got: s, bad }); }
    await force(page, { date: "2027-02-12T20:00", wx: "snow" }); await wait(page, 150); s = await st();
    ok(s.dress === "+snow", "snow weather: snow lies on the button (snow cap), no hat in winter", s);
    ok(errs.length === 0, "cal: no page error", errs);
    await ctx.close();
  }
  if (ONLY.test("dress")) {
    const { ctx, page, errs, S } = await open(b, "fb");
    // ÖL! on a normal day, then GLÖGG at Christmas: the same post_beer_v2 call (keys), one drink each
    await force(page, { season: "normal", wx: "none" }); await wait(page, 300);
    await page.click("#btn-beer"); await wait(page, 2500);
    const k0 = S.posts.length ? Object.keys(S.posts[0]).sort().join(",") : "";
    await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("olnu.night") || "{}"); m.lastTap = 0; localStorage.setItem("olnu.night", JSON.stringify(m)); PN.tickCooldown(); });
    await page.evaluate(() => { try { PN.s.meState && (PN.s.meState.undo_until = null); } catch (e) {} });
    await force(page, { season: "xmas", wx: "none" }); await wait(page, 13000);   // the first "Ångra" window ends
    await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("olnu.night") || "{}"); m.lastTap = 0; localStorage.setItem("olnu.night", JSON.stringify(m)); PN.tickCooldown(); });
    await wait(page, 300);
    const rest = await page.evaluate(() => { const rg = document.createRange(); rg.selectNodeContents(document.getElementById("beer-label")); const l = rg.getBoundingClientRect().toJSON(), o = document.getElementById("other-wrap"); return { label: document.getElementById("beer-label").textContent, lr: l, dress: PNDress.rects(), annat: o && !o.hidden ? o.getBoundingClientRect().toJSON() : null, mug: !!document.querySelector("#btn-beer .ss-mug:not([hidden])") }; });
    ok(rest.label === "GLÖGG" && rest.mug, "Christmas: the button says GLÖGG with the mug", rest);
    ok(rest.dress.length === 1 && !inter({ l: rest.dress[0].left, r: rest.dress[0].right, t: rest.dress[0].top, b: rest.dress[0].bottom }, { l: rest.lr.left, r: rest.lr.right, t: rest.lr.top, b: rest.lr.bottom }), "the Santa hat does not cover the label text", rest);
    ok(!rest.annat || !inter({ l: rest.dress[0].left, r: rest.dress[0].right, t: rest.dress[0].top, b: rest.dress[0].bottom }, { l: rest.annat.left, r: rest.annat.right, t: rest.annat.top, b: rest.annat.bottom }), "the hat does not touch Annat (top-left)", rest);
    await page.click("#btn-beer"); await wait(page, 2600);
    const k1 = S.posts.length > 1 ? Object.keys(S.posts[1]).sort().join(",") : "";
    ok(S.posts.length === 2 && k0 && k0 === k1, "GLÖGG is still ONE drink: the same post_beer_v2 call as ÖL! (" + k1 + ")", { n: S.posts.length, k0, k1 });
    const u = await page.evaluate(() => ({ cls: document.getElementById("btn-beer").className, label: document.getElementById("beer-label").textContent, dress: PNDress.state(), strip: (document.querySelector(".bp-strip:not([hidden])") || { getBoundingClientRect: () => null }).getBoundingClientRect(), annat: (document.getElementById("other-wrap") || { getBoundingClientRect: () => null }).getBoundingClientRect() }));
    ok(/undo/.test(u.cls) && /Ångra/.test(u.label) && u.dress.shown, "dressed: the button turns into Ångra after the tap, the hat stays", u);
    ok(!u.strip || !u.annat || u.strip.bottom <= u.annat.top - 4, "the 'Vilken sort?' strip ends above Annat (was: it covered its top 14 px)", { strip: u.strip, annat: u.annat });
    await page.click("#btn-beer"); await wait(page, 1500);
    ok(S.undos === 1, "dressed: a tap on Ångra undoes (undo_beer called once)", S.undos);
    // the wait: the glass with the timer, the hat still there
    await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("olnu.night") || "{}"); m.lastTap = Date.now() - (window.U.COOLDOWN_MS - 300000); localStorage.setItem("olnu.night", JSON.stringify(m)); PN.tickCooldown(); });
    await wait(page, 1500);
    const w = await page.evaluate(() => ({ cls: document.getElementById("btn-beer").className, label: document.getElementById("beer-label").textContent, dress: PNDress.state().shown }));
    ok(/cooldown/.test(w.cls) && /^\d:\d\d$/.test(w.label) && w.dress, "dressed: the timer runs in the glass (" + w.label + "), the hat stays", w);
    ok(errs.length === 0, "dress: no page error", errs);
    await ctx.close();
  }
  if (ONLY.test("tap")) {
    const { ctx, page, errs } = await open(b, "fb");
    for (const [season, fam] of [["xmas", "xmas"], ["newyear", "newyear"], ["midsummer", "midsummer"], ["valborg", "valborg"], ["autumn", "autumn"], ["normal", "normal"], ["spring", "spring"]]) {
      await force(page, { season, wx: "none" }); await wait(page, 100);
      const r = await page.evaluate(() => { document.querySelectorAll(".pm-burst,.ss-tap").forEach((x) => x.remove()); MYCOUNT._burst(3, 2); const h = document.querySelector(".pm-burst"), c = h && h.querySelector(".ss-tap"), kids = h ? [...h.children].map((x) => x.className) : [];
        return { fam: h && h.getAttribute("data-fam"), fx: PNTapFx.stats.last, canvas: !!c, order: kids, bits: h ? h.querySelectorAll(".pm-p").length : -1 }; });
      const ci = r.order.indexOf("ss-tap"), ni = r.order.findIndex((x) => /pm-num/.test(x));
      ok(r.fam === fam && r.canvas && ci >= 0 && ci < ni && r.bits === 0 && PNfams(fam).includes(r.fx), season + ": a " + fam + " tap effect (" + r.fx + "), its canvas BEHIND the number, no old emoji bits", r);
    }
    const rep = await page.evaluate(() => { let p = "", same = 0; for (let i = 0; i < 40; i++) { const x = PNTapFx._choose({ f: "xmas" }); if (x === p) same++; p = x; } return same; });
    ok(rep === 0, "never the same effect twice in a row (40 picks)", rep);
    await page.evaluate(() => { document.querySelectorAll(".pm-burst,.ss-tap").forEach((x) => x.remove()); MYCOUNT._burst(3, 2); });
    await wait(page, 2400);
    ok(await page.evaluate(() => !document.querySelector(".ss-tap") && PNTapFx.running() === 0), "the tap effect is gone after its time (every motion ends)");
    const calm = await page.evaluate(() => { document.querySelectorAll(".pm-burst").forEach((x) => x.remove()); MYCOUNT._burst(9, 8); const h = document.querySelector(".pm-burst"); return { tap: !!h.querySelector(".ss-tap"), mark: !!h.querySelector(".ss-mark") }; });
    ok(!calm.tap && calm.mark, "from 8 drinks: no effect, one still season mark (calm)", calm);
    ok(errs.length === 0, "tap: no page error", errs);
    await ctx.close();
    const rm = await open(b, "fb", { reduced: true });
    const r2 = await rm.page.evaluate(() => { PNSeason._force({ season: "xmas", wx: "none" }); MYCOUNT._burst(3, 2); const h = document.querySelector(".pm-burst"); return { tap: !!document.querySelector(".ss-tap"), mark: !!(h && h.querySelector(".ss-mark")) }; });
    ok(!r2.tap && r2.mark, "reduced motion: no moving effect, one still season mark", r2);
    await rm.ctx.close();
    const st = await open(b, "fb", { query: "?app=android" });
    const r3 = await st.page.evaluate(() => { PNSeason._force({ season: "xmas", wx: "none" }); MYCOUNT._burst(3, 2); return { store: !!window.OLNU_STORE, on: PNTapFx.on(), tap: !!document.querySelector(".ss-tap"), plays: PNTapFx.stats.plays, dress: PNDress.state().dress }; });
    ok(r3.store && !r3.on && !r3.tap && r3.plays === 0, "store build: no tap effect at all", r3);
    await st.ctx.close();
  }
}
const FAMS = { xmas: ["x1", "x2", "x3", "x4", "x5"], newyear: ["n1", "n2", "n3", "n4", "n5"], midsummer: ["m1", "m2", "m3", "m4", "m5"], valborg: ["v1", "v2", "v3", "v4", "v5"], autumn: ["a1", "a2", "a3", "a4", "a5"], normal: ["o1", "o2", "o3", "o4", "o5"], spring: ["o1", "o2", "o3", "o4", "o5", "v3", "v4", "v5"] };
function PNfams(f) { return FAMS[f] || []; }

/* ---------- map (GL) ---------- */
// the screen box of each DRAWN decoration (queryRenderedFeatures), sizes as in seasonmap.js
const decoBoxes = (page) => page.evaluate(() => {
  const m = __gm(), z = m.getZoom(), SIZE = { tree: [100, 132], advent: [74, 84], lucia: [84, 76], pole: [72, 124], fire: [92, 112] };
  const s = [[13, 0.32], [15, 0.55], [17, 0.9], [19, 1.3]]; let k = 1.3; for (let i = 1; i < s.length; i++) if (z <= s[i][0]) { k = s[i - 1][1] + (s[i][1] - s[i - 1][1]) * (z - s[i - 1][0]) / (s[i][0] - s[i - 1][0]); break; }
  const out = [];
  m.queryRenderedFeatures({ layers: ["pn-ss-deco", "pn-ss-bulb-core"].filter((l) => m.getLayer(l)) }).forEach((f) => { const p = m.project(f.geometry.coordinates), kk = f.properties.k, sz = SIZE[kk];
    if (!sz) out.push({ k: "bulb", l: p.x - 4, r: p.x + 4, t: p.y - 4, b: p.y + 4 }); else { const w = sz[0] * k * (f.properties.sz || 1), h = sz[1] * k * (f.properties.sz || 1); out.push({ k: kk, l: p.x - w / 2, r: p.x + w / 2, t: p.y - h, b: p.y }); } });
  return out;
});
// every pin box on screen: GL bar icons + names, my marker, every DOM marker (faces, people)
const pinBoxes = (page) => page.evaluate(() => {
  const out = GLBARS.rects().map((r) => ({ l: r.l, r: r.r, t: r.t, b: r.b, id: r.id }));
  const me = GLBARS._me(); if (me && me.px) out.push({ l: me.px.x - me.px.r, r: me.px.x + me.px.r, t: me.px.y - me.px.r, b: me.px.y + me.px.r, id: "me" });
  const c = __map.getContainer(), cr = c.getBoundingClientRect();
  c.querySelectorAll(".leaflet-marker-icon").forEach((el) => { if (el.offsetParent === null) return; const r = el.getBoundingClientRect(); if (r.width > 2 && r.width < 200) out.push({ l: r.left - cr.left, r: r.right - cr.left, t: r.top - cr.top, b: r.bottom - cr.top, id: "dom" }); });
  return out;
});
async function runGL(b) {
  if (ONLY.test("map") || ONLY.test("sky")) {
    const { ctx, page, errs } = await open(b, "gl", { query: "?season=xmas&wx=none&light=0" });
    let worst = [], drawn = 0;
    await page.waitForFunction(() => window.PNSeasonMap && PNSeasonMap.stats.feats > 0, null, { timeout: 30000 }).catch(() => {});
    for (const z of [17, 16.5, 16, 15.5, 15]) {
      await view(page, LUD, z, 2500);
      await page.evaluate(() => new Promise((res) => { const m = __gm(); let d = 0; const f = () => { if (!d) { d = 1; res(); } }; if (m.loaded() && !m.isMoving()) setTimeout(f, 300); m.once("idle", () => setTimeout(f, 300)); setTimeout(f, 8000); }));
      const d = await decoBoxes(page), p = await pinBoxes(page); drawn = Math.max(drawn, d.length);
      d.forEach((x) => p.forEach((y) => { if (inter(x, y)) worst.push({ z, k: x.k, pin: y.id }); }));
    }
    const st = await page.evaluate(() => PNSeasonMap.stats);
    ok(st.street && st.feats >= 2 && st.bulbs > 0, "Christmas: the shopping street found in the map data (" + st.street + "), tree + candles + " + st.bulbs + " bulbs, no hand list", st);
    ok(drawn > 0, "Christmas decorations are drawn on the map (" + drawn + " pieces at most in one view)", drawn);
    ok(worst.length === 0, "NOTHING covers a pin: no drawn decoration box touches a bar icon, a bar name, my marker or a DOM pin (5 zooms)", worst.slice(0, 8));
    // a layer in a basemap slot ("middle": the park pattern, the 3D tree) is drawn under every root layer (all bar layers are root)
    const lay = await page.evaluate(() => { const S = __gm().getStyle().layers, L = S.map((l) => l.id), first = L.findIndex((id) => /^olnu-(place|bar-)/.test(id));
      return { ss: PNSeasonMap._layers().map((id) => { const l = S.find((x) => x.id === id); return { id, i: L.indexOf(id), slot: l && l.slot || "" }; }), first }; });
    ok(lay.first < 0 || lay.ss.every((x) => x.slot === "middle" || x.slot === "bottom" || (x.i >= 0 && x.i < lay.first)), "every decoration layer is UNDER the bar layers", lay);
    // the 3D tree only in the tilted view
    const tp = await page.evaluate(() => PNSeasonMap.stats.tree); if (tp) await view(page, [tp[1], tp[0]], 17, 2000);
    const t3 = await page.evaluate(async () => { const m = __gm(), vis = () => m.getLayer("pn-ss-tree3d") ? m.getLayoutProperty("pn-ss-tree3d", "visibility") : "none"; const a = vis(); m.setMaxPitch(70); m.jumpTo({ pitch: 50 }); m.fire("pitchend"); await new Promise((r) => setTimeout(r, 800)); const c = vis(); m.jumpTo({ pitch: 0 }); m.fire("pitchend"); await new Promise((r) => setTimeout(r, 600)); const tr = PNSeasonMap.feats().filter((x) => x.k === "tree")[0]; return { flat: a, tilt: c, model: PNSeasonMap.stats.model, tree: !!tr, hidden: tr ? tr.h : 1 }; });
    ok(t3.flat !== "visible" && (!t3.model || !t3.tree || t3.hidden || t3.tilt === "visible") && t3.tree && !t3.hidden, "the real 3D tree shows only in the tilted view (and the drawn tree is shown flat)", t3);
    // the snow canvas: snow falls, and every pin centre stays clear (a hole)
    await view(page, LUD, 16, 1500);
    await force(page, { wx: "snow3" }); await wait(page, 3000);
    const sk = await page.evaluate(() => { const c = document.querySelector(".ss-sky"), g = c && c.getContext("2d"), R = c ? c.width / c.clientWidth : 1, rs = GLBARS.rects().filter((r) => !r.lbl);
      let sum = 0; if (g) { const d = g.getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 64) sum += d[i]; }
      const at = rs.map((r) => { const x = Math.round((r.l + r.r) / 2 * R), y = Math.round((r.t + r.b) / 2 * R); return x > 0 && y > 0 && x < c.width && y < c.height ? g.getImageData(x, y, 1, 1).data[3] : 0; });
      return { active: PNSky.active(), sum, pins: rs.length, at, holes: PNSky.stats.holes }; });
    ok(sk.active.includes("snow") && sk.sum > 0, "snow weather: our own snow falls on the map", sk);
    ok(sk.pins > 0 && sk.at.every((a) => a === 0), "the snow canvas has a hole at every bar icon (nothing falls ON a pin)", sk);
    await force(page, { wx: "none" });
    ok(errs.length === 0, "map: no page error", errs);
    await ctx.close();
  }
  if (ONLY.test("map")) {
    const st = await open(b, "gl", { query: "?season=xmas&wx=none&app=android" });
    await view(st.page, LUD, 16, 2500);
    await st.page.waitForFunction(() => window.PNSeasonMap && PNSeasonMap.stats.feats > 0, null, { timeout: 30000 }).catch(() => {});
    const r = await st.page.evaluate(() => ({ store: !!window.OLNU_STORE, feats: PNSeasonMap.stats.feats, bulbs: PNSeasonMap.stats.bulbs }));
    ok(r.store && r.feats > 0, "store build: the map decorations stay (no drinking celebration in them)", r);
    await st.ctx.close();
    const off = await open(b, "gl", { query: "?season=xmas&wx=snow" });
    await off.page.evaluate(() => { localStorage.setItem("pn_alive_off", "1"); PNSeason._force({ season: "xmas", wx: "snow" }); PNSky._plan(); PNSeasonMap._build(); });
    await view(off.page, LUD, 16, 2000);
    const r2 = await off.page.evaluate(() => ({ feats: PNSeasonMap.stats.feats, bulbs: PNSeasonMap.stats.bulbs, sky: PNSky.active() }));
    ok(r2.feats === 0 && r2.bulbs === 0 && r2.sky.length === 0, "'Levande karta: av': no decorations and no snow", r2);
    await off.ctx.close();
  }
  if (ONLY.test("ends")) {
    const { ctx, page, errs } = await open(b, "gl", { clock: true, query: "?season=xmas&wx=snow&light=0" });
    await view(page, LUD, 16, 2000);
    await page.waitForFunction(() => window.PNSky && PNSky.active().includes("snow") && PNSeasonMap.stats.anim > 0, null, { timeout: 30000 }).catch(() => {});
    const a0 = await page.evaluate(() => ({ sky: PNSky.active(), anim: PNSeasonMap.stats.anim }));
    for (let i = 0; i < 14; i++) await page.clock.fastForward(3000);   // 42 s: jump (fire each timer once), do not draw every frame
    await page.clock.runFor(100); await wait(page, 600);
    const a1 = await page.evaluate(() => { const c = document.querySelector(".ss-sky"), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 3; i < d.length; i += 64) s += d[i]; return { sky: PNSky.active(), sum: s, anim: PNSeasonMap.stats.anim }; });
    await page.clock.fastForward(6000); await page.clock.runFor(100); await wait(page, 300);
    const a2 = await page.evaluate(() => PNSeasonMap.stats.anim);
    ok(a0.sky.includes("snow") && a1.sky.length === 0 && a1.sum === 0, "snow ends by 30 s (+ fade): no scene, an empty canvas", { a0, a1 });
    ok(a1.anim > a0.anim && a2 === a1.anim, "the twinkle on the map stops by 40 s (no more steps)", { a0: a0.anim, a1: a1.anim, a2 });
    await page.evaluate(() => { PNSeason._force({ season: "fireworks", wx: "none" }); PNSky.add(PNSkyFx.fireworks()); });
    await page.clock.runFor(1000); const f0 = await page.evaluate(() => PNSky.active());
    for (let i = 0; i < 16; i++) await page.clock.fastForward(3000); await page.clock.runFor(100); await wait(page, 400); const f1 = await page.evaluate(() => PNSky.active());
    ok(f0.includes("fireworks") && !f1.includes("fireworks"), "the fireworks show ends (about 46 s)", { f0, f1 });
    ok(errs.length === 0, "ends: no page error", errs);
    await ctx.close();
  }
}
(async () => {
  console.log("seasons " + (TOKEN ? "real token" : "stub GL"));
  const b = await chromium.launch(launchOpts(["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]));
  try { await runUI(b); } catch (e) { ok(false, "exception " + e.message.split("\n")[0]); }
  try { await runGL(b); } catch (e) { ok(false, "exception " + e.message.split("\n")[0]); }
  await b.close();
  console.log("\nseasons-pw: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
