// fixM (test teams 11 Nov): T-10 fallback map taps + clusters, T-14 ticker, T-15 header pill, T-24 crowd label.
// Mocked Supabase (ds-helpers), raster / Leaflet fallback map (no Mapbox load, no token on this port).
// usage: node fixm-pw.js <port> [only-part ...]   parts: tap cluster ticker pill crowd
// FIXM_OLD=<docs dir>: serve the static files from that dir instead (run the checks on the old code).
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const SP = require("./env.js").OUT;
fs.mkdirSync(SP + "fixm-shots", { recursive: true });
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.slice(3);
const OLD = process.env.FIXM_OLD || "";
const want = (k) => !ONLY.length || ONLY.includes(k) || (k !== "shots" && ONLY.length === 1 && ONLY[0] === "all");
const { wait } = H;
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();

// ---------- a dense mock bar cluster on Södermalm (5 x 3 grid, 30-40 m apart, like Götgatan / Skånegatan) ----------
const SODER = [59.3155, 18.0745];
const DENSE = [];
(() => {
  const mLat = 1 / 111320, mLng = 1 / (111320 * Math.cos(SODER[0] * Math.PI / 180));
  const jit = [[0, 0], [6, -4], [-5, 7], [3, 9], [-8, -3], [7, 2], [-2, -9], [9, 5], [-6, 4], [4, -7], [-9, 8], [2, -2], [8, -8], [-4, 3], [5, 6]];
  let k = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    const j = jit[k], dy = (r - 1) * 34 + j[0], dx = (c - 2) * 36 + j[1];
    DENSE.push({ id: "fixm-d" + k, name: "Testbar " + String.fromCharCode(65 + k) + (k % 3 === 0 ? " & Kök med lång namnskylt" : ""), lat: +(SODER[0] + dy * mLat).toFixed(6), lng: +(SODER[1] + dx * mLng).toFixed(6), type: k % 4 === 0 ? "bar" : "pub" });
    k++;
  }
})();

