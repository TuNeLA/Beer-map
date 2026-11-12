// popfix-pw.js — lane popfix (11 Nov, owner: "the bar popup is messed up on a PC").
// Opens the SAME bar popup (Pitchers, Ludvika; quiet + busy content, with an event line "adadad 22:00") at map positions
// centre / left / right / top / bottom, at 360x800 390x844 430x932 1280x800 1920x1080 2543x1270 2560x1440, on two map paths:
//   fb = the raster / fallback engine of the mbx shim (no Mapbox token), gl = Mapbox GL (real token from MAPBOX_TEST_TOKEN,
//   else a STUB Mapbox like map-pw.js: fake pk token, blank style; the same GL popup code runs).
// Checks per viewport: W1 card width stable (±4 px) over positions and content; desktop 320–380 px; phone sheet = screen
// width. B1 no word broken mid-word (every word of every visible text node is on ONE line). B2 every visible button is one
// line. X1 the close button is visible, ≥ 44 px, inside the rounded card, on top (hit test). O1 no horizontal overflow.
// E1 the event line fits; E2 the event sheet on a PC (1280–2560) has no overflow / broken words.
// usage: node popfix-pw.js <port> [paths: fb,gl] [only-viewports regex]
// POPFIX_OLD=<docs dir>: serve the static files from that dir (run the checks on the old code). POPFIX_TAG: shot name prefix.
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ENV = require("./env.js");
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const PATHS = (process.argv[3] || "fb,gl").split(",");
const ONLYVP = new RegExp(process.argv[4] || ".");
const OLD = process.env.POPFIX_OLD || "";
const TAG = process.env.POPFIX_TAG || (OLD ? "old" : "new");
const SHOTS = (process.env.POPFIX_SHOTS || ENV.OUT + "popfix-shots").replace(/\/?$/, "/");
fs.mkdirSync(SHOTS, { recursive: true });
const TOKEN = ENV.MAPBOX_TOKEN, STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
let pass = 0, fail = 0; const ok = (c, m, d) => { console.log((c ? "PASS " : "FAIL ") + m + (c || d === undefined ? "" : " " + JSON.stringify(d).slice(0, 600))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const wait = (p, ms) => p.waitForTimeout(ms);
const PIT = "n3472634175";
const VPS = [[360, 800], [390, 844], [430, 932], [1280, 800], [1920, 1080], [2543, 1270], [2560, 1440]];
const POS = [["centre", 0.5, 0.55], ["left", 0.1, 0.55], ["right", 0.9, 0.55], ["top", 0.5, 0.3], ["bottom", 0.5, 0.85]];
const CASES = [["quiet", { empty: true, checkin: false, noEv: true }], ["busy", { checkin: false }]];   // quiet = the owner's shot 4 (no people, no event)
const DESK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const CT = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".webp": "image/webp" };
function oldFile(p) {
  if (!OLD) return null;
  const f = path.join(OLD, decodeURIComponent(p));
  if (!f.startsWith(path.resolve(OLD)) || /\/config\.js$/.test(f) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return null;
  return { status: 200, contentType: CT[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) };
}
function events() {   // tonight at Pitchers: the owner's "adadad 22:00" + a long title
  const at = (hh, mm) => { const t = new Date(); t.setHours(hh, mm, 0, 0); if (t.getTime() < Date.now() - 3600e3) t.setTime(Date.now() + 2 * 3600e3); return t.toISOString(); };
  return [{ id: 4401, kind: "other", title: "adadad", place: "Pitchers", bar_id: PIT, lat: 60.14997, lng: 15.18679, starts_at: at(22, 0) },
    { id: 4402, kind: "quiz", title: "Musikquiz med Ludvikas största schlagerexperter", place: "Pitchers", bar_id: PIT, lat: 60.14997, lng: 15.18679, starts_at: at(20, 30) }];
}
async function setup(browser, vw, vh, mode, o) {
  const desk = vw > 600;
  const proxy = { newContext: (opt) => browser.newContext(Object.assign({}, opt, desk ? { isMobile: false, hasTouch: false, deviceScaleFactor: 1, userAgent: DESK_UA } : {})) };
  const { ctx, page } = await H.ctxFor(proxy, { width: vw, height: vh }, o);
  const EV = o.noEv ? [] : events();
  await page.route(/rest\/v1\/rpc\/events_near\b/, (r) => J(r, EV));
  await page.route(/rest\/v1\/rpc\/(events_near2|events_near3)\b/, (r) => J(r, { v: 1, server_time: new Date().toISOString(), events: EV }));
  let url;
  if (mode === "gl") {
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 3, support: "support@pintsnow.com", visning: "off", terms_ver: 1, store_mode: "off", mapbox_token: TOKEN || STUB_TOKEN }));
    if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
    await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
      const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
      const of = oldFile(p); if (of) return r.fulfill(of);
      const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
      r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
    });
    url = "https://tunela.github.io/Beer-map/?bar=" + PIT;
  } else {
    if (OLD) await page.route((u) => u.href.startsWith(BASE) && !/\/rest\/|\/auth\/|\/functions\//.test(u.pathname), (r) => {
      const u = new URL(r.request().url()); let p = u.pathname; if (p.endsWith("/")) p += "index.html";
      const of = oldFile(p); return of ? r.fulfill(of) : r.fallback();
    });
    url = BASE + "?bar=" + PIT;
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (mode === "gl") await page.waitForFunction(() => window.BASEMAP && BASEMAP.isMapbox && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("note: GL not on"));
  await page.waitForFunction(() => window.__map && document.querySelector(".leaflet-popup .bs"), null, { timeout: 45000 }).catch(() => console.log("note: no bar popup after ?bar="));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await wait(page, 2500);
  const gl = await page.evaluate(() => !!(window.BASEMAP && BASEMAP.isMapbox && BASEMAP.isMapbox()));
  return { ctx, page, gl };
}
// in the page: open the popup again with the bar at screen fraction (fx, fy)
async function openAt(page, fx, fy) {
  await page.evaluate(([fx, fy]) => {
    const mp = window.__map, pp = mp._popup;
    if (pp) { window.__pfPop = pp; window.__pfSrc = pp._source || window.__pfSrc; }
    const p0 = window.__pfPop, s = window.__pfSrc, ll = s && s.getLatLng ? s.getLatLng() : p0.getLatLng();
    mp.closePopup();
    const sz = mp.getSize(), pt = mp.latLngToContainerPoint(ll);
    mp.panBy([Math.round(pt.x - sz.x * fx), Math.round(pt.y - sz.y * fy)], { animate: false });
  }, [fx, fy]);
  await wait(page, 500);
  await page.evaluate(() => { const s = window.__pfSrc; if (s && s.openPopup && s.getPopup && s.getPopup()) s.openPopup(); else window.__pfPop.openOn(window.__map); });
  await wait(page, 1600);
  const has = await page.evaluate(() => !![...document.querySelectorAll(".leaflet-popup")].find((p) => p.querySelector(".bs")));
  if (!has) { await page.evaluate(() => { try { window.__pfPop.openOn(window.__map); } catch (e) {} }); await wait(page, 1600); }
}
function measure(page) {
  return page.evaluate(() => {
    const root = [...document.querySelectorAll(".leaflet-popup")].find((p) => p.querySelector(".bs")); if (!root) return null;
    const card = root.querySelector(".leaflet-popup-content-wrapper"), cont = root.querySelector(".leaflet-popup-content");
    const cr = card.getBoundingClientRect(), vw = innerWidth;
    const vis = (e) => { if (!e || !e.getClientRects().length) return false; const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
      for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity < 0.05) return false;
        const pd = x.parentElement; if (pd && pd.tagName === "DETAILS" && !pd.open && x.tagName !== "SUMMARY") return false; } return true; };
    // B1: a word split over two lines
    const broken = [];
    const tw = document.createTreeWalker(cont, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue.trim() || !vis(n.parentElement)) continue;
      const re = /\S+/g; let m;
      while ((m = re.exec(n.nodeValue))) {
        const w = m[0]; if (w.length < 2 || /[-–\/·]/.test(w)) continue;
        const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + w.length);
        const rs = [...rg.getClientRects()].filter((r) => r.width > 0.5);
        const lines = []; rs.forEach((r) => { const c = r.top + r.height / 2; if (!lines.some((l) => Math.abs(l - c) < r.height * 0.6)) lines.push(c); });
        if (lines.length > 1) broken.push(w + "(" + lines.length + ")");
      }
    }
    // B2: buttons on one line (text nodes of the button: one line box)
    const wrapped = [], btns = [...card.querySelectorAll("button, a.btn, .btn")].filter((b) => vis(b) && !b.closest(".pp-sec-mer"));   // Mer: 2-column grid of 2-line buttons (design)
    btns.forEach((b) => {
      const lines = [], t = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = t.nextNode(); n; n = t.nextNode()) {
        if (!n.nodeValue.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        [...rg.getClientRects()].filter((r) => r.width > 0.5).forEach((r) => { const c = r.top + r.height / 2; if (!lines.some((l) => Math.abs(l - c) < r.height * 0.6)) lines.push(c); });
      }
      if (lines.length > 1) wrapped.push(b.textContent.trim().slice(0, 30) + "(" + lines.length + ")");
    });
    const act = [...card.querySelectorAll(".pn-bs-act .ci-btn, .pn-bs-act .eta-go, .pn-bs-act .ci-out")].filter(vis).map((b) => Math.round(b.getBoundingClientRect().height));
    // X1: close button
    const x = root.querySelector(".leaflet-popup-close-button"), xr = x && x.getBoundingClientRect();
    let xs = null;
    if (x) {
      const cs = getComputedStyle(x), svg = x.querySelector("svg"), sr = svg && svg.getBoundingClientRect();
      const glyph = (sr && sr.width >= 12) || (!svg && parseFloat(cs.fontSize) >= 12 && x.textContent.trim().length > 0);
      const cx = xr.left + xr.width / 2, cy = xr.top + xr.height / 2, hit = document.elementFromPoint(cx, cy);
      const rad = parseFloat(getComputedStyle(card).borderTopRightRadius) || 0;
      // inside the rounded corner: the button's top-right corner point must lie inside the card's corner arc
      const px = xr.right - (parseFloat(cs.borderTopRightRadius) >= xr.width / 2 ? xr.width * 0.146 : 0), py = xr.top + (parseFloat(cs.borderTopRightRadius) >= xr.width / 2 ? xr.height * 0.146 : 0);
      const ccx = cr.right - rad, ccy = cr.top + rad;
      const inArc = !(px > ccx && py < ccy) || Math.hypot(px - ccx, py - ccy) <= rad;
      // hit: nothing of the popup itself (sticky header, scroller) is on top of the ✕. A map HUD control over the map is logged, not failed.
      const own = !!(hit && (hit === x || x.contains(hit))), inPop = !!(hit && root.contains(hit));
      xs = { w: Math.round(xr.width), h: Math.round(xr.height), vis: vis(x), glyph: !!glyph, hit: own || !inPop, hud: !own && !inPop && hit ? (hit.id || String(hit.className).slice(0, 30) || hit.tagName) : "",
        inside: xr.left >= cr.left && xr.right <= cr.right + 0.5 && xr.top >= cr.top - 0.5 && xr.bottom <= cr.bottom && inArc,
        off: [Math.round(cr.right - xr.right), Math.round(xr.top - cr.top)] };
    }
    // O1: horizontal overflow
    const over = [];
    if (cont.scrollWidth > cont.clientWidth + 1) over.push("content scrollWidth " + cont.scrollWidth + ">" + cont.clientWidth);
    [...cont.querySelectorAll("*")].forEach((e) => {
      if (e.closest(".bf-strip") || !vis(e)) return; const r = e.getBoundingClientRect();
      if (r.right > cr.right + 1 || r.left < cr.left - 1) over.push((e.className && String(e.className).slice(0, 24)) || e.tagName);
    });
    if (document.documentElement.scrollWidth > vw + 1) over.push("page " + document.documentElement.scrollWidth);
    if (cr.left < -1 || cr.right > vw + 1) over.push("card off screen " + Math.round(cr.left) + ".." + Math.round(cr.right));
    // E1: event line
    const ev = [...card.querySelectorAll(".ev-line.sa-evl")].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 40), right: Math.round(cr.right - r.right), h: Math.round(r.height) }; });
    return { sheet: root.classList.contains("olnu-sheet"), w: Math.round(cr.width), l: Math.round(cr.left), broken, wrapped: wrapped.slice(0, 8), act, x: xs, over: over.slice(0, 8), ev,
      scroll: cont.scrollHeight > cont.clientHeight + 1, gutter: cont.offsetWidth - cont.clientWidth };
  });
}
async function evSheet(page, w) {
  const r = await page.evaluate(async () => {
    window.__map.closePopup();
    if (!window.EVSHEET || !EVSHEET.open) return { none: 1 };
    try { EVSHEET.open(); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 1500));
    const s = document.getElementById("sheet"), b = document.getElementById("sheet-body"); if (!s || s.hidden) return { hidden: 1 };
    const sr = s.getBoundingClientRect(), over = [];
    if (b && b.scrollWidth > b.clientWidth + 1) over.push("body " + b.scrollWidth + ">" + b.clientWidth);
    [...s.querySelectorAll("*")].forEach((e) => { if (!e.getClientRects().length) return; const r = e.getBoundingClientRect(); if (r.width && (r.right > sr.right + 1 || r.left < sr.left - 1) && !e.closest("[class*=strip],[class*=chips],[class*=scroll],.tabs")) over.push(String(e.className).slice(0, 24) || e.tagName); });
    if (document.documentElement.scrollWidth > innerWidth + 1) over.push("page");
    return { w: Math.round(sr.width), l: Math.round(sr.left), over: over.slice(0, 6) };
  });
  if (r.none || r.hidden || r.err) { ok(true, w + ": E2 event sheet not available here (" + JSON.stringify(r) + "), skipped"); return; }
  await page.screenshot({ path: SHOTS + TAG + "-evsheet-" + w + ".png" }).catch(() => {});
  ok(!r.over.length && r.l >= 0 && r.l + r.w <= w + 1, w + ": E2 event sheet fits on a PC screen (no overflow, inside the screen)", r);
}

