// mapcrowd-pw.js — lane mapcrowd (24 Nov 2026). 390 × 844 @2x, mocked Supabase.
// usage: node mapcrowd-pw.js <port> [parts: crowd,dim,a12]   (default: all)
//  crowd (I-137, owner photo Pitchers 19 Nov: "8 things on one spot"): a busy bar shows people first + at most ONE extra mark.
//        The Pitchers case: me, 2 group mates, 4 strangers, my check-in, a quiz tonight (🎤), my invite there (📨), a price.
//        GL (stub Mapbox, or the real one with MAPBOX_TEST_TOKEN) and the raster map read the same marker HTML.
//        Checks: no price tag and no 🎤 badge on the busy bar, the count stays (A35), the friends' row stays, my invite is a
//        short chip (time, no title) right of the disc that does not cover the count; a quiet bar keeps its price; under 3
//        people no number (privacy); raster: the name is not on the friends' totals chip.
//  dim   (A4b): the saved view (X8 snapshot) dims the GL bar layers like the DOM pins (0.6); the next good poll undoes it.
//  a12   (A12): Folk här group label = only groups that I share (server field); a friend with none = "Vän"; a stranger never.
// Old code: crowd and dim checks FAIL (a12 is a check of the current rule: it passes on both).
const { H, TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8871, PARTS = (process.argv[3] || "crowd,dim,a12").split(",");
const BASE = "http://127.0.0.1:" + PORT + "/";
const SHOTS = process.env.MC_SHOTS || "";
let pass = 0, fail = 0;
const ok = (m, c, x) => { console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 700))); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#3a3f78" } }] };
const PIT = "n3472634175", PITLL = [60.14997, 15.18679], LOBBY = "x-lobbybaren-ludvika", LOBLL = [60.15098, 15.18663], GREK = [60.15205, 15.18059];
const GID = "11111111-2222-3333-4444-555555555555", GX = "99999999-2222-3333-4444-555555555555";
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString(), fut = (m) => new Date(Date.now() + m * 60e3).toISOString();
let nid = 7000;
const P = (ll, o = {}) => Object.assign({ id: nid++, lat: ll[0], lng: ll[1], beer_count: o.n || 1, precise: true, created_at: ago(30), is_mine: !!o.mine, friend_name: o.f || null,
  skal_count: 0, i_skaled: false, shot_count: 0 }, o.g ? { shared_groups: o.g } : {});
function scene() {
  nid = 7000;
  return [P(PITLL, { mine: 1, n: 3 }), P(PITLL, { f: "Ida", n: 2, g: [{ id: GID, name: "Ludvika Lager" }] }), P(PITLL, { f: "Oskar", n: 2, g: [{ id: GID, name: "Ludvika Lager" }] }),
    P(PITLL, { f: "Kalle", n: 1 }), P(PITLL, { g: [{ id: GX, name: "Hemlig grupp" }] }), P(PITLL, {}), P(PITLL, { n: 2 }), P(GREK, {}), P(GREK, {})];
}
const CIS = [{ bar_id: PIT, bar_name: "Pitchers", lat: PITLL[0], lng: PITLL[1], name: "Lisa", is_mine: false, is_friend: true, created_at: ago(20) }];
const INV = (o = {}) => [Object.assign({ id: 501, title: "Pubquiz Vilka är", starts_at: fut(48), lat: PITLL[0], lng: PITLL[1], bar_id: PIT, live: true, status: "open", my_answer: "yes", mine: true, creator_name: "Anton" }, o)];
const EVS = [{ id: 901, kind: "quiz", title: "Pubquiz", starts_at: fut(48), ends_at: fut(170), bar_id: PIT, lat: PITLL[0], lng: PITLL[1], place: "Pitchers" }];

