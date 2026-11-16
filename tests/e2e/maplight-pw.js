// maplight-pw.js — lane maplight (owner 15 Nov 2026, I-115): the map shows where the life is.
//  A  street light: warm light on the street pieces near a busy bar (reach 60 / 95 / 140 m by crowd step, brightest at the door)
//  B  lantern pin: the bar disc by crowd step (3-7 / 8-14 / 15+ people); C halo under the pin; E one ring on a check-in
//  Under 3 people: NO light, no halo, no lantern, no ring for a stranger. A poll with the same data sends nothing.
//  Town view: bars with people that would sit on each other = ONE lantern with the summed count.
//  My marker: always the top layer, never on a bar icon (it stands beside it). Friends = faces in the row under the disc.
//  Foam: gone (one rule for every state and size). Heat: one amber hue, gone from GL zoom 14.6.
//  Kill switch ?barlight=0 (PN.CFG.barlight): everything of the light is off, the old heat is back.
// Paths: gl = Mapbox GL (MAPBOX_TEST_TOKEN, else a STUB Mapbox like mapfix-pw.js; roads from the __PN_ROADS hook), fb = raster.
// usage: node maplight-pw.js <port> [sections regex: light|poll|ring|still|me|foam|heat|town|kill|perf|raster]
// MAPLIGHT_OLD=<dir with the old glmap.js mapart.js app-pins.js avpins.js index.html>: run on the old code (checks must FAIL).
const { H, TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const PORT = process.argv[2], ONLY = new RegExp(process.argv[3] || "."), OLD = process.env.MAPLIGHT_OLD || "";
const BASE = "http://127.0.0.1:" + PORT + "/";
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 700))); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const LUD = [60.1505, 15.1872], PIT = "n3472634175", LOBBY = "x-lobbybaren-ludvika", PARMA = "x-la-parma-ludvika", GREK = "x-grekiska-grill-bar-ludvika";
const BAR = { parma: [60.15124, 15.18797], pitch: [60.14997, 15.18679], lobby: [60.15098, 15.18663], grek: [60.15205, 15.18059] };
const AWAY = [60.1452, 15.1745];   // the lake shore park: no bar / food icon there
const OLDRE = /\/(js\/(glmap|mapart|app-pins|avpins|barlight)\.js|index\.html|barlight\.css)$/;
const oldBody = (p) => { if (!OLD || !OLDRE.test(p)) return null; const f = path.join(OLD, path.basename(p)); return fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from(""); };
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let nid = 7000;
const P = (ll, o = {}) => ({ id: nid++, lat: ll[0], lng: ll[1], beer_count: 1, precise: true, created_at: iso(30), is_mine: !!o.mine, friend_name: o.f || null, skal_count: 0, i_skaled: false, shot_count: 0 });
// the crowd: 16 at La Parma (2 friends), 9 at Pitchers (1 friend), 4 at Lobbybaren, 2 at Grekiska
function crowd(o = {}) {
  const b = [], n = Object.assign({ parma: 16, pitch: 9, lobby: 4, grek: 2 }, o);
  for (let i = 0; i < n.parma; i++) b.push(P(BAR.parma, i === 0 ? { f: "Oskar" } : i === 1 ? { f: "Lisa" } : {}));
  for (let i = 0; i < n.pitch; i++) b.push(P(BAR.pitch, i === 1 ? { f: "Ida" } : {}));
  for (let i = 0; i < n.lobby; i++) b.push(P(BAR.lobby));
  for (let i = 0; i < n.grek; i++) b.push(P(BAR.grek));
  return b;
}
const CI = (bar, id, name, o = {}) => ({ bar_id: id, bar_name: name, lat: bar[0], lng: bar[1], name: o.who || "Kalle K", is_mine: !!o.mine, is_friend: !!o.friend, created_at: o.at || new Date().toISOString() });
// roads for the stub style: two streets crossing at every bar (lines 400 m long, a little off the bar point)
const ROADS = () => { const out = [], m = (lat) => [1 / (111320 * Math.cos(lat * Math.PI / 180)), 1 / 110540];
  [[60.15124, 15.18797], [60.14997, 15.18679], [60.15098, 15.18663], [60.15205, 15.18059]].forEach(([la, ln]) => { const [kx, ky] = m(la), y = la + 12 * ky, x = ln + 10 * kx;
    out.push([[ln - 200 * kx, y], [ln, y], [ln + 200 * kx, y]], [[x, la - 200 * ky], [x, la], [x, la + 200 * ky]]); });
  return out; };

