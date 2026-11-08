// mbx copy of glfix-avpins-pw.js (people pins = .pn-p face + count badge, clusters = .pn-cl). glfix: 👤 friend / group-mate characters in their map pins (js/avpins.js). Mocked data. node glfix-avpins-pw.js <port> [tag]
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], TAG = process.argv[3] || "t";
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let id = 9100;
const P = (ll, n, o = {}) => ({ id: id++, lat: ll[0], lng: ll[1], beer_count: n, precise: true, created_at: iso(20), is_mine: !!o.mine, friend_name: o.f || null, skal_count: 0, i_skaled: false, shot_count: 0, bar_id: null });
// people NOT at a bar point (so they are people pins, not bar pills): a park, a street, a flat
// ≥ 160 m from every bar (else the app folds them into that bar's pill)
const beers = [P([60.1460, 15.1910], 3, { f: "Oskar" }), P([60.1476, 15.1910], 6, { f: "Ida" }), P([60.1492, 15.1912], 2, { f: "Robban" }), P([60.1508, 15.1915], 4, { mine: 1 }), P([60.1524, 15.1920], 1)];   // ≥ 160 m apart (cluster radius 130 px at z16)
const GID = "11111111-2222-3333-4444-555555555555";
const spec = (o) => Object.assign({ v: 1, sk: 2, fs: 0, ey: 1, br: 1, mt: 2, hr: 3, hc: 2, fh: 0, hw: 0, gl: 0, up: 1, uc: 2, bg: 3, ms: 0, md: [] }, o);
const people = [
  { k: "k1", name: "Oskar", is_me: false, seed: "a1b2c3d4", a: spec({ hr: 5, hc: 1, fh: 2, hw: 3, bg: 5 }), r: 5, md: [] },
  { k: "k2", name: "Ida", is_me: false, seed: "b2c3d4e5", a: spec({ sk: 4, hr: 8, hc: 6, gl: 1, bg: 8 }), r: 3, md: [] },
  { k: "me", name: "Anton", is_me: true, seed: "c3d4e5f6", a: spec({ sk: 1, hr: 1, hw: 7, bg: 1 }), r: 8, md: [] } ];   // Robban: no spec loaded → today's pin
(async () => {
  const b = await chromium.launch(launchOpts());
  const nc = b.newContext.bind(b); b.newContext = (o) => nc({ ...o, serviceWorkers: "block" });
  const { ctx, page } = await H.ctxFor(b, { width: 412, height: 915 }, {});
  await ctx.addInitScript(() => { try { localStorage.setItem("olnu.mapStyle", "mb-dusk"); } catch (e) {} });
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN }));
  await page.route(/rest\/v1\/rpc\/live_beers/, (r) => J(r, beers));
  await page.route(/rest\/v1\/rpc\/my_groups/, (r) => J(r, [{ id: GID, name: "Gänget", members: 3 }]));
  let calls = { g: 0, f: 0 };
  await page.route(/rest\/v1\/rpc\/avatars_for/, (r) => { const d = JSON.parse(r.request().postData() || "{}"); if (d.p_group_id) { calls.g++; J(r, { v: 1, people: people.filter((p) => p.name !== "Anton") }); } else { calls.f++; J(r, { v: 1, people }); } });
  await page.route(/rest\/v1\/rpc\/my_avatar/, (r) => J(r, { v: 1, spec: people[2].a, seed: "c3d4e5f6", facts: { r: 8, m: [] } }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("https://tunela.github.io/Beer-map/");
  await page.waitForFunction(() => window.__map && window.AVPINS && document.querySelectorAll(".pn-p, .pn-cl, .pill").length >= 3, null, { timeout: 60000 }).catch(() => console.log("no pills"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll(".pn-p .bm-av, .pn-cl > .bm-av").length >= 2, null, { timeout: 90000 }).catch(() => console.log("no avatars yet"));
  for (const z of [13, 16]) {
    await page.evaluate((z) => __map.setView([60.1492, 15.1912], z, { animate: false }), z);
    await page.waitForFunction(() => !BASEMAP.isMapbox() || (BASEMAP.loaded() && BASEMAP.mapbox().getMapboxMap().areTilesLoaded()), null, { timeout: 40000 }).catch(() => {});
    await wait(page, 2500);
    const r = await page.evaluate(() => [...document.querySelectorAll(".leaflet-marker-pane .pn-p")].map((p) => ({ t: p.textContent.trim().slice(0, 18), av: !!p.querySelector(".bm-av"), w: p.querySelector(".bm-av") ? Math.round(p.querySelector(".bm-av").getBoundingClientRect().width) : 0, ok: p.querySelector(".bm-av") ? p.querySelector(".bm-av").complete && p.querySelector(".bm-av").naturalWidth > 0 : null })));
    console.log("z" + z, JSON.stringify(r));
    const by = (s) => r.find((x) => x.t.indexOf(s) >= 0) || {};
    if (z >= 16) {
      ok(by("Oskar").av && by("Ida").av && by("Oskar").ok && by("Ida").ok, "z" + z + ": Oskar + Ida pins show their character (img decoded, " + by("Oskar").w + " px)");
      ok(!by("Robban").av && by("Robban").t, "z" + z + ": Robban (no spec) keeps today's pin");
    } else {
      const cl = await page.evaluate(() => [...document.querySelectorAll(".leaflet-marker-pane .pn-cl")].map((p) => ({ n: p.textContent.trim(), faces: p.querySelectorAll(".bm-av").length })));
      console.log("clusters", JSON.stringify(cl));
      ok(cl.some((c) => c.faces >= 1 && c.faces <= 2) || r.some((x) => x.av), "z" + z + ": the cluster chip shows up to 2 characters " + JSON.stringify(cl));
    }
    await page.screenshot({ path: SP + "glfix-avpins-" + TAG + "-z" + z + ".png", timeout: 120000 }).catch((e) => console.log("shot failed", e.message.slice(0, 60)));
  }
  const st = await page.evaluate(() => ({ urls: AVPINS._urls(), imgs: document.querySelectorAll(".bm-av").length, inl: [...document.querySelectorAll(".leaflet-marker-pane .pn-p svg, .leaflet-marker-pane .pn-cl svg")].filter((s) => s.querySelectorAll("*").length > 2).length }));
  console.log("cache", JSON.stringify(st), "rpc", JSON.stringify(calls));
  ok(st.urls <= 4 && st.inl === 0, "one cached image per character (" + st.urls + " urls for " + st.imgs + " pins), no inline SVG in pins");
  ok(calls.g <= 2 && calls.f <= 4, "few RPCs: avatars_for(group) " + calls.g + ", avatars_for(friends) " + calls.f);
  ok(errs.length === 0, "no page errors " + JSON.stringify(errs.slice(0, 3)));
  await closeCounted(ctx, page, "glfix-avpins-" + TAG);
  await b.close();
  console.log("DONE pass=" + pass + " fail=" + fail);
})().catch((e) => { console.log("FAIL crash", e && e.stack); process.exit(1); });
