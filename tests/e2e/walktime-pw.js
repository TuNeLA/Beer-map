// walktime-pw.js — PLAN E6 "Walking time to bars" (lane walktime, 24 Nov 2026). docs/js/walktime.js + docs/walktime.css + 2 hooks
// in docs/js/barsearch.js. Checks: "ca 9 min promenad" in the bar card's meta line (on-phone estimate, NO network call), no time with
// a rough fix (> 100 m) or no position, the open card follows a new fix, Sök › Krogar rows say "ca N min" and the empty field lists
// "Inom 10 min promenad", the route option (OFF by default; ON = mocked Mapbox Directions: cell centre not the GPS point, cached,
// error -> estimate, hidden page -> no call). Old code: no .pn-wt / no WALKTIME -> the checks fail.
// 390 px, mocked Supabase. Usage: node walktime-pw.js <port>       Pictures only: node walktime-pw.js <port> --shots <dir> <prefix>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };
const SHOTS = process.argv[3] === "--shots" ? process.argv[4] : "", PFX = process.argv[5] || "after";
const PARMA = "x-la-parma-ludvika", LL = [60.15124, 15.18797];
const ME = { latitude: 60.1545, longitude: 15.1960, accuracy: 20 };   // about 574 m straight from La Parma -> "ca 9 min"
const FAKE = "pk.e2e-not-a-real-token";

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  if (o.geo !== null) await ctx.setGeolocation(Object.assign({}, ME, o.geo || {}));
  else await ctx.clearPermissions();
  const errs = [], dir = [], logs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => logs.push(m.text()));
  page.on("request", (r) => { if (/api\.mapbox\.com\/directions\//.test(r.url())) dir.push(r.url().replace(/access_token=[^&]+/, "access_token=***")); });
  await boot(page);
  await page.waitForFunction(() => window.PNDS && PNDS._A && PNDS._A() && window.__map, null, { timeout: 15000 }).catch(() => console.log("no PNDS"));
  if (o.geo !== null) await page.evaluate(() => new Promise((res) => navigator.geolocation.getCurrentPosition(res, res, { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 })));
  await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
  return { ctx, page, errs, dir, logs };
}
// the real La Parma marker, or the app's own barPopup for a changed bar (other id = a new cache key)
async function card(page, c) {
  await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} });
  await wait(page, 250);
  await page.evaluate((ll) => window.__map.setView(ll, 17, { animate: false }), LL); await wait(page, 700);
  const r = await page.evaluate(([id, c]) => {
    let m = null; window.__map.eachLayer((l) => { const o = l.options && l.options.olnuC; if (o && o.bar && String(o.bar.id) === id) m = l; });
    if (!m) return "no marker";
    const o = m.options.olnuC;
    if (!c) { m.fire("click"); return "marker"; }
    L.popup({ offset: L.point(0, -10), className: "olnu-bar" }).setLatLng(m.getLatLng()).setContent(PNDS._A().barPopup(Object.assign({}, o.bar, c), o.beers || [])).openOn(window.__map);
    return "popup";
  }, [PARMA, c || null]);
  await wait(page, 1400);
  await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
  return r;
}
const wt = (page) => page.evaluate(() => {
  const pop = document.querySelector(".leaflet-popup:has(.bs)"), e = pop && pop.querySelector(".pn-wt");
  if (!e) return { el: false, pop: !!pop };
  const r = e.getBoundingClientRect(), meta = e.closest(".bs-meta"), cs = getComputedStyle(e), sep = getComputedStyle(e, "::before").content;
  return { el: true, shown: !e.hidden && cs.display !== "none" && r.width > 0, txt: (e.querySelector(".pn-wt-t") || e).textContent, src: e.getAttribute("data-wt-src"),
    inMeta: !!(meta && meta.closest(".bs-head")), meta: meta && meta.textContent.replace(/\s+/g, " ").trim(), sep, lead: !!(meta && meta.textContent.replace(e.textContent, "").trim()), icon: !!e.querySelector("svg"), h: r.height, fs: parseFloat(cs.fontSize) };
});
async function search(page, q) {
  await page.waitForFunction(() => document.getElementById("pn-search") && !document.querySelector(".leaflet-popup:has(.bs)"), null, { timeout: 8000 }).catch(() => {});
  await wait(page, 300);
  await page.locator("#pn-search").click(); await wait(page, 350);
  await page.waitForSelector("#bs-q", { timeout: 8000 }).catch(() => {});
  await page.fill("#bs-q", q); await wait(page, 700);
  return page.evaluate(() => ({ heads: [...document.querySelectorAll("#bs-list .bs-h")].map((x) => x.textContent),
    rows: [...document.querySelectorAll("#bs-list .bs-hit")].map((b) => ({ t: b.querySelector(".bs-t").textContent, s: (b.querySelector(".bs-s") || {}).textContent || "" })) }));
}
const shot = (page, n) => SHOTS && page.screenshot({ path: SHOTS + "/" + PFX + "-" + n + ".png" });

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    if (SHOTS) {   // pictures only (before = run against the old code)
      fs.mkdirSync(SHOTS, { recursive: true });
      const { ctx, page } = await open(browser, { geo: { latitude: 60.1530, longitude: 15.1925 } });   // about 320 m from La Parma (town centre)
      await card(page); await shot(page, "1-bar-card");
      await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} }); await wait(page, 300);
      await search(page, ""); await shot(page, "2-sok-empty");
      await page.fill("#bs-q", "pitch"); await wait(page, 700); await shot(page, "3-sok-pitch");
      await ctx.close(); await browser.close(); console.log("shots done"); process.exit(0);
    }
    // 1. the bar card: estimate in the meta line, no network call
    let { ctx, page, errs, dir } = await open(browser);
    ok("WALKTIME loaded and hooked into PNDS.barSheet", await page.evaluate(() => !!(window.WALKTIME && PNDS.barSheet._wt)));
    ok("the card opens from the real marker", (await card(page)) === "marker");
    let w = await wt(page);
    ok("bar card: 'ca 9 min promenad' in the header meta line, with the walk icon", w.shown && w.txt === "ca 9 min promenad" && w.inMeta && w.icon && w.src === "est", w);
    ok("bar card: the meta line ends '… · ca 9 min promenad' (own CSS · separator only after other text, one line high)", /ca 9 min promenad$/.test(w.meta || "") && w.sep === (w.lead ? '"·"' : "none") && w.h < 2.2 * w.fs, w);
    // the card follows a new exact fix (5 s tick while a card is open)
    await ctx.setGeolocation({ latitude: 60.1525, longitude: 15.1905, accuracy: 15 });
    await page.evaluate(() => new Promise((res) => navigator.geolocation.getCurrentPosition(res, res, { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 })));
    await wait(page, 5600);
    const w2 = await wt(page);
    ok("the open card follows a new fix (walked closer: fewer minutes)", w2.shown && /^ca [1-4] min promenad$/.test(w2.txt), w2);
    // 2. Sök › Krogar
    await ctx.setGeolocation(ME);
    await page.evaluate(() => new Promise((res) => navigator.geolocation.getCurrentPosition(res, res, { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 })));
    await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} }); await wait(page, 300);
    let s = await search(page, "");
    const hi = s.heads.indexOf("Inom 10 min promenad");
    ok("Sök, empty field: a list 'Inom 10 min promenad' with 'ca N min' rows (max 5, nearest first)", hi >= 0 && s.rows.length >= 1 && s.rows.length <= 5 + 6 &&
      s.rows.every((r) => /ca \d+ min$/.test(r.s) || !/min/.test(r.s)), s);
    const mins = s.rows.map((r) => +((r.s.match(/ca (\d+) min$/) || [])[1])).filter((n) => n > 0);
    ok("Sök near list: every time <= 10 min and sorted", mins.length >= 1 && mins.every((n, i) => n <= 10 && (!i || n >= mins[i - 1])), mins);
    await page.fill("#bs-q", "parma"); await wait(page, 700);
    s = await page.evaluate(() => [...document.querySelectorAll("#bs-list .bs-hit")].map((b) => (b.querySelector(".bs-s") || {}).textContent || ""));
    ok("Sök row: town · distance · ca 9 min", /Ludvika/.test(s[0]) && /· \d+ m · ca 9 min/.test(s[0]), s);
    await shot(page, "sok");
    ok("estimate path: no Mapbox Directions call at all", dir.length === 0, dir);
    ok("no page errors (estimate path)", errs.length === 0, errs);
    await ctx.close();

    // 3. a rough fix (> 100 m) and no position: no walking time anywhere
    ({ ctx, page } = await open(browser, { geo: { accuracy: 600 } }));
    await card(page); w = await wt(page);
    ok("rough fix (600 m): no walking time on the card", !w.el || !w.shown, w);
    await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} });
    s = await search(page, "");
    ok("rough fix: no 'Inom 10 min promenad' list", s.heads.indexOf("Inom 10 min promenad") < 0, s);
    await ctx.close();
    ({ ctx, page } = await open(browser, { geo: null }));
    await card(page); w = await wt(page);
    ok("no location permission: no walking time on the card", !w.el || !w.shown, w);
    await ctx.close();

    // 4. route option ON (owner flag), Mapbox Directions mocked
    let logs;
    ({ ctx, page, errs, dir, logs } = await open(browser));
    let seen = [];
    await page.route(/api\.mapbox\.com\/directions\/v5\//, (r) => {
      const u = r.request().url(); seen.push(u.replace(/access_token=[^&]+/, "access_token=***"));
      if (/;15\.18000,60\.15000/.test(u)) return r.fulfill({ status: 500, body: "{}" });
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routes: [{ duration: 720 }], code: "Ok" }) });
    });
    await page.evaluate((t) => { OLNU_CONFIG.walkRoute = "mapbox"; OLNU_CONFIG.MAPBOX_TOKEN = t; }, FAKE);
    await card(page); await wait(page, 600); w = await wt(page);
    ok("route ON: the card shows the route time 'ca 12 min promenad' (720 s)", w.shown && w.txt === "ca 12 min promenad" && w.src === "route", w);
    ok("route ON: the call sends a 150 m cell centre, never the GPS point", seen.length === 1 && !/15\.19600,60\.15450/.test(seen[0]) && /walking\/15\.\d{5},60\.\d{5};15\.18797,60\.15124/.test(seen[0]), seen);
    await card(page); await wait(page, 400);
    ok("route ON: cached per bar per session (2nd open = no new call)", seen.length === 1, seen);
    await card(page, { id: "wt-fail", lat: 60.15, lng: 15.18 }); await wait(page, 800); w = await wt(page);
    ok("route ON: an API error (500) keeps the estimate on the card", seen.length === 2 && w.shown && w.src === "est" && /^ca \d+ min promenad$/.test(w.txt), { seen, w });
    await page.evaluate(() => { WALKTIME._reset(); Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    await card(page, { id: "wt-hidden" }); await wait(page, 600);
    ok("route ON: no call while the page is hidden", seen.length === 2, seen);
    ok("the token never shows in the console or the page text", !logs.some((l) => l.includes(FAKE)) && !(await page.evaluate((t) => document.body.innerText.includes(t), FAKE)), logs.filter((l) => l.includes("pk.")));
    ok("no page errors (route path)", errs.length === 0, errs);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); }
  await browser.close();
  console.log(`\nwalktime: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