async function open(b, mode, o = {}) {
  const { ctx, page } = await H.ctxFor(b, { width: 390, height: 844 }, { reduced: !!o.reduced, checkin: false });
  const S = { beers: crowd(o.crowd), checkins: o.checkins || [] };
  await page.route(/rest\/v1\/rpc\/live_beers/, (r) => J(r, S.beers));
  await page.route(/rest\/v1\/rpc\/live_others/, (r) => J(r, []));
  await page.route(/rest\/v1\/rpc\/live_checkins/, (r) => J(r, S.checkins));
  await page.route(/rest\/v1\/rpc\/heat_points/, (r) => J(r, S.beers.map((x) => ({ lat: x.lat, lng: x.lng, w: 1 }))));
  if (mode === "gl" && !TOKEN) await ctx.addInitScript(`window.__PN_ROADS = ${ROADS.toString()};`);
  let url = BASE + (o.query || "");
  if (mode === "gl") {
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN || STUB_TOKEN }));
    if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
    await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
      const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
      const ob = oldBody(p); if (ob) return r.fulfill({ status: 200, contentType: /\.css$/.test(p) ? "text/css" : /\.html$/.test(p) ? "text/html" : "text/javascript", body: ob });
      try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
        await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
      } catch (e) { r.abort().catch(() => {}); }
    });
    url = "https://tunela.github.io/Beer-map/" + (o.query || "");
  } else {
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: "" }));
    if (OLD) await page.route((u) => u.href.startsWith(BASE) && OLDRE.test(u.pathname), (r) => { const ob = oldBody(new URL(r.request().url()).pathname); return ob ? r.fulfill({ status: 200, body: ob }) : r.fallback(); });
  }
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message.slice(0, 200)); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (mode === "gl") await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  else await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill, .cm").length > 2, null, { timeout: 30000 }).catch(() => console.log("no pins"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => { window.__gm = () => BASEMAP.mapbox().getMapboxMap(); }).catch(() => {});
  await wait(page, 2500);
  return { ctx, page, errs, S };
}
const view = async (page, ll, z, ms) => { await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [ll, z]); await wait(page, ms || 1500); };
const poll = async (page, ms) => { await page.evaluate(() => { try { PN.refresh(); } catch (e) {} }); await wait(page, ms || 1500); };
// the light is built (roads read, pieces sent) for the lit bars
const built = (page) => page.waitForFunction(() => window.BARLIGHT && BARLIGHT._state().lit.length >= 3 && BARLIGHT._state().lit.every((b) => BARLIGHT._state().cache[b.id]), null, { timeout: 15000 }).catch(() => {});

