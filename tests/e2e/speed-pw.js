// speed probe (zones/speed batch): boot to first map, timers + RPCs while hidden, resume burst after visibilitychange.
// Mocked server (d2-helpers), raster fallback (no Mapbox token = 0 map loads). Each RPC answers after 250 ms (a phone network).
// node speed-pw.js <port> <tag> [fresh]   → speed-<tag>.json   (fresh = no stored session: lazy-account check)
const { chromium } = require("playwright");
const fs = require("fs");
const { ctxFor, wait } = require("./d2-helpers.js");
const SP = require("./env.js").OUT;
const PORT = process.argv[2], TAG = process.argv[3] || "x", FRESH = process.argv[4] === "fresh";
const LAT = 250;
(async () => {
  const b = await chromium.launch({ executablePath: require("./env.js").CHROME });
  const nc = b.newContext.bind(b); b.newContext = (o) => nc({ ...o, serviceWorkers: "block" });
  const { ctx, page } = await ctxFor(b, { width: 412, height: 915 }, FRESH ? { clean: true } : {});
  // fresh = a first visit that has seen the intro (no session, no account id)
  if (FRESH) await ctx.addInitScript(() => { if (sessionStorage.getItem("fr")) return; sessionStorage.setItem("fr", 1);
    ["olnu.age18", "olnu.intro", "olnu.newsPn", "olnu.notifAsked", "olnu.installSeen", "olnu.locOk"].forEach((k) => localStorage.setItem(k, "1"));
    localStorage.setItem("olnu.guideSeen", String(Date.now())); localStorage.setItem("olnu.notifAskAt", String(Date.now())); localStorage.setItem("olnu.lang", "sv"); });
  // hidden switch + timer probe (before any app script)
  await ctx.addInitScript(() => {
    let hid = false;
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return hid ? "hidden" : "visible"; } });
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return hid; } });
    window.__setHidden = (v) => { hid = v; document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event(v ? "pagehide" : "pageshow")); };
    window.__tw = { hidden: 0, by: {} };
    const wrap = (name) => { const o = window[name]; window[name] = function (fn, ms) { const a = [].slice.call(arguments, 2);
      const st = (new Error().stack || "").split("\n")[2] || ""; const m = /\/(js\/[\w.-]+|app\.js|[\w.-]+\.js)/.exec(st); const who = m ? m[1] : "?";
      const f = typeof fn === "function" ? function () { if (hid) { __tw.hidden++; __tw.by[who] = (__tw.by[who] || 0) + 1; } return fn.apply(this, arguments); } : fn;
      return o.call(window, f, ms, ...a); }; };
    wrap("setTimeout"); wrap("setInterval");
  });
  const reqs = []; let inflight = 0, t0 = Date.now();
  await page.route(/supabase\.co\/(rest\/v1\/rpc|auth\/v1)\//, async (r) => {
    const u = r.request().url(), name = (u.match(/rpc\/(\w+)/) || [0, "auth:" + (u.match(/auth\/v1\/(\w+)/) || [0, "?"])[1]])[1];
    const rec = { name, t: Date.now() - t0, inflightAtStart: ++inflight }; reqs.push(rec);
    await new Promise((res) => setTimeout(res, LAT));
    inflight--; rec.end = Date.now() - t0;
    if (name === "poll_v2" || name === "poll_public") {   // like strip-test: the real poll path (not the legacy fallback)
      let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
      const pins = [[60.15124, 15.18797, 7], [60.14997, 15.18679, 5], [60.15098, 15.18663, 3], [60.15205, 15.18059, 2], [60.1545, 15.196, 4], [60.1462, 15.1801, 1]]
        .map((p, i) => ({ id: 500 + i, lat: p[0], lng: p[1], beer_count: p[2], precise: true, created_at: new Date(Date.now() - 3e6).toISOString(), is_mine: i === 1 && name === "poll_v2" }));
      const me = name === "poll_v2" ? { beer_count: 5, other_count: 0, wait_seconds: 0, expires_at: new Date(Date.now() + 5 * 3600e3).toISOString(), total: 43 } : null;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, server_time: new Date().toISOString(), full: true,
        bbox: [body.p_min_lat - 0.01, body.p_min_lng - 0.01, body.p_max_lat + 0.01, body.p_max_lng + 0.01], pins, capped: false, pins_in_view: pins.length,
        live_total: 23, me, checkins: [], rallies: [], heat: body.p_heat ? pins.map((p) => [p.lat, p.lng, p.beer_count]) : null }) });
    }
    return r.fallback();
  });
  t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const boot = await page.evaluate(() => new Promise((res) => {
    const st = performance.now(); let mapAt = null;
    const iv = setInterval(() => { if (!mapAt && window.__map && document.querySelector(".leaflet-tile-loaded")) mapAt = performance.now();
      const pills = document.querySelectorAll(".pill").length;
      if ((mapAt && pills > 3) || performance.now() - st > 20000) { clearInterval(iv); res({ firstMapMs: Math.round(mapAt || -1), firstPillsMs: Math.round(performance.now()), pills, dcl: Math.round(performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd) }); } }, 50);
  }));
  await wait(page, 9000);
  const bootReqs = reqs.filter((x) => x.t < (Date.now() - t0)).length;
  const bootAuth = reqs.filter((x) => /^auth:/.test(x.name)).map((x) => x.name);
  const signedIn = await page.evaluate(() => { try { const a = JSON.parse(localStorage.getItem("olnu.auth") || "null"); return !!(a && a.access_token); } catch (e) { return false; } });
  // hidden for 40 s
  const nBefore = reqs.length;
  await page.evaluate(() => { __tw.hidden = 0; __tw.by = {}; __setHidden(true); });
  const hidAt = Date.now() - t0;
  await wait(page, 40000);
  const hiddenInfo = await page.evaluate(() => ({ timerFires: __tw.hidden, by: __tw.by }));
  const hiddenRpcs = reqs.slice(nBefore).filter((x) => x.t > hidAt + 300).map((x) => x.name);
  // resume
  // the access token ran out while the app was in the background (the real-phone case)
  await page.evaluate(() => { try { const a = JSON.parse(localStorage.getItem("olnu.auth") || "null"); if (a) { a.expires_at = Math.floor(Date.now() / 1000) - 60; localStorage.setItem("olnu.auth", JSON.stringify(a)); } } catch (e) {} });
  const nRes = reqs.length, resAt = Date.now() - t0;
  await page.evaluate(() => __setHidden(false));
  await wait(page, 6000);
  const burst = reqs.slice(nRes);
  const in2s = burst.filter((x) => x.t - resAt <= 2000);
  const maxInflight = Math.max(0, ...burst.map((x) => x.inflightAtStart));
  const settle = burst.length ? Math.max(...burst.map((x) => (x.end || x.t) - resAt)) : 0;
  const firstAuthIdx = burst.findIndex((x) => /^auth:/.test(x.name));
  let action = null;
  if (FRESH) {   // the first real action: ÖL!
    const n0 = reqs.length;
    await page.evaluate(() => { const b = document.getElementById("btn-beer"); if (b) b.click(); });
    await page.mouse.click(206, 845).catch(() => {});
    await wait(page, 6000);
    const names = reqs.slice(n0).map((x) => x.name);
    const ui = await page.evaluate(() => { const sh = document.getElementById("sheet"); return { sheet: !!(sh && !sh.hidden), title: sh && !sh.hidden ? (sh.textContent || "").replace(/\s+/g, " ").slice(0, 90) : "", authed: !!localStorage.getItem("olnu.auth") }; });
    await page.screenshot({ path: SP + "speed-" + TAG + "-action.png" });
    action = { ui, signup: names.filter((x) => x === "auth:signup").length, post: names.filter((x) => /^post_beer/.test(x)).length, first: names.slice(0, 6) };
  }
  const out = { tag: TAG, action, fresh: FRESH, latencyMs: LAT, boot: Object.assign(boot, { rpcsFirst9s: bootReqs, auth: bootAuth, sessionStored: signedIn }),
    hidden40s: { rpcs: hiddenRpcs.length, names: hiddenRpcs, timerFires: hiddenInfo.timerFires, timerBy: hiddenInfo.by },
    resume: { calls6s: burst.length, calls2s: in2s.length, maxInflight, settleMs: settle, authFirst: firstAuthIdx === 0, names: burst.map((x) => x.name) } };
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(SP + "speed-" + TAG + ".json", JSON.stringify(out, null, 1));
  await ctx.close(); await b.close();
})();