async function open(b, mode, o = {}) {
  const { ctx, page } = await H.ctxFor(b, { width: 390, height: 844 }, {});
  await ctx.addInitScript(() => { try { localStorage.setItem("olnu.prices", "1"); localStorage.setItem("olnu.map.ute", "0"); } catch (e) {} });
  const S = { beers: scene(), inv: o.noInv ? [] : INV() };
  await page.route(/rest\/v1\/rpc\/live_beers/, (r) => J(r, S.beers));
  await page.route(/rest\/v1\/rpc\/live_others/, (r) => J(r, []));
  await page.route(/rest\/v1\/rpc\/live_checkins/, (r) => J(r, CIS));
  await page.route(/rest\/v1\/rpc\/heat_points/, (r) => J(r, S.beers.map((x) => ({ lat: x.lat, lng: x.lng, w: 1 }))));
  await page.route(/rest\/v1\/rpc\/bar_prices_in/, (r) => J(r, [{ bar_id: PIT, kr: 82 }, { bar_id: LOBBY, kr: 75 }]));
  await page.route(/rest\/v1\/rpc\/my_invites/, (r) => J(r, { v: 1, invites: S.inv }));
  await page.route(/rest\/v1\/rpc\/events_near2?\b/, (r) => J(r, { v: 1, server_time: new Date().toISOString(), events: EVS }));
  let url = BASE;
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
    url = "https://tunela.github.io/Beer-map/";
  } else await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: "" }));
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message.slice(0, 200)); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (mode === "gl") await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  else await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill, .cm").length > 2, null, { timeout: 30000 }).catch(() => console.log("no pins"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await wait(page, 3000);
  await page.evaluate(([ll, z]) => { __map.closePopup(); __map.setView(ll, z, { animate: false }); }, [[PITLL[0] - 0.0002, PITLL[1]], o.z || 17]);
  await page.waitForFunction(() => document.querySelector(".inv-pin") || true, null, { timeout: 8000 }).catch(() => {});
  await wait(page, 3000);
  return { ctx, page, errs, S };
}
// the marker HTML of a bar (the model both paths draw from) + the GL state glmap parsed from it
const barState = (page, id) => page.evaluate((id) => {
  let html = "", cls = "";
  __map.eachLayer((l) => { const c = l.options && l.options.olnuC, io = l.options && l.options.icon && l.options.icon.options; if (c && c.bar && String(c.bar.id) === id && io) { html = io.html || ""; cls = io.className || ""; } });
  const v = window.GLBARS && GLBARS._view ? (GLBARS._view() || []).find((x) => String(x.id) === id) : null;
  return { html, cls, price: /bi-tag/.test(html), ev: /bi-ev/.test(html), king: /cm-king/.test(html), flag: /cm-flag/.test(html), ci: /cm-ci/.test(html), rl: /cm-rally/.test(html),
    count: (/<span class="pn">(\d+)</.exec(html) || [])[1] || "", pft: /class="pft"/.test(html), v };
}, id);
const invChip = (page) => page.evaluate(() => {
  const e = document.querySelector(".inv-pin"); if (!e) return null;
  const r = e.getBoundingClientRect(), bp = __map.latLngToContainerPoint([60.14997, 15.18679]), mr = document.getElementById("map").getBoundingClientRect();
  return { txt: e.textContent.replace(/\s+/g, " ").trim(), at: e.classList.contains("inv-at"), x: r.left - mr.left - bp.x, y: r.top - mr.top - bp.y, w: r.width, h: r.height, right: r.right };
});
const shot = async (page, n) => { if (SHOTS) { await page.screenshot({ path: SHOTS.replace(/\/?$/, "/") + n + ".png" }); console.log("shot", n); } };