async function serveOld(page) {
  if (!OLD) return;
  await page.route((u) => u.href.startsWith(BASE) && !/\/config\.js(\?|$)/.test(u.pathname) && !/\/rest\/|\/auth\/|\/functions\//.test(u.pathname), (r) => {
    const u = new URL(r.request().url()); let p = decodeURIComponent(u.pathname); if (p.endsWith("/")) p += "index.html";
    const f = path.join(OLD, p);
    if (!f.startsWith(path.resolve(OLD)) || !fs.existsSync(f)) return r.fallback();
    const ext = path.extname(f), ct = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" }[ext] || "application/octet-stream";
    return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(f) });
  });
}
async function denseBars(page) {
  await page.route(/\/bars\.json(\?|$)/, async (r) => {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(path.join(OLD || path.join(__dirname, "..", "..", "docs"), "bars.json"), "utf8")); } catch (e) {}
    return J(r, list.concat(DENSE));
  });
  await page.route(/overpass/, (r) => r.abort());
}
async function setup(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: o.w || 390, height: o.h || 844 }, o);
  await serveOld(page);
  await denseBars(page);
  if (o.routes) await o.routes(page);
  if (o.init) await ctx.addInitScript(o.init);
  await H.boot(page);
  await page.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); window.__opened = [];
    window.__map.on("popupopen", (e) => { const s = e.popup && e.popup._source, c = s && s.options && s.options.olnuC; window.__opened.push(c && c.bar ? String(c.bar.id) : "?"); }); });
  return { ctx, page };
}
const view = (page, ll, z) => page.evaluate(([ll, z]) => { window.__map.closePopup(); window.__map.setView(ll, z, { animate: false }); }, [ll, z]);
// container point of each dense bar's marker (= its icon centre), only those on screen and clear of the HUD
const points = (page) => page.evaluate((ids) => {
  const m = window.__map, cr = m.getContainer().getBoundingClientRect(), out = [];
  ids.forEach((id) => {
    const ic = document.querySelector('.leaflet-marker-icon.cm[data-bar="' + id + '"]'); if (!ic) return;
    const bi = ic.querySelector(".bar-ico"), r = bi && bi.getBoundingClientRect(); if (!r || !r.width) return;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y); if (!top || !top.closest("#map")) return;   // under the HUD
    out.push({ id, x, y, cx: x - cr.left, cy: y - cr.top });
  });
  return out;
}, DENSE.map((b) => b.id));
async function tapEach(page, pts, dxy, ll, z) {
  const res = [];
  for (const p0 of pts) {
    // the bar sheet auto-pans the map: back to the same view, measure again, then tap
    await page.evaluate(([ll, z]) => { window.__opened = []; window.__map.closePopup(); window.__map.setView(ll, z, { animate: false }); }, [ll, z]);
    await wait(page, 500);
    let now = await points(page), p = now.find((q) => q.id === p0.id);
    // w1-tests: right after setView the icon can be missing for a moment (CI 360 px z15: 1-2 of 15 "not-on-screen", pts had them 2 s before).
    // Wait up to 5 s for THIS icon; it is still a FAIL when it never comes back.
    for (let i = 0; !p && i < 20; i++) { await wait(page, 250); now = await points(page); p = now.find((q) => q.id === p0.id); }
    if (!p) { res.push({ id: p0.id, got: "not-on-screen" }); continue; }
    // dxy: that many px toward the nearest other dense icon (still on this bar's own disc)
    let x = p.x, y = p.y;
    if (dxy) { let best = null, bd = 1e9; now.forEach((q) => { if (q.id === p.id) return; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }); if (best) { const o = Math.min(dxy, bd / 3); x += (best.x - p.x) / bd * o; y += (best.y - p.y) / bd * o; } }   // never past a third of the gap (the finger stays nearer its own icon)
    await page.touchscreen.tap(x, y);
    await wait(page, 450);
    const got = await page.evaluate(() => window.__opened.slice());
    res.push({ id: p.id, got: got[got.length - 1] || null });
  }
  await page.evaluate(() => { window.__map.closePopup(); });
  return res;
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  console.log("mode", OLD ? "OLD " + OLD : "repo docs");

  // ---------- T-10: fallback map, dense bars: a tap on an icon opens THAT bar (z15 / z16) ----------
  if (want("tap")) {
    for (const w of [390, 360]) {
      const t = await setup(browser, { w, h: w === 360 ? 780 : 844, checkin: false });
      const p = t.page;
      const gl = await p.evaluate(() => !!(window.GLBARS && window.GLBARS.on && window.GLBARS.on()));
      ok(!gl, w + ": the test runs on the raster / Leaflet fallback (GLBARS off)");
      for (const z of [15, 16]) {
        await view(p, SODER, z); await wait(p, 1800);
        const pts = await points(p);
        if (w === 390) await p.screenshot({ path: SP + "fixm-shots/t10-dense-z" + z + "-" + w + ".png" });
        for (const off of [0, 4]) {
          const res = await tapEach(p, pts, off, SODER, z), bad = res.filter((r) => r.got !== r.id);
          ok(pts.length >= 10 && !bad.length, w + " z" + z + (off ? " (4 px, max 1/3 of the gap, toward the next bar)" : "") + ": " + (res.length - bad.length) + "/" + res.length + " taps on a bar icon open that bar" + (bad.length ? " wrong: " + JSON.stringify(bad.slice(0, 6)) : ""));
        }
      }
      // a tap on an EMPTY spot of the map far from icons does not open a bar
      await view(p, [SODER[0] + 0.004, SODER[1] - 0.012], 16); await wait(p, 1200);
      await p.evaluate(() => { window.__opened = []; window.__map.closePopup(); });
      const empty = await p.evaluate(() => { const m = window.__map, cr = m.getContainer().getBoundingClientRect(); for (let y = 300; y < 600; y += 23) for (let x = 40; x < cr.width - 80; x += 19) {
        const e = document.elementFromPoint(x, y); if (!e || !e.closest("#map") || e.closest(".leaflet-marker-icon")) continue;
        const far = [...document.querySelectorAll(".leaflet-marker-icon")].every((q) => { const r = q.getBoundingClientRect(); return !r.width || Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y) > 60; });
        if (far) return { x, y }; } return null; });
      if (empty) await p.touchscreen.tap(empty.x, empty.y); await wait(p, 500);
      ok(!!empty && (await p.evaluate(() => window.__opened.length)) === 0, w + ": a tap on empty map (60 px from any marker) opens no bar " + JSON.stringify(empty));
      await t.ctx.close();
    }
  }

  // ---------- T-10: fallback clusters below z15 (ds30 rule); tap = zoom in; from z15 every bar on its own ----------
  if (want("cluster")) {
    const t = await setup(browser, { checkin: false });
    const p = t.page;
    await view(p, SODER, 14); await wait(p, 1800);
    const c14 = await p.evaluate((ids) => {
      const cl = [...document.querySelectorAll(".leaflet-marker-icon.tz-cl")].filter((e) => e.getBoundingClientRect().width);
      const vis = ids.filter((id) => { const e = document.querySelector('.leaflet-marker-icon.cm[data-bar="' + id + '"]'); if (!e) return false; const cs = getComputedStyle(e); return cs.visibility !== "hidden" && +cs.opacity > 0.05; });
      return { n: cl.length, text: cl.map((e) => (e.getAttribute("data-cl") || "").split(",").length), visible: vis.length };
    }, DENSE.map((b) => b.id));
    await p.screenshot({ path: SP + "fixm-shots/t10-cluster-z14-390.png" });
    ok(c14.n >= 1 && c14.text.reduce((a, b) => a + b, 0) >= 10 && c14.visible <= 3, "z14 fallback: the dense bars merge into cluster capsules (" + JSON.stringify(c14) + ")");
    const cp = await p.evaluate(() => { const e = [...document.querySelectorAll(".leaflet-marker-icon.tz-cl")].sort((a, b) => b.getAttribute("data-cl").length - a.getAttribute("data-cl").length)[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const z0 = await p.evaluate(() => window.__map.getZoom());
    if (cp) await p.touchscreen.tap(cp.x, cp.y);
    await wait(p, 1500);
    const z1 = await p.evaluate(() => window.__map.getZoom());
    ok(cp && z1 > z0 && z1 <= 15.01, "tap on a cluster zooms in (" + z0 + " → " + z1 + "), max z15");
    await view(p, SODER, 15); await wait(p, 1500);
    const c15 = await p.evaluate(() => document.querySelectorAll(".leaflet-marker-icon.tz-cl").length);
    ok(c15 === 0, "z15 fallback: no clusters, every bar is its own dot (" + c15 + ")");
    await t.ctx.close();
  }


  // ---------- T-14: the LIVE ticker reads ONE snapshot (NEWS.build with set inputs, many rounds: the mix is random) ----------
  if (want("ticker")) {
    const t = await setup(browser, { checkin: false });
    const p = t.page;
    await p.waitForFunction(() => window.NEWS && window.NEWS_GT && window.CITIES, null, { timeout: 20000 }).catch(() => {});
    const R = await p.evaluate(({ SODER, dense }) => {
      const N = window.NEWS, LUD = { lat: 60.1505, lng: 15.1872 }, at = (hh, mm) => new Date("2026-11-13T" + hh + ":" + mm + ":00+01:00");
      const rounds = (n, beers, ctx) => { const out = []; for (let i = 0; i < n; i++) { try { localStorage.removeItem("olnu.tkNight"); } catch (e) {} out.push(...N.build(beers, Object.assign({ prev: [] }, ctx()))); } return out; };
      const pin = (id, ll, n, o) => Object.assign({ id, lat: ll[0], lng: ll[1], beer_count: n, other_count: 0, precise: true, is_mine: false, friend_name: null, skal_count: 0, created_at: new Date(Date.now() - 40 * 60e3).toISOString() }, o || {});
      const ci = (i) => ({ bar_id: "n3472634175", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679, name: null, is_mine: false, is_friend: false, created_at: new Date(Date.now() - (10 + i) * 60e3).toISOString() });
      const QUIET = /Ingen ute|Tomt på kartan|bara inte nåt här|tumbleweed|Radiotystnad|Lugnt läge|ingen har tryckt/i;
      // a) 9 checked in at Pitchers, no pins near: no "nobody out" line in the same build
      const a = rounds(60, [], () => ({ center: LUD, now: at("22", "10"), checkins: Array.from({ length: 9 }, (_, i) => ci(i)), liveTotal: 44 }));
      const aQuiet = a.filter((x) => QUIET.test(x.text) || /^(calm|emptyFirst|townQuiet)$/.test(x.k)).map((x) => x.text).slice(0, 4);
      // b) Söder: no Stureplan / Östermalm line for a bar or a centre on Söder; at Stureplan they may show
      const sb = dense.slice(0, 3), soderPins = [pin(9001, [sb[0].lat, sb[0].lng], 3), pin(9002, [sb[0].lat, sb[0].lng], 2), pin(9003, [sb[1].lat, sb[1].lng], 4), pin(9004, [sb[1].lat, sb[1].lng], 1)];
      const b = rounds(220, soderPins, () => ({ center: { lat: SODER[0], lng: SODER[1] }, now: at("22", "30"), checkins: [], liveTotal: 52 }));
      const bBad = b.filter((x) => /Stureplan|Östermalm/.test(x.text) && !/Söder|Medborgarplatsen|Slussen/.test(x.text)).map((x) => x.text).slice(0, 3);   // "Söder vs Östermalm" lines are fine on Söder
      const stu = rounds(220, [], () => ({ center: { lat: 59.3355, lng: 18.0738 }, now: at("22", "30"), checkins: [], liveTotal: 52 }));
      const stuOk = stu.filter((x) => /Stureplan|Östermalm/.test(x.text)).length;
      // c) 06:25: no night / evening line (people near, so the forecast and the town lines are candidates)
      const ludPins = [pin(9101, [60.15124, 15.18797], 3), pin(9102, [60.15124, 15.18797], 2), pin(9103, [60.1530, 15.1900], 1)];
      const c = rounds(120, ludPins, () => ({ center: LUD, now: at("06", "25"), checkins: [], liveTotal: 20 }));
      const cBad = c.filter((x) => /förfest|midnatt|i ?kväll|kvällen|kvällens|i ?natt(?![a-zåäö])/i.test(x.text)).map((x) => x.text).slice(0, 4);
      // d) the country line uses live_total (52), not the 3 pins in view
      const d = rounds(120, ludPins, () => ({ center: LUD, now: at("22", "40"), checkins: [], liveTotal: 52 })).filter((x) => x.k === "total");
      const dBad = d.filter((x) => !/(^|\D)52(\D|$)/.test(x.text)).map((x) => x.text).slice(0, 3);
      // e) a friend at HOME (pin far from any bar) is never "in the bar"
      const home = pin(9201, [60.1700, 15.2300], 3, { friend_name: "Oskar", snap: "area" });
      const e = rounds(150, [home], () => ({ center: LUD, now: at("22", "50"), checkins: [], liveTotal: 20, titles: { 9201: "Korpral Kanna" } }));
      const eBad = e.filter((x) => /gått in i baren|in i baren/i.test(x.text)).map((x) => x.text).slice(0, 2);
      // f) no sentence starts with a small letter
      const all = a.concat(b, c, e), fBad = all.filter((x) => /(^|[^.…])[.!?]["”»]?\s+[a-zåäö]/.test(x.text)).map((x) => x.text).slice(0, 3);
      return { aN: a.length, aQuiet, aCrowd: a.filter((x) => x.k === "checkinCrowd").length, bN: b.length, bBad, stuOk, cN: c.length, cBad, dN: d.length, dBad, eN: e.length, eBad, fBad };
    }, { SODER, dense: DENSE });
    ok(R.aN > 0 && !R.aQuiet.length, "ticker: 9 checked in near → no 'nobody out' line in the same snapshot " + JSON.stringify(R.aQuiet));
    ok(!R.bBad.length, "ticker: no Stureplan / Östermalm-only line for bars on Söder (" + R.bN + " items) " + JSON.stringify(R.bBad));
    ok(R.stuOk > 0, "ticker: at Stureplan the Stureplan lines still show (" + R.stuOk + ")");
    ok(R.cN > 0 && !R.cBad.length, "ticker 06:25: no night / evening lines (" + R.cN + " items) " + JSON.stringify(R.cBad));
    ok(R.dN > 0 && !R.dBad.length, "ticker: the country line = live_total 52, not the pins in view (" + R.dN + ") " + JSON.stringify(R.dBad));
    ok(R.eN > 0 && !R.eBad.length, "ticker: a friend at home never 'har gått in i baren' " + JSON.stringify(R.eBad));
    ok(!R.fBad.length, "ticker: every sentence starts with a capital " + JSON.stringify(R.fBad));
    await t.ctx.close();

    // g) the belt: a new snapshot (people came) drops the old pieces that are not on screen yet, an old quiet line on screen fades
    const t2 = await setup(browser, { empty: true, checkin: false, routes: async (page) => {
      await page.route(/rest\/v1\/rpc\/live_checkins\b/, (r) => J(r, page.__busy ? Array.from({ length: 9 }, (_, i) => ({ bar_id: "n3472634175", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679, name: null, is_mine: false, is_friend: false, created_at: iso(10 + i) })) : []));
    } });
    const p2 = t2.page;
    await wait(p2, 2500);
    const before = await p2.evaluate(() => [...document.querySelectorAll("#ticker-track .tk-item")].map((e) => e.textContent));
    p2.__busy = true;
    await p2.evaluate(() => window.PNDS._A().refresh());
    await wait(p2, 1500);
    const belt = await p2.evaluate((before) => {
      const tr = document.getElementById("ticker-track"), vp = tr.parentNode.getBoundingClientRect(), Q = /Ingen ute|Tomt på kartan|bara inte nåt här|sover|Tyst i|Lugnt läge|ingen har tryckt|tumbleweed|Radiotystnad/i;
      const items = [...tr.querySelectorAll(".tk-item")].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, on: r.left < vp.right && r.right > vp.left, right: r.left >= vp.right, stale: e.classList.contains("tk-stale"), old: before.includes(e.textContent) && e.classList.contains("tk-quiet") }; });
      const quiet = [...tr.querySelectorAll(".tk-item.tk-quiet")].filter((e) => !e.classList.contains("tk-stale")).map((e) => e.textContent);
      return { n: items.length, oldOff: items.filter((x) => x.right && x.old).map((x) => x.t), quietOn: quiet, before: before.length };
    }, before);
    ok(before.length > 0 && !belt.oldOff.length && !belt.quietOn.length, "ticker belt: after people come, no piece of the old snapshot waits off screen and no quiet line stays unfaded " + JSON.stringify(belt));
    await p2.screenshot({ path: SP + "fixm-shots/t14-belt-390.png" });
    await t2.ctx.close();
  }

  // ---------- T-15: the top bar pill = the local area count with its name (same for everyone); Sverige zoomed out; tap = Ute nu ----------
  if (want("pill")) {
    const ZC = { kommun: [{ c: "2085", n: 11, bar: "Pitchers" }, { c: "0180", n: 14 }, { c: "2061", n: null }], lan: [{ c: "20", n: 12 }, { c: "01", n: 14 }], total: 52, k: 3 };
    const zr = async (page) => {
      page.__zc = 0;
      await page.route(/rest\/v1\/rpc\/zone_counts\b/, (r) => { page.__zc++; return J(r, ZC); });
      await page.route(/rest\/v1\/rpc\/poll_public\b/, (r) => J(r, { v: 1, public: true, bbox: [55, 10, 69, 25], pins: [{ id: "h1", lat: 60.15124, lng: 15.18797, snap: "bar", beer_count: 2, created_at: iso(30) }], live_total: 44, checkins: [] }));
    };
    const pillTxt = (page) => page.evaluate(() => (document.getElementById("live-count").textContent || "").replace(/ /g, " ").trim());
    for (const who of ["signed-in", "anon"]) {
      const t = await setup(browser, { checkin: false, routes: zr, init: who === "anon" ? () => { try { localStorage.removeItem("olnu.auth"); localStorage.removeItem("olnu.uid"); } catch (e) {} } : null });
      const p = t.page;
      await view(p, [60.1505, 15.1872], 15); await wait(p, 2500);
      await p.waitForFunction(() => /Ludvika/.test(document.getElementById("live-count").textContent), null, { timeout: 8000 }).catch(() => {});
      const a = await pillTxt(p);
      ok(/^Ludvika · 11 ute( ikväll)?$/.test(a), who + ": z15 in Ludvika the pill says the kommun and its count ('" + a + "')");
      if (who === "signed-in") {
        await p.screenshot({ path: SP + "fixm-shots/t15-pill-ludvika-390.png" });
        await view(p, SODER, 15); await wait(p, 1800);
        const b = await pillTxt(p);
        ok(/^Stockholm · 14( ute)?( ikväll)?$/.test(b), "z15 on Söder: 'Stockholm · 14 ute' (ui1 B10 may drop the words, never the name) ('" + b + "')");
        await view(p, [60.135, 15.42], 13); await wait(p, 1500);
        const c = await pillTxt(p);
        ok(/^Smedjebacken · några( ute)?( ikväll)?$/.test(c), "1–2 people = 'några' ('" + c + "')");
        await view(p, [62.6, 16.4], 4.4); await wait(p, 1800);
        const d = await pillTxt(p);
        ok(/^Sverige · 52 ute( ikväll)?$/.test(d), "zoomed out to Sweden: 'Sverige · 52 ute' ('" + d + "')");
        await view(p, [60.1505, 15.1872], 15); await wait(p, 1500);
        // tap = the "Ute nu" sheet with the same area + number
        await p.click("#live-count"); await wait(p, 900);
        const sh = await p.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent, body: document.getElementById("sheet-body").textContent }));
        ok(sh.open && /Ute nu/.test(sh.title) && /Ludvika/.test(sh.body) && /11 ute/.test(sh.body) && /Pitchers/.test(sh.body), "tap on the pill opens 'Ute nu' (Ludvika · 11 ute, busiest bar, friends) " + JSON.stringify({ open: sh.open, title: sh.title, body: sh.body.slice(0, 160) }));
        const role = await p.evaluate(() => document.getElementById("live-count").getAttribute("role"));
        ok(role === "button", "the pill is a button for screen readers (" + role + ")");
        await p.screenshot({ path: SP + "fixm-shots/t15-ute-nu-390.png" });
        ok(p.__zc <= 4, "zone_counts asked at most once per 60 s (" + p.__zc + " calls in this run)");
      }
      await t.ctx.close();
    }
  }

  // ---------- T-24: one source for the crowd count + word (pins + check-ins), with hysteresis ----------
  if (want("crowd")) {
    const PIT = [60.14997, 15.18679];
    const t = await setup(browser, { checkin: false, routes: async (page) => {
      page.__pins = 1; page.__cis = 3;
      await page.route(/rest\/v1\/rpc\/live_beers\b/, (r) => J(r, Array.from({ length: page.__pins }, (_, i) => ({ id: 7000 + i, lat: PIT[0], lng: PIT[1], beer_count: 2, precise: true, created_at: iso(30), is_mine: false, friend_name: null, skal_count: 0 }))));
      await page.route(/rest\/v1\/rpc\/live_checkins\b/, (r) => J(r, Array.from({ length: page.__cis }, (_, i) => ({ bar_id: "n3472634175", bar_name: "Pitchers", lat: PIT[0], lng: PIT[1], name: null, is_mine: false, is_friend: false, created_at: iso(5 + i) }))));
    } });
    const p = t.page;
    const word = () => p.evaluate(() => {
      const A = window.PNDS._A(), bar = window.BARS.byId("n3472634175"), box = document.createElement("div"); box.innerHTML = A.barPopup(bar);
      const m = box.querySelector(".pn-mt b"), c = box.querySelector(".pp-crowd-t");
      return (m ? m.textContent : c ? c.textContent : "").replace(/\s+/g, " ").trim();
    });
    const poll = async () => { await p.evaluate(() => window.PNDS._A().refresh()); await wait(p, 1200); };
    await poll();
    const w1 = await word();
    ok(/^Livligt/.test(w1), "1 pin + 3 checked in at Pitchers = Livligt (" + w1 + ")");
    p.__pins = 3; p.__cis = 0; await poll();
    const w2 = await word();
    ok(/^Livligt · 3 här/.test(w2), "3 pins = 'Livligt · 3 här' (" + w2 + ")");
    p.__pins = 1; p.__cis = 0; await poll();
    const w3 = await word();
    ok(/^Livligt/.test(w3) && !/· 1 här/.test(w3), "a poll with 1 pin left: the word holds (no flip to Lugnt, no number below 3) (" + w3 + ")");
    p.__pins = 3; p.__cis = 3; await poll();
    const w4 = await word();
    ok(/^Livligt · 3 här/.test(w4), "3 pins + 3 checked in = 3 people (max, never the sum) (" + w4 + ")");
    p.__pins = 1; p.__cis = 0; await poll();
    await p.evaluate(() => { const real = Date.now; window.__realNow = real; Date.now = () => real() + 4 * 60e3; });
    await word();   // the lower level is seen (4 min later)
    await p.evaluate(() => { const real = window.__realNow; Date.now = () => real() + 8 * 60e3; });
    const w5 = await word();
    await p.evaluate(() => { Date.now = window.__realNow; });
    ok(/^Lugnt/.test(w5), "the word drops to Lugnt only after the lower level held 3 min (" + w5 + ")");
    await t.ctx.close();
  }


  // ---------- screenshots for DONE.md (only when asked: node fixm-pw.js <port> shots; FIXM_OLD=<dir> for "before") ----------
  if (ONLY.includes("shots")) {
    const tag = OLD ? "before" : "after";
    const ZC = { kommun: [{ c: "2085", n: 11, bar: "Pitchers" }, { c: "0180", n: 14 }], lan: [], total: 52, k: 3 };
    for (const [w, h] of [[360, 780], [390, 844], [430, 932]]) {
      const t = await setup(browser, { w, h, checkin: false, routes: async (page) => { await page.route(/rest\/v1\/rpc\/zone_counts\b/, (r) => J(r, ZC)); } });
      const p = t.page;
      await view(p, SODER, 15); await wait(p, 1800);
      await p.screenshot({ path: SP + "fixm-shots/" + tag + "-t10-dense-z15-" + w + ".png" });
      await view(p, SODER, 14); await wait(p, 1800);
      await p.screenshot({ path: SP + "fixm-shots/" + tag + "-t10-z14-" + w + ".png" });
      await view(p, [60.1505, 15.1872], 15); await wait(p, 2500);
      await p.screenshot({ path: SP + "fixm-shots/" + tag + "-t15-pill-" + w + ".png", clip: { x: 0, y: 0, width: w, height: 120 } });
      await p.click("#live-count").catch(() => {}); await wait(p, 900);
      await p.screenshot({ path: SP + "fixm-shots/" + tag + "-t15-tap-" + w + ".png" });
      await t.ctx.close();
      console.log("shots", tag, w);
    }
    ok(true, "screenshots " + tag);
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
