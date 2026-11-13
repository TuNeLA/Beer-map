// hitta2-pw.js — lane hitta2 (13 Nov 2026, owner test with a friend): Hitta (find my friend) compass.
// I-92 the arrow jumped / spun: noisy heading samples around 359/1 and 179/181 with single outliers, friend 300 km away
//   (the bearing is fixed, so every jump is heading/rotation): the rendered rotation never moves > 30° between frames,
//   at most ~10 updates per second; at 12 m "Nära! Titta runt" shows and the arrow STAYS (owner 17:48).
// I-93 the found person locks the screen: the seeker sees "Senast sedd (vid bar) för 2 min sedan" (grey after 5 min);
//   the found phone shows "Du kan låsa skärmen", sends its last fix when it hides and a fresh fix when it wakes.
// Mocked Supabase (d2-helpers) + mocked find_* RPCs, geolocation and deviceorientation. node hitta2-pw.js <port>
const H = require("./d2-helpers.js");
const { chromium } = require("playwright");
const CHROME = require("./env.js").CHROME;
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const iso = (min) => new Date(Date.now() + min * 60e3).toISOString();
const ME = { latitude: 60.1505, longitude: 15.1872 };

async function open(b, o) {
  const { ctx, page } = await H.ctxFor(b, { width: 390, height: 844 });
  await ctx.setGeolocation({ ...ME, accuracy: 5 });
  const S = { tgt: o.tgt, pings: [], req: o.req || { id: 77, key: "f123", name: "Lisa", status: "accepted", mine: true, until: iso(20) } };
  await page.route(/rest\/v1\/rpc\/(find_request|find_ping|find_stop|find_answer|find_cancel)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "find_request") return J(r, S.req);
    if (fn === "find_ping") { S.pings.push({ t: Date.now(), lat: body.p_lat, lng: body.p_lng });
      return J(r, { ok: true, name: "Lisa", allowed: true, status: S.req.status, req_id: S.req.id, until: S.req.until, target: S.tgt, finding_me: true }); }
    return J(r, { ok: true });
  });
  await H.boot(page);
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => {
    window.__hid = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !!window.__hid });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window.__hid ? "hidden" : "visible") });
    const geo = navigator.geolocation, g0 = geo.getCurrentPosition.bind(geo); window.__gcp = { n: 0, ok: 0, err: null };
    geo.getCurrentPosition = (s, e, o) => { window.__gcp.n++; g0((p) => { window.__gcp.ok++; s(p); }, (x) => { window.__gcp.err = x && x.code; if (e) e(x); }, o); };
    window.NEAR.openFinder("f123", "Lisa");
  });
  await page.waitForFunction(() => document.querySelector(".nr-arrow.on"), null, { timeout: 15000 }).catch(() => console.log("arrow not on"));
  return { ctx, page, S };
}
// Dispatch compass samples (Android absolute stream) every 16 ms, record the arrow's inline rotation on every frame.
async function spin(page, list) {
  return page.evaluate((list) => new Promise((res) => {
    const arrow = document.querySelector(".nr-arrow"), rec = []; let i = 0, done = false;
    const rd = () => { const m = /rotate\((-?[\d.]+)deg\)/.exec(arrow.style.transform || ""); return m ? +m[1] : null; };
    (function frame() { const v = rd(); if (v != null) rec.push({ v, t: performance.now() }); if (!done) requestAnimationFrame(frame); })();
    const tm = setInterval(() => {
      if (i >= list.length) { clearInterval(tm); setTimeout(() => { done = true; res(rec); }, 400); return; }
      const h = list[i++], e = new Event("deviceorientationabsolute");
      Object.assign(e, { alpha: (360 - h) % 360, beta: 10, gamma: 0, absolute: true });
      window.dispatchEvent(e);
    }, 16);
  }), list);
}
function stats(rec) {
  let max = 0, changes = 0;
  for (let i = 1; i < rec.length; i++) { const d = Math.abs(rec[i].v - rec[i - 1].v); if (d > max) max = d; if (d > 0.05) changes++; }
  const secs = rec.length > 1 ? (rec[rec.length - 1].t - rec[0].t) / 1000 : 1;
  return { max: Math.round(max * 10) / 10, perSec: Math.round(changes / secs * 10) / 10, n: rec.length };
}
const noisy = (c, n) => Array.from({ length: n }, (_, i) => (i % 37 === 20 ? c + 90 : c + ((i * 7919) % 25) - 12 + 360) % 360);

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  try {
    /* 1. I-92: 300 km apart (bearing fixed), heading noise around 359/1, then 179/181, single outliers */
    {
      const { ctx, page } = await open(b, { tgt: { lat: 62.85, lng: 15.1872, acc: 10, age_s: 2, live: true } });
      const r1 = stats(await spin(page, noisy(0, 150)));
      ok(r1.n > 20 && r1.max <= 30, "300 km, heading 359/1 + outliers: the arrow never moves > 30° between frames", r1);
      const r2 = stats(await spin(page, noisy(180, 150)));
      ok(r2.n > 20 && r2.max <= 30, "300 km, heading 179/181 + outliers: no jump > 30°", r2);
      ok(r1.perSec <= 12 && r2.perSec <= 12, "the arrow updates at most ~10 times per second", { r1, r2 });
      const cs = await page.evaluate(() => getComputedStyle(document.querySelector(".nr-arrow")).transitionDuration);
      ok(/^0\.1s/.test(cs), "short linear glide (100 ms), not a long animated spin", cs);
      await ctx.close();
    }
    /* 2. I-92: 12 m away: "Nära! Titta runt" + ~12 m, the arrow stays (owner 17:48) */
    {
      const { ctx, page } = await open(b, { tgt: { lat: ME.latitude + 12 / 111320, lng: ME.longitude, acc: 5, age_s: 1, live: true } });
      await page.waitForTimeout(800);
      const s = await page.evaluate(() => { const n = document.querySelector(".nr-near"); return { near: n && !n.hidden ? n.textContent : "", dist: document.querySelector(".nr-dist").textContent,
        arrow: !!document.querySelector(".nr-arrow.on"), pulse: document.querySelector(".nr-dial").classList.contains("near") }; });
      ok(/Nära! Titta runt/.test(s.near) && /~1[0-4] m/.test(s.dist), "12 m: Nära! Titta runt + ~12 m", s);
      ok(s.arrow && s.pulse, "12 m: the arrow stays, the ring pulses softly", s);
      await ctx.close();
    }
    /* 3. I-93: the found phone is locked: the server keeps the last fix; the seeker sees Senast sedd + bar, grey after 5 min */
    {
      const { ctx, page, S } = await open(b, { tgt: { lat: 60.15124, lng: 15.18797, acc: 12, age_s: 130, live: false, bar: "La Parma" } });
      await page.waitForTimeout(600);
      const s = await page.evaluate(() => ({ st: document.querySelector(".nr-status").textContent, arrow: !!document.querySelector(".nr-arrow.on"),
        stale: document.querySelector(".nr-dial").classList.contains("stale") }));
      ok(/Senast sedd vid La Parma för 2 min sedan/.test(s.st) && s.arrow && !s.stale, "seeker: Senast sedd vid La Parma för 2 min sedan, the arrow points there", s);
      S.tgt = { lat: 60.15124, lng: 15.18797, acc: 12, age_s: 400, live: false };
      await page.waitForTimeout(6800);
      const g = await page.evaluate(() => ({ st: document.querySelector(".nr-status").textContent, stale: document.querySelector(".nr-dial").classList.contains("stale") }));
      ok(/Senast sedd för 7 min sedan/.test(g.st) && g.stale, "after 5 min: greyed", g);
      await ctx.close();
    }
    /* 4. I-93: the found phone: lock line, last fix on hide, a fresh fix at once on wake */
    {
      const { ctx, page, S } = await open(b, { req: { id: 78, key: "f123", name: "Lisa", status: "accepted", mine: false, until: iso(20) },
        tgt: { lat: 60.1508, lng: 15.1875, acc: 8, age_s: 2, live: true } });
      await page.waitForTimeout(500);
      const lk = await page.evaluate(() => { const e = document.querySelector(".nr-lock"); return e && !e.hidden ? e.textContent : ""; });
      ok(/Du kan låsa skärmen – vi visar var du var senast/.test(lk), "found phone: Du kan låsa skärmen – vi visar var du var senast", lk);
      // sync to a ping, then hide
      let n0 = S.pings.length; for (let i = 0; i < 80 && S.pings.length === n0; i++) await page.waitForTimeout(100);
      n0 = S.pings.length;
      await page.evaluate(() => { window.__hid = true; document.dispatchEvent(new Event("visibilitychange")); });
      await page.waitForTimeout(700);
      ok(S.pings.length > n0, "hide: the last good fix goes to the server at once", { before: n0, after: S.pings.length });
      // sync to an interval ping (the next one is 6 s away), then wake: the GPS gives a new fix right after the wake
      let n1 = S.pings.length; for (let i = 0; i < 80 && S.pings.length === n1; i++) await page.waitForTimeout(100);
      n1 = S.pings.length;
      await page.evaluate(() => { window.__hid = false; document.dispatchEvent(new Event("visibilitychange")); });
      await ctx.setGeolocation({ latitude: 60.1530, longitude: 15.1900, accuracy: 6 });
      await page.waitForTimeout(1500);
      const fresh = S.pings.slice(n1).filter((p) => Math.abs(p.lat - 60.1530) < 1e-4);
      const dg = await page.evaluate(() => ({ gcp: window.__gcp, open: !!document.querySelector(".nr-finder") }));
      ok(fresh.length > 0, "wake: a fresh fix is sent within 1.5 s", { pings: S.pings.slice(n1), dg });
      await ctx.close();
    }
  } catch (e) { ok(false, "crash " + e.message); }
  await b.close();
  console.log(`hitta2: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