async function runGL(b) {
  /* ---------- light: steps, under 3, layers, halo, lantern, street pieces ---------- */
  if (ONLY.test("light") || ONLY.test("poll")) {
    const { ctx, page, errs, S } = await open(b, "gl");
    await view(page, LUD, 16, 2000); await built(page); await wait(page, 2500);
    const L = await page.evaluate(() => {
      const B = window.BARLIGHT, g = __gm(), st = B ? B._state() : null, src = (id) => { try { return g.getSource(id)._data.features || []; } catch (e) { return []; } };
      const lines = src("pn-light"), pts = src("pn-light-pts"), byLv = {}, byBar = {};
      lines.forEach((f) => { byLv[f.properties.lv] = Math.max(byLv[f.properties.lv] || 0, f.properties.d); });
      const v = GLBARS._view() || [], di = {}; (GLBARS._feats() || []).forEach((f) => { di[f.id] = f.di || f.img || ""; });
      return { on: !!(B && B.on()), st, ids: g.getStyle().layers.map((l) => l.id).filter((id) => /^pn-light/.test(id)), lines: lines.length, byLv, minD: lines.reduce((a, f) => Math.min(a, f.properties.d), 1e9),
        pts: pts.map((f) => [f.properties.id, f.properties.lv]), haloR: JSON.stringify(g.getPaintProperty("pn-light-halo-a", "circle-radius")), op: JSON.stringify(g.getPaintProperty("pn-light-core", "line-opacity")),
        lv: v.reduce((o, x) => { o[x.id] = x.lv; return o; }, {}), di };
    });
    ok(L.on && L.st && L.st.ready, "light: BARLIGHT is on and its GL layers are ready", L.st);
    const lv = (id) => (L.st.lit.find((x) => x.id === id) || {}).lv;
    ok(lv(PARMA) === 3 && lv(PIT) === 2 && lv(LOBBY) === 1, "steps: 16 people = step 3, 9 = step 2, 4 = step 1", L.st.lit);
    ok(!L.st.lit.some((x) => x.id === GREK), "under 3 people (Grekiska, 2): not in the light list", L.st.lit);
    ok(L.ids.length === 4, "layers: exactly 4 light layers (2 street lines + 2 halo circles)", L.ids);
    ok(L.pts.length === 3 && L.pts.some((p) => p[0] === PARMA && p[1] === 3) && !L.pts.some((p) => p[0] === GREK), "halo: one point per lit bar, with its step; none for the bar with 2 people", L.pts);
    ok(/16,\["match",\["get","lv"\],1,36,2,52\.2\d*,72\]/.test(L.haloR), "halo size by step: 36 / 52 / 72 px at GL zoom 16 (40 / 58 / 80 x 0.9)", L.haloR);
    ok(/-l3-/.test(L.di[PARMA] || "") && /-l2-/.test(L.di[PIT] || "") && /-l1-/.test(L.di[LOBBY] || ""), "lantern: the dot image of each bar is the one of its step (-l3- / -l2- / -l1-)", [L.di[PARMA], L.di[PIT], L.di[LOBBY]]);
    ok(!/-l\d-/.test(L.di[GREK] || ""), "under 3 people: no lantern image on Grekiska", L.di[GREK]);
    ok(L.lines > 20 && L.minD === 0, "street light: pieces on the streets near the lit bars, the first one at the door (d = 0)", [L.lines, L.minD]);
    ok(L.byLv[1] < 60 && L.byLv[2] < 95 && L.byLv[3] < 140 && L.byLv[3] > 95, "street light: reach 60 / 95 / 140 m by step", L.byLv);
    ok(!(GREK in (L.st.pieces || {})), "under 3 people: no street pieces", L.st.pieces);
    ok(/feature-state/.test(L.op) && /"d"/.test(L.op), "street light: the opacity falls with the distance d; the spread runs on feature-state", L.op.slice(0, 160));
    const idle = await page.evaluate(() => new Promise((r) => { const f0 = BARLIGHT.stats.frames; setTimeout(() => r({ d: BARLIGHT.stats.frames - f0, anim: BARLIGHT._state().anim, spreads: BARLIGHT.stats.spreads }), 1500); }));
    ok(idle.d === 0 && !idle.anim, "idle: no animation frame work after the light has spread", idle);
    ok(idle.spreads >= 1, "the light spread once when the map opened (motion allowed here)", idle);
    await page.screenshot({ path: require("./env.js").OUT + "maplight-gl-z16.png" }).catch(() => {});
    /* ---------- poll: the same data rebuilds nothing; a step up sends once ---------- */
    const a = await page.evaluate(() => ({ s: Object.assign({}, BARLIGHT.stats), g: GLBARS.stats.sets, n: __gm().getStyle().layers.length }));
    await poll(page); await poll(page);
    const c = await page.evaluate(() => ({ s: Object.assign({}, BARLIGHT.stats), g: GLBARS.stats.sets, n: __gm().getStyle().layers.length }));
    ok(c.s.sets >= a.s.sets + 2, "setup: two more polls reached BARLIGHT.set", [a.s.sets, c.s.sets]);
    ok(c.s.ptSets === a.s.ptSets && c.s.lineSets === a.s.lineSets && c.s.builds === a.s.builds && c.s.spreads === a.s.spreads && c.g === a.g && c.n === a.n,
      "a poll with the same data: no light data sent, no roads read, no spread, the bar source not sent again, no layer added", { a, c });
    S.beers = crowd({ lobby: 9 }); await poll(page, 2500);
    const d = await page.evaluate(() => Object.assign({}, BARLIGHT.stats));
    ok(d.ptSets === c.s.ptSets + 1 && d.lineSets === c.s.lineSets + 1, "a bar goes up a step: its halo + street data are sent once", [c.s, d]);
    ok(d.spreads === c.s.spreads + 1, "a bar goes up a step: the light spreads once more", [c.s.spreads, d.spreads]);
    ok(d.builds === c.s.builds, "a step change reads no roads again (the pieces of a bar are made once)", [c.s.builds, d.builds]);
    ok(errs.length === 0, "light: no page error", errs);
    await ctx.close();
  }
  /* ---------- ring ---------- */
  if (ONLY.test("ring")) {
    const { ctx, page, errs, S } = await open(b, "gl");
    await view(page, LUD, 16, 2000);
    const rings = () => page.evaluate(() => ({ n: document.querySelectorAll(".bl-ring").length, total: BARLIGHT.stats.rings }));
    const r0 = await rings();
    S.checkins = [CI(BAR.pitch, PIT, "Pitchers", { who: "Kalle K" })]; await poll(page, 300);
    await page.waitForFunction((t) => BARLIGHT.stats.rings > t && document.querySelector(".bl-ring>i"), r0.total, { timeout: 6000, polling: 50 }).catch(() => {});
    const r1 = await rings(), last = await page.evaluate(() => BARLIGHT.stats.lastRing);
    ok(r1.total === r0.total + 1 && last === "n3472634175", "ring: a check-in that arrives in the poll = one ring at that bar", [r0, r1, last]);
    // the ring itself (the same function, called here so the DOM check does not race the poll)
    const an = await page.evaluate(async () => { BARLIGHT._ring({ id: "t", lat: 60.14997, lng: 15.18679 }); for (let i = 0; i < 20 && !document.querySelector(".bl-ring>i"); i++) await new Promise((r) => setTimeout(r, 50));
      const i = document.querySelector(".bl-ring>i"); return i ? getComputedStyle(i).animationName + "|" + getComputedStyle(i).animationDuration : ""; });
    ok(/blRing/.test(an) && /2s/.test(an), "ring: 2 s, once (CSS, transform + opacity)", an);
    const r1b = await rings();   // (after the direct ring above)
    await poll(page, 1500); const r2 = await rings();
    ok(r2.total === r1b.total, "ring: the same check-in in the next poll = no second ring", [r1b, r2]);
    S.checkins.push(CI(BAR.pitch, PIT, "Pitchers", { who: "Nisse N" })); await poll(page, 1500); const r3 = await rings();
    ok(r3.total === r2.total, "ring: a second check-in at the same bar inside 10 s = no ring", [r2, r3]);
    S.checkins.push(CI(BAR.grek, GREK, "Grekiska", { who: "Okänd" })); await poll(page, 1500); const r4 = await rings();
    ok(r4.total === r3.total, "ring: a stranger checks in at a bar with under 3 people = no ring (never point at one person)", [r3, r4]);
    S.checkins.push(CI(BAR.lobby, LOBBY, "Lobbybaren", { who: "Gammal G", at: iso(40) })); await poll(page, 1500); const r5 = await rings();
    ok(r5.total === r4.total, "ring: an old check-in (40 min) that shows up now = no ring", [r4, r5]);
    await wait(page, 2400); const r6 = await rings();
    ok(r6.n === 0, "ring: its element is removed after 2 s", r6);
    ok(errs.length === 0, "ring: no page error", errs);
    await ctx.close();
  }
  /* ---------- reduced motion: the still light, no spread, no ring ---------- */
  if (ONLY.test("still")) {
    const { ctx, page, errs, S } = await open(b, "gl", { reduced: true });
    await view(page, LUD, 16, 2000); await built(page); await wait(page, 1500);
    const s = await page.evaluate(() => { const g = __gm(), n = (id) => { try { return g.getSource(id)._data.features.length; } catch (e) { return 0; } };
      return { pts: n("pn-light-pts"), lines: n("pn-light"), spreads: BARLIGHT.stats.spreads, frames: BARLIGHT.stats.frames, motion: BARLIGHT._state().motion }; });
    ok(s.pts === 3 && s.lines > 20, "reduced motion: the still light is there (halo + street pieces)", s);
    ok(s.spreads === 0 && s.frames === 0 && s.motion === false, "reduced motion: the light does not spread (no frame work)", s);
    S.checkins = [CI(BAR.pitch, PIT, "Pitchers")]; await poll(page, 500);
    ok(await page.evaluate(() => document.querySelectorAll(".bl-ring").length === 0), "reduced motion: no ring on a check-in");
    ok(errs.length === 0, "still: no page error", errs);
    await ctx.close();
  }
  /* ---------- my marker + friends ---------- */
  if (ONLY.test("me")) {
    const { ctx, page, errs, S } = await open(b, "gl");
    // flakefix (CI: "covers no other bar's name" why "left", and "me z13.5" drawn:0): a fixed 1.6 s wait read my marker before
    // its check had run / before GL had drawn it. Now: wait until the marker check is done (GLBARS._me().busy) and GL is idle.
    const meSettle = async () => {
      await page.waitForFunction(() => !GLBARS._me().busy, null, { timeout: 15000 }).catch(() => console.log("me check still busy"));
      await page.evaluate(() => new Promise((res) => { const g = __gm(), t = setTimeout(res, 8000); g.once("idle", () => { clearTimeout(t); res(); }); g.triggerRepaint(); }));
    };
    const meAt = async (ll, z) => { await page.evaluate(([ll, z]) => { __map.closePopup(); GLBARS.me(ll[0], ll[1]); __map.setView(ll, z, { animate: false }); }, [ll, z]); await wait(page, 400); await meSettle(); };
    const me = (id) => page.evaluate((id) => { const g = __gm(), m = GLBARS._me(), ids = g.getStyle().layers.map((l) => l.id), drawn = g.getLayer("olnu-me-pin") ? g.queryRenderedFeatures({ layers: ["olnu-me-pin"] }).length : -1;
      const bar = id ? (GLBARS._view() || []).find((x) => x.id === id) : null, c = Object.values(GLBARS._crowds ? GLBARS._crowds() : {}).find((q) => id && q.ids.includes(id)), cp = c ? __map.latLngToContainerPoint(c.ll) : null;
      // the icon my marker stands beside: the bar's own pin, its town lantern, or what GLBARS says covers my position (a cluster)
      const cv = m.cov || m.at, k = m.px && m.r ? m.px.r / m.r : 1, q = cv ? __map.latLngToContainerPoint(cv.ll) : null;
      const ic = bar && bar.shown ? { x: bar.x, y: bar.y, r: bar.icoW / 2 } : cp ? { x: cp.x, y: cp.y, r: c.r * 0.75 } : q ? { x: q.x, y: q.y, r: cv.r * (cv.sz || 1) * k } : null;
      // the top layer = the last one without a style slot (map3d's 3D houses / arenas sit in the slot "middle", under the labels)
      const own = g.getStyle().layers.filter((l) => !l.slot).map((l) => l.id);
      return { top: own[own.length - 1], drawn, px: m.px, img: m.img, k: m.k, cov: m.cov && m.cov.id, ic, gap: ic && m.px ? Math.hypot(m.px.x - ic.x, m.px.y - ic.y) - ic.r - m.px.r : null,
        dom: [...document.querySelectorAll(".me-dot")].filter((e) => e.offsetParent && getComputedStyle(e).display !== "none").length, old: ["olnu-me-dot", "olnu-me-ring", "olnu-me-du"].filter((l) => g.getLayer(l)) }; }, id || null);
    for (const z of [13.5, 16, 17.5]) {
      await meAt(BAR.pitch, z);
      const m = await me(PIT);
      ok(m.top === "olnu-me-pin" && m.drawn === 1 && !!m.px, "me z" + z + ": my position = the Pitchers position: my marker is drawn, in the TOP layer", m);
      ok(m.ic && m.gap != null && m.gap > -4, "me z" + z + ": my marker stands beside the icon there, not on it (gap " + (m.gap == null ? "?" : m.gap.toFixed(1)) + " px)", m);
      if (z === 16) await page.screenshot({ path: require("./env.js").OUT + "maplight-me-at-bar.png" }).catch(() => {});
    }
    const m0 = await me(PIT);
    ok(m0.old.length === 0 && m0.dom === 0, "me: no ring layer round the bar icon any more, no DOM dot over the GL map", m0);
    await meAt(AWAY, 16.5); const aw = await me(null);
    const here = await page.evaluate(() => { const m = GLBARS._me(), p = __gm().project([m.ll[1], m.ll[0]]); return m.px ? Math.hypot(p.x - m.px.x, p.y - m.px.y) : 99; });
    ok(aw.drawn === 1 && !aw.cov && aw.k === "me" && here < 1, "me away from every icon: my marker exactly at my own position", [aw, here]);
    // flakefix: a slow phone (6x CPU) for this step: the old code chose the side before GL had placed the names (5 of 6 runs red)
    const cdpX = await ctx.newCDPSession(page); await cdpX.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    S.checkins = [CI(BAR.pitch, PIT, "Pitchers", { who: "Anton", mine: true, at: iso(20) })]; await poll(page, 800); await meAt(AWAY, 16); await view(page, LUD, 16, 400); await meSettle();
    const ci = await me(PIT);
    ok(ci.drawn === 1 && ci.k === "at" && /(Du|You)$/.test(ci.img) && ci.gap > -4, "me checked in at Pitchers (my GPS elsewhere): my marker with the Du tag beside the Pitchers icon", ci);
    const nm = await page.evaluate((id) => { const g = __gm(), m = GLBARS._me().px, r = m ? m.r * 0.8 : 0;
      const f = m ? g.queryRenderedFeatures([[m.x - r, m.y - r], [m.x + r, m.y + r]], { layers: ["olnu-bar-lbl"] }).filter((x) => String(x.properties.id) !== id) : [];
      return { names: f.map((x) => x.properties.id), px: m, why: GLBARS._me().why }; }, PIT);
    await cdpX.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    ok(nm.px && (nm.names.length === 0 || nm.why === "both taken"), "me checked in at Pitchers: my marker covers no other bar's name (unless left and above are both taken)", nm);
    // an icon in the way on the left (my position on La Parma; Lobbybaren is left of it) → above, never right / below
    S.checkins = []; await poll(page, 800); await meAt(BAR.parma, 16);
    const up = await page.evaluate((id) => { const m = GLBARS._me(), v = (GLBARS._view() || []).find((x) => x.id === id); return { cov: m.cov && m.cov.id, dx: m.px && v ? Math.round(m.px.x - v.x) : null, dy: m.px && v ? Math.round(m.px.y - v.y) : null }; }, PARMA);
    ok(up.cov === PARMA && ((up.dx < -20 && Math.abs(up.dy) <= 1) || (Math.abs(up.dx) <= 1 && up.dy < -20)), "me on an icon: I stand left of it or above it, never right of it or below it", up);
    // friends: faces with a green ring in the row under the disc, then +N; no green ring on the disc or the count badge
    const fr = await page.evaluate(() => { const K = PNTOKENS.col;
      const ops = PNPINS.barOps({ k: "pub", p: { n: "9", f: true, ft: "2 · 1" }, hot: true }, "f", true, { lv: 2, faces: [{}, {}], more: 0 }).ops;
      const ops2 = PNPINS.barOps({ k: "pub", p: { n: "9" }, hot: true }, "f", true, { lv: 2, faces: [{}, {}, {}], more: 2 }).ops, f2 = ops2.filter((o) => o.o === "c" && o.fill === K.green && o.r === 11);
      const bb = PNPINS.bboxOf(ops);
      const lit = PNPINS.barOps({ k: "pub", lit: true }, "f", true, {}).ops, badge = PNPINS.barOps({ k: "pub", p: { n: "9", f: true } }, "f", true, { lv: 0 }).ops;
      const faces = ops.filter((o) => o.o === "c" && o.fill === K.green && o.r === 10);
      return { faces: faces.length, under: faces.every((o) => o.y > 16), plus: ops2.some((o) => o.o === "t" && o.t === "+2") && f2.length === 3 && f2.every((o) => o.y > 16), w: Math.round(bb[2] - bb[0]),
        person: ops.some((o) => o.o === "c" && o.fill === K.green && o.r === 8),
        litGreen: lit.filter((o) => o.fill === K.green && o.o === "c" && o.x === 0 && o.y === 0).length, badgeGreen: badge.filter((o) => o.o === "rr" && o.fill === K.green).length }; });
    ok(fr.faces === 2 && fr.under && fr.plus, "friends: their faces (green ring) in the row under the disc: inside the totals chip, or 3 faces + \"+2\"", fr);
    ok(fr.w < 85, "friends: the marker with 2 faces + the totals chip stays < 85 px wide (mbx: no long pill)", fr);
    ok(fr.litGreen === 0 && fr.badgeGreen === 0, "no green outline: a checked-in bar has no green disc ring, the count badge no green edge", fr);
    const nf = await page.evaluate(() => { const v = GLBARS._view() || []; return v.length; });
    ok(nf > 0 && errs.length === 0, "me: no page error", errs);
    await ctx.close();
  }
  /* ---------- foam (art only) + heat + town view ---------- */
  if (ONLY.test("foam") || ONLY.test("heat") || ONLY.test("town")) {
    const { ctx, page, errs } = await open(b, "gl");
    const fo = await page.evaluate(() => { const K = PNTOKENS.col, bad = [];
      const states = { quiet: { k: "pub" }, lit: { k: "pub", lit: true }, few: { k: "pub", p: { n: "2", q: true } }, busy: { k: "pub", p: { n: "9" }, hot: true } };
      for (const st in states) for (const m of ["d", "f", "x"]) for (const lv of [0, 1, 2, 3]) {
        const ops = PNPINS.barOps(states[st], m, true, { lv }).ops;
        if (ops.some((o) => o.o === "c" && o.fill === K.foam && o.y < -8 && o.r < 10)) bad.push(st + "/" + m + "/" + lv); }
      [3, 9, 29].forEach((n) => { if (PNPINS.crowdOps && PNPINS.crowdOps(n, PNCROWD.step(n)).ops.some((o) => o.o === "c" && o.fill === K.foam && o.y < -8 && o.r < 10)) bad.push("town/" + n); });
      return bad; });
    ok(fo.length === 0, "foam: no foam bumps on any bar icon (4 states x dot / full / town x 4 steps, town lantern)", fo);
    const ht = await page.evaluate(() => { const g = __gm(); return { col: JSON.stringify(g.getPaintProperty("olnu-heat", "heatmap-color")), op: g.getPaintProperty("olnu-heat", "heatmap-opacity") }; });
    ok(!/255,\s*72,\s*60|255,\s*122,\s*26/.test(ht.col), "heat: one amber hue (no red, no orange-red)", ht.col.slice(0, 200));
    const opAt = (z) => { const e = ht.op, st = e.slice(3); let v = st[1]; for (let i = 0; i < st.length; i += 2) { if (z >= st[i]) v = st[i + 1]; if (i + 2 < st.length && z >= st[i] && z < st[i + 2]) { v = st[i + 1] + (st[i + 3] - st[i + 1]) * (z - st[i]) / (st[i + 2] - st[i]); break; } } return v; };
    ok(Array.isArray(ht.op) && opAt(13.6) === 1 && opAt(14.6) === 0 && opAt(16) === 0, "heat: full until GL zoom 13.6, hidden from GL zoom 14.6 (Leaflet 15.6)", ht.op);
    await view(page, LUD, 13, 2500);
    await page.waitForFunction(() => Object.keys(GLBARS._crowds ? GLBARS._crowds() : {}).length > 0, null, { timeout: 8000 }).catch(() => {});
    const tw = await page.evaluate(([a, b, c, d]) => { const cs = Object.values(GLBARS._crowds ? GLBARS._crowds() : {}), v = GLBARS._view() || [];
      return { cs: cs.map((x) => ({ ids: x.ids.slice().sort(), n: x.n, lv: x.lv })), own: v.filter((x) => [a, b, c].includes(x.id) && x.shown).map((x) => x.id), grek: v.some((x) => x.id === d),
        drawn: __gm().getLayer("olnu-bar-crowd") ? (GLBARS._feats() || []).filter((f) => f.t === 3).length : -1, mp: GLBARS.shown ? GLBARS.shown(a) : null }; }, [PARMA, PIT, LOBBY, GREK]);
    const one = tw.cs.find((x) => x.ids.includes(PARMA));
    ok(tw.cs.length === 1 && one && one.ids.length === 3 && one.n === 29 && one.lv === 3, "town view (z13): La Parma + Pitchers + Lobbybaren = ONE lantern, 16 + 9 + 4 = 29 people, step 3", tw);
    ok(tw.drawn >= 1 && tw.own.length === 0 && tw.mp === true, "town view: the lantern is in the GL bar data (layer olnu-bar-crowd); its bars have no pin of their own (and count as drawn for mypins)", tw);
    ok(tw.grek, "town view: a bar that stands alone keeps its own pin (Grekiska)", tw);
    await page.screenshot({ path: require("./env.js").OUT + "maplight-town-z13.png" }).catch(() => {});
    await view(page, LUD, 14.6, 2000);
    ok(await page.evaluate(() => Object.keys(GLBARS._crowds ? GLBARS._crowds() : {}).length === 0), "street zoom (z14.6): no merged lantern");
    ok(errs.length === 0, "foam/heat/town: no page error", errs);
    await ctx.close();
  }
  /* ---------- kill switch ---------- */
  if (ONLY.test("kill")) {
    const { ctx, page, errs, S } = await open(b, "gl", { query: "?barlight=0" });
    await view(page, LUD, 16, 2500);
    const k = await page.evaluate(() => { const g = __gm(); return { on: !!(window.BARLIGHT && BARLIGHT.on()), ids: g.getStyle().layers.map((l) => l.id).filter((id) => /^pn-light/.test(id)),
      col: JSON.stringify(g.getPaintProperty("olnu-heat", "heatmap-color")), di: (GLBARS._feats() || []).map((f) => f.di || "").filter((d) => /-l\d-/.test(d)) }; });
    ok(!k.on && k.ids.length === 0 && k.di.length === 0, "kill switch ?barlight=0: no light, no light layer, no lantern image", k);
    S.checkins = [CI(BAR.pitch, PIT, "Pitchers")]; await poll(page, 500);
    ok(await page.evaluate(() => document.querySelectorAll(".bl-ring").length === 0), "kill switch: no ring");
    ok(/255,72,60/.test(k.col), "kill switch: the old heat cloud is back (its colours)", k.col.slice(0, 120));
    await view(page, LUD, 13, 2000);
    ok(await page.evaluate(() => Object.keys(GLBARS._crowds ? GLBARS._crowds() : {}).length === 0), "kill switch: no merged lantern in the town view");
    ok(errs.length === 0, "kill: no page error", errs);
    await ctx.close();
  }
  /* ---------- cost at 4x CPU: with the light, and the same page with the kill switch ---------- */
  if (ONLY.test("perf")) {
    const measure = async (query) => {
      const { ctx, page, errs } = await open(b, "gl", { query });
      await view(page, LUD, 16, 2500); if (!query) await built(page);
      await page.waitForFunction(() => !window.BARLIGHT || !BARLIGHT._state().anim, null, { timeout: 8000 }).catch(() => {}); await wait(page, 500);
      const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const t = await page.evaluate(async () => {
        const B = window.BARLIGHT, out = {}, time = (fn, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return +((performance.now() - t0) / n).toFixed(2); };
        out.syncMs = time(() => GLBARS.sync(), 20);
        // flakefix (CI red: 80.19 vs 51.32 ms, best of 3 blocks of 8): one PN.render() at 4x swings 6-60 ms in BOTH modes (GC, a
        // shared runner), and BARLIGHT.set() itself costs ~0 ms. Now: a warm-up, then 20 pairs (on/off, the order flips every pair),
        // the MEDIAN of the pair differences. A feed that doubles the redraw still gives a median difference far over 8 ms.
        const keep = window.BARLIGHT, one = () => { const t0 = performance.now(); PN.render(); return performance.now() - t0; };
        const med = (a) => { const v = a.slice().sort((x, y) => x - y), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
        const runAs = (lit) => { window.BARLIGHT = lit ? keep : null; const ms = one(); window.BARLIGHT = keep; return ms; };
        for (let i = 0; i < 4; i++) { runAs(true); runAs(false); }   // warm-up: both icon sets made, the code is hot
        const onA = [], offA = [], dA = [];
        for (let i = 0; i < 20; i++) { let a, c; if (i % 2) { c = runAs(false); a = runAs(true); } else { a = runAs(true); c = runAs(false); } onA.push(a); offA.push(c); dA.push(a - c); }
        PN.render(); out.renderMs = +med(onA).toFixed(2); out.renderNoFeedMs = +med(offA).toFixed(2); out.feedMs = +med(dA).toFixed(2);   // the same page with and without the light feed
        out.layers = __gm().getStyle().layers.filter((l) => /^pn-light/.test(l.id)).length;
        if (B && B.on()) {
          const lines = window.__PN_ROADS ? window.__PN_ROADS().map((c) => ({ c, z: 16 })) : [];
          if (lines.length) out.piecesMs = time(() => B._pieces(lines, { lat: 60.15124, lng: 15.18797 }), 20);
          out.spreadStepMs = time(() => B._k(0.5), 20); B._k(null);
          const feed = B._state().lit.map((x) => ({ id: x.id, lat: 60.15, lng: 15.187, n: x.n, cis: [] }));
          out.setMs = time(() => B.set(feed), 20);
          out.roadMs = B.stats.roadMs; out.buildMs = B.stats.buildMs; out.pieces = B.stats.pieces;
        }
        const f0 = B ? B.stats.frames : 0;
        return new Promise((res) => setTimeout(() => { out.idleFrames = B ? B.stats.frames - f0 : 0; res(out); }, 3000));
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      ok(errs.length === 0, "perf" + (query ? " (kill switch)" : "") + ": no page error", errs);
      await ctx.close();
      return t;
    };
    const t = await measure(""), k = await measure("?barlight=0");
    console.log("PERF 4x CPU, light on  (stub GL, software rendering): " + JSON.stringify(t));
    console.log("PERF 4x CPU, light off (kill switch, same page)     : " + JSON.stringify(k));
    ok((t.piecesMs == null || t.piecesMs < 25) && t.syncMs < 40 && t.spreadStepMs < 12 && t.setMs < 5, "4x CPU: street pieces of one bar < 25 ms (" + t.piecesMs + "), one GL bar pass < 40 ms (" + t.syncMs + "), one spread step < 12 ms (" + t.spreadStepMs + "), the feed of one poll < 5 ms (" + t.setMs + ")", t);
    ok(t.idleFrames === 0, "4x CPU: idle = no light frame work", t);
    ok(t.layers === 4 && k.layers === 0, "layers: the light adds 4 GL layers (2 street lines + 2 halo circles); none with the kill switch", [t.layers, k.layers]);
    ok(t.feedMs < 8, "4x CPU: the light feed adds < 8 ms to the app redraw of one poll (median of 20 pairs: +" + t.feedMs + " ms; " + t.renderMs + " ms with, " + t.renderNoFeedMs + " ms without, same page)", t);
  }
}
async function runFB(b) {
  if (!ONLY.test("raster")) return;
  const { ctx, page, errs, S } = await open(b, "fb");
  await view(page, LUD, 16, 2500);
  const r = await page.evaluate(([a, b, c]) => { const cls = (id) => { const e = document.querySelector('.cm[data-bar="' + id + '"]'); return e ? e.className : ""; };
    const e3 = document.querySelector('.cm[data-bar="' + a + '"] .bar-ico'), mp = document.querySelector(".leaflet-mepane-pane"), bp = document.querySelector(".leaflet-bars-pane") || document.querySelector(".leaflet-marker-pane");
    return { a: cls(a), b: cls(b), c: cls(c), bg: e3 ? getComputedStyle(e3).backgroundImage : "", on: !!(window.BARLIGHT && BARLIGHT.on()), lit: window.BARLIGHT ? BARLIGHT._state().lit.length : 0,
      gl: !!(window.GLBARS && GLBARS.on()), mz: mp ? +getComputedStyle(mp).zIndex : null, bz: bp ? +getComputedStyle(bp).zIndex : null,
      faces: (document.querySelector('.cm[data-bar="' + a + '"] .cm-faces') || { children: [] }).children.length }; }, [PARMA, PIT, LOBBY]);
  ok(/cm-lv3/.test(r.a) && /cm-lv2/.test(r.b) && /cm-lv1/.test(r.c), "raster map: the DOM bar icons carry the lantern step (cm-lv3 / cm-lv2 / cm-lv1)", r);
  ok(/gradient/.test(r.bg), "raster map: the step 3 icon has the lantern body (barlight.css)", r.bg);
  ok(r.on && r.lit === 3 && !r.gl, "raster map: the light list is known, no GL (the street light is simply absent)", r);
  ok(r.mz != null && r.bz != null && r.mz > r.bz, "raster map: my dot is in a pane above the bar panes (never under a bar icon)", r);
  ok(r.faces >= 2, "raster map: 2 friends' faces beside the La Parma icon", r);
  const rg = await page.evaluate(() => BARLIGHT._ring({ id: "x", lat: 60.14997, lng: 15.18679 }) && document.querySelectorAll(".bl-ring").length === 1);
  ok(rg, "raster map: the check-in ring works without GL");
  ok(errs.length === 0, "raster: no page error", errs);
  await ctx.close();
}
(async () => {
  console.log("maplight " + (TOKEN ? "real token" : "stub GL") + (OLD ? " OLD CODE from " + OLD : ""));
  const b = await chromium.launch(launchOpts(["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]));
  try { await runGL(b); } catch (e) { ok(false, "exception " + e.message.split("\n")[0]); }
  try { await runFB(b); } catch (e) { ok(false, "exception " + e.message.split("\n")[0]); }
  await b.close();
  console.log("\nmaplight-pw: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