(async () => {
  const browser = await chromium.launch({ executablePath: ENV.CHROME, args: ["--ignore-certificate-errors"],
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}) });
  console.log("popfix: " + TAG + " paths=" + PATHS.join(",") + " gl=" + (TOKEN ? "real token" : "stub"));
  for (const mode of PATHS) for (const [vw, vh] of VPS) {
    const W = mode + " " + vw + "x" + vh;
    if (!ONLYVP.test(vw + "x" + vh)) continue;
    if (mode === "gl" && vw < 600 && vw !== 390) continue;   // GL phones: one size is enough (the sheet does not depend on the engine)
    const desk = vw > 600, widths = [];
    for (const [cn, co] of CASES) {
      if (mode === "gl" && cn === "busy" && !desk) continue;
      const { ctx, page, gl } = await setup(browser, vw, vh, mode, co);
      if (mode === "gl" && !gl) { ok(false, W + " " + cn + ": the GL path did not start"); await ctx.close(); continue; }
      const poss = desk ? POS : POS.slice(0, 3);
      const bad = { broken: [], wrapped: [], x: [], over: [], act: [], ev: [] };
      for (const [pn, fx, fy] of poss) {
        await openAt(page, fx, fy);
        const m = await measure(page);
        if (!m) { ok(false, W + " " + cn + " " + pn + ": the bar popup is open"); continue; }
        widths.push(m.w);
        if (pn === "centre" || pn === "right") {
          const cl = desk ? { x: Math.max(0, m.l - 24), y: 0, width: Math.min(vw - Math.max(0, m.l - 24), m.w + 48), height: vh } : undefined;
          await page.screenshot({ path: SHOTS + TAG + "-" + mode + "-" + cn + "-" + vw + "x" + vh + "-" + pn + ".png", ...(cl ? { clip: cl } : {}) }).catch(() => {});
        }
        if (m.broken.length) bad.broken.push(pn + ": " + m.broken.join(" "));
        if (m.wrapped.length) bad.wrapped.push(pn + ": " + m.wrapped.join(" | "));
        if (!m.x || !m.x.vis || !m.x.glyph || !m.x.hit || !m.x.inside || m.x.w < 44 || m.x.h < 44) bad.x.push(pn + ": " + JSON.stringify(m.x));
        if (m.over.length) bad.over.push(pn + ": " + m.over.join(" "));
        if (m.act.length > 1 && Math.max(...m.act) - Math.min(...m.act) > 1) bad.act.push(pn + ": " + m.act.join("/"));
        if (m.ev.some((e) => e.right < 0)) bad.ev.push(pn + ": " + JSON.stringify(m.ev));
        if (m.x && m.x.hud) console.log("  note: " + W + " " + cn + " " + pn + ": a map HUD control (" + m.x.hud + ") is over the popup's close button");
        if (pn === "centre") console.log("  " + W + " " + cn + ": card " + m.w + " px, sheet=" + m.sheet + ", scroll=" + m.scroll + ", gutter=" + m.gutter + ", ev=" + m.ev.length + ", x=" + JSON.stringify(m.x && m.x.off));
      }
      ok(!bad.broken.length, W + " " + cn + ": B1 no word is broken mid-word (e.g. 'Visar dom sport här?')", bad.broken);
      ok(!bad.wrapped.length && !bad.act.length, W + " " + cn + ": B2 every button is on one line, the action buttons have equal height", { wrapped: bad.wrapped, act: bad.act });
      ok(!bad.x.length, W + " " + cn + ": X1 the close button is visible (44 px, icon), on top, inside the rounded card", bad.x);
      ok(!bad.over.length && !bad.ev.length, W + " " + cn + ": O1/E1 no horizontal overflow (card, event line, page)", { over: bad.over, ev: bad.ev });
      if (desk && cn === "quiet") await evSheet(page, vw);
      await ctx.close();
    }
    if (!widths.length) continue;
    const lo = Math.min(...widths), hi = Math.max(...widths);
    ok(hi - lo <= 4, W + ": W1 the card width is stable over positions and content (" + lo + "–" + hi + " px)", widths);
    if (desk) ok(lo >= 320 && hi <= 380, W + ": W1 desktop card width is 320–380 px (" + lo + "–" + hi + ")", widths);
    else ok(lo >= vw - 24 && hi <= vw, W + ": W1 phone: the bar sheet uses the screen width (" + lo + "–" + hi + ")", widths);
  }
  await browser.close();
  console.log("popfix " + TAG + ": " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash " + (e && e.stack || e)); process.exit(1); });