async function partCrowd(b) {
  for (const mode of ["gl", "fb"]) {
    const { ctx, page, errs, S } = await open(b, mode);
    const P0 = await barState(page, PIT), L0 = await barState(page, LOBBY), ch = await invChip(page);
    ok(mode + " I-137 setup: Pitchers has 7 people, a friends' row and my invite; GL on = " + (mode === "gl"), P0.count === "7" && P0.pft && !!ch, { count: P0.count, pft: P0.pft, ch });
    ok(mode + " I-137 a busy bar with my friends' row: no price tag (one row under the disc)", !P0.price, P0.html.slice(0, 400));
    ok(mode + " I-137 my invite at the bar takes the one extra slot: no 🎤 / 👑 / 🏰 / 🚪 / 🪖 mark beside it", !P0.ev && !P0.king && !P0.flag && !P0.ci && !P0.rl, P0);
    ok(mode + " I-137 the count stays (A35: as today) and the friends' totals stay", P0.count === "7" && P0.pft, P0.count);
    ok(mode + " I-137 the invite chip at a bar is short: envelope + time, no title", ch && ch.at && /^\S*\s*\d{1,2}:\d{2}$/.test(ch.txt) && !/Pubquiz/.test(ch.txt), ch);
    ok(mode + " I-137 the chip sits right of the disc, under the count (x >= 19 px, top >= -2 px), inside the screen (not under the side buttons)", ch && ch.x >= 19 && ch.y >= -2 && ch.right < 330, ch);
    ok(mode + " I-137 a quiet bar (nobody there) keeps its price tag", L0.price, L0.html.slice(0, 300));
    const G = await page.evaluate(() => { const o = {}; __map.eachLayer((l) => { const c = l.options && l.options.olnuC; if (c && c.bar && /grekiska/.test(String(c.bar.id))) o.html = l.options.icon.options.html; }); return o; });
    // (the count stays in the HTML; class pq = both renderers show no number: mapart countBadge is skipped, raster CSS)
    ok(mode + " privacy: a bar with 2 strangers is marked 'under 3' (pq = no number on the map)", G.html && /class="pill[^"]*\bpq\b/.test(G.html), (G.html || "").slice(0, 300));
    if (mode === "gl") {
      const v = await page.evaluate((id) => (GLBARS._view() || []).find((x) => String(x.id) === id), PIT);
      ok("gl I-137 the GL pin of Pitchers is full with its name", v && v.full && v.lbl, v);
    } else {
      const R = await page.evaluate(() => { const m = [...document.querySelectorAll(".cm")].find((x) => /Pitchers/.test(x.textContent)); const r = (s) => { const e = m && m.querySelector(s); return e ? e.getBoundingClientRect() : null; }; return { l: r(".cm-lbl"), f: r(".pft") }; });
      ok("fb I-137 raster: the name is under the friends' totals chip, not on it", R.l && R.f && R.l.top >= R.f.bottom - 1, R);
    }
    await shot(page, "after-" + mode + "-pitchers-z17");
    // no invite: the 🎤 tonight badge is the one extra (rank: call-out > check-ins > tonight > king > takeover)
    S.inv = [];
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => { try { INVITE._poll(true); } catch (e) {} }); await wait(page, 1500);
      if (!(await page.evaluate(() => !!(INVITE.atBar && INVITE.atBar("n3472634175"))))) break;
    }
    await wait(page, 1000);
    const P1 = await barState(page, PIT);
    const inv1 = await page.evaluate(() => [!!(INVITE.atBar && INVITE.atBar("n3472634175")), document.querySelectorAll(".inv-pin").length]);
    ok(mode + " I-137 no invite: the one extra mark is the 🎤 tonight badge; still no price (friends' row)", P1.ev && !P1.price && !P1.king && !P1.flag, { ev: P1.ev, price: P1.price, king: P1.king, flag: P1.flag, ci: P1.ci, inv1 });
    ok(mode + " no page error", errs.length === 0, errs);
    await ctx.close();
  }
}
async function partDim(b) {
  const { ctx, page, errs } = await open(b, "gl");
  const op = () => page.evaluate(() => { const m = BASEMAP.mapbox().getMapboxMap(), o = {}; GLBARS._layers().forEach((id) => { const l = m.getLayer(id); if (l && l.type === "symbol") { const v = m.getPaintProperty(id, "icon-opacity"); o[id] = typeof v === "number" ? v : 1; } }); return o; });
  const a = await op();
  await page.evaluate(() => X8.snapShow(Date.now() - 10 * 60e3)); await wait(page, 500);
  const d = await op(), body = await page.evaluate(() => document.body.classList.contains("x8-snap"));
  ok("A4b setup: GL on and the saved-view class is set", body && "olnu-bar-full" in a, { body, a });
  ok("A4b saved view: the GL bar pills dim like the DOM pins (full / names / dots 0.6, quiet dots 0.82 x 0.6)", d["olnu-bar-full"] === 0.6 && d["olnu-bar-dot"] === 0.6 && Math.abs((d["olnu-bar-dote"] || 0) - 0.49) < 0.011 && d["olnu-bar-lbl"] === 0.6, d);
  ok("A4b the restaurants, heat and clouds do not dim", d["olnu-place"] === a["olnu-place"], { a: a["olnu-place"], d: d["olnu-place"] });
  await page.evaluate(() => { __map.setView([60.1505, 15.1872], 16, { animate: false }); }); await wait(page, 1800);
  const d2 = await op();
  ok("A4b the dim stays after a redraw (pan / zoom)", d2["olnu-bar-full"] === 0.6, d2);
  await page.evaluate(() => X8.pollOk(null)); await wait(page, 500);
  const u = await op();
  ok("A4b the next good poll: the GL layers are back to their own opacity", Object.keys(a).every((k) => u[k] === a[k]), { a, u });
  ok("A4b no page error", errs.length === 0, errs);
  await ctx.close();
}
async function partA12(b) {
  const { ctx, page, errs } = await open(b, "fb", { noInv: true });
  await page.evaluate((id) => PN.openBarById(id, 0), PIT); await wait(page, 1800);
  await page.evaluate(() => { const d = document.querySelector('details[data-fold="here"]'); if (d) d.open = true; }); await wait(page, 600);
  const w = await page.evaluate(() => ({ fr: [...document.querySelectorAll(".pn-fh-fr")].map((t) => ({ n: (t.querySelector(".pn-fh-n") || {}).textContent, g: ((t.querySelector(".pn-fh-g") || {}).textContent || "").trim() })),
    st: [...document.querySelectorAll(".pn-fh-s")].map((s) => ({ txt: s.textContent.trim(), g: !!s.querySelector(".pn-fh-g") })), all: (document.querySelector(".pn-fh") || {}).textContent || "" }));
  const by = {}; w.fr.forEach((x) => { by[x.n] = x.g; });
  ok("A12 a group mate's label = the group we share", by.Ida === "Ludvika Lager" && by.Oskar === "Ludvika Lager", w.fr);
  ok("A12 a friend with no shared group: 'Vän', no group name", by.Kalle === "Vän", w.fr);
  ok("A12 a stranger never gets a group label, even when the row carries a group field", w.st.length >= 3 && w.st.every((s) => !s.g && !s.txt) && !/Hemlig grupp/.test(w.all), w.st);
  ok("A12 no page error", errs.length === 0, errs);
  await shot(page, "a12-folk-har");
  await ctx.close();
}
(async () => {
  const b = await chromium.launch(launchOpts());
  const run = async (n, fn) => { if (!PARTS.includes(n)) return; try { await fn(b); } catch (e) { ok(n + " ran", false, String(e && e.stack).slice(0, 400)); } };
  await run("crowd", partCrowd); await run("dim", partDim); await run("a12", partA12);
  await b.close();
  console.log("\nmapcrowd-pw: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
