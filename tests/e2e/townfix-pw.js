// townfix-pw.js — lane townfix (owner item A19, 16 Nov 2026): at town zoom a people cluster (friends away from the bars) sat ON a
// town lantern and hid its number, and a re-drawn cluster showed for a few frames over a friends chip (CI flake of the map-pw "tz" test).
//  1  lantern: a people cluster never overlaps a town lantern (disc + friends' faces row) or my own marker; it is still on the map, moved aside
//  2  chip: a cluster that is re-added (a poll redraw) is hidden BEFORE the next paint where it sits under a friends chip (no flash frame)
// Stub GL like maplight-pw.js (real Mapbox when MAPBOX_TEST_TOKEN is set).  usage: node townfix-pw.js <port> [sections: lantern|chip]
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
  const S = { beers: crowd(o.crowd).concat(o.extra || []), checkins: o.checkins || [] };
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



const hits = (a, b, m) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
(async () => {
  console.log("townfix " + (TOKEN ? "real token" : "stub GL"));
  const b = await chromium.launch(launchOpts(["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]));
  // 3 friends about 130 m from La Parma, away from every bar: one people cluster (green, "3") at town zoom
  const off = 0.0012, extra = [P([BAR.parma[0] + off, BAR.parma[1] + off], { f: "Maja" }), P([BAR.parma[0] + off, BAR.parma[1] + off * 1.2], { f: "Nils" }), P([BAR.parma[0] + off * 1.1, BAR.parma[1] + off], { f: "Ebba" })];
  const { ctx, page, errs } = await open(b, "gl", { extra });
  if (ONLY.test("lantern")) for (const z of [11.6, 12, 12.5, 13]) {
    await view(page, LUD, z, 2500);
    await page.waitForFunction(() => Object.keys(GLBARS._crowds()).length > 0 && document.querySelector(".leaflet-marker-icon > .pn-cl"), null, { timeout: 8000 }).catch(() => {});
    await wait(page, 1700);   // mypins re-checks at least every 1.5 s
    // (only API that the old code has too: the lantern disc from _crowds, my marker from _me; the disc is drawn at >= 0.75 of its size)
    const d = await page.evaluate(() => { const c = __map.getContainer().getBoundingClientRect(), ko = [];
      Object.values(GLBARS._crowds()).forEach((q) => { const p = __map.latLngToContainerPoint(q.ll), r = q.r * 0.75; ko.push({ what: "lantern", box: [p.x + c.left - r, p.y + c.top - r, p.x + c.left + r, p.y + c.top + r] }); });
      const m = GLBARS._me(); if (m && m.px) ko.push({ what: "me", box: [m.px.x + c.left - m.r, m.px.y + c.top - m.r, m.px.x + c.left + m.r, m.px.y + c.top + m.r] });
      const cl = [...document.querySelectorAll(".leaflet-marker-icon > .pn-cl, .leaflet-marker-icon > .pn-p")].filter((p) => p.getBoundingClientRect().width && getComputedStyle(p.parentNode).visibility !== "hidden")
        .map((p) => { const q = p.getBoundingClientRect(); return { txt: p.textContent.trim(), r: [q.left, q.top, q.right, q.bottom].map(Math.round) }; });
      return { ko, cl, nCl: document.querySelectorAll(".leaflet-marker-icon > .pn-cl").length }; });
    const over = [];
    d.cl.forEach((c) => d.ko.forEach((k) => { if (hits(c.r, k.box, 0)) over.push(c.txt + " over " + k.what + " " + JSON.stringify({ c: c.r, k: k.box.map(Math.round) })); }));
    ok(d.ko.some((k) => k.what === "lantern") && d.nCl > 0, "z" + z + ": the lantern and the people cluster are both there (so the check means something)", d);
    ok(d.cl.length > 0 && over.length === 0, "z" + z + ": the visible people cluster covers no town lantern and not my marker, and is not hidden", over.concat(JSON.stringify(d.cl)));
  }
  if (ONLY.test("chip")) {
    await view(page, LUD, 10.8, 2500);
    await page.waitForFunction(() => !!document.querySelector(".leaflet-mypins-pane .mp-pin"), null, { timeout: 8000 }).catch(() => {});
    await wait(page, 1700);
    // a poll redraw: the cluster markers are removed and added again. After that, in the first animation frame (before the paint) no
    // visible cluster / pin may overlap a friends chip.
    const r = await page.evaluate(() => new Promise((res) => {
      const chips = () => [...document.querySelectorAll(".leaflet-mypins-pane .mp-pin")].map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0);
      const bad = () => { const cs = chips(), out = []; document.querySelectorAll(".leaflet-marker-icon > .pn-cl, .leaflet-marker-icon > .pn-p").forEach((p) => { const q = p.getBoundingClientRect();
        if (!q.width || getComputedStyle(p.parentNode).visibility === "hidden") return; if (cs.some((c) => q.left < c.right && q.right > c.left && q.top < c.bottom + 8 && q.bottom > c.top - 8)) out.push(p.textContent.trim()); }); return out; };
      const ms = PN.clusters.getLayers(), n0 = chips().length; PN.clusters.clearLayers(); PN.clusters.addLayers(ms);
      const seen = []; let i = 0; const tick = () => { seen.push(bad().length); if (++i < 4) requestAnimationFrame(tick); else res({ chips: n0, ms: ms.length, seen, now: bad() }); }; requestAnimationFrame(tick); }));
    ok(r.chips > 0 && r.ms > 0 && r.seen.every((x) => x === 0), "chip: a re-added cluster under a friends chip is hidden before the first paint (4 frames, 0 visible)", r);
  }
  ok(errs.length === 0, "townfix: no page error", errs);
  await ctx.close(); await b.close();
  console.log("\ntownfix-pw: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
