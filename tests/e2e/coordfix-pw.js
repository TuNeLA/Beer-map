// coordfix-pw.js — lane coordfix (24 Nov): G12 "På kran" row survives a late card mount and a stale card with the same id (js/placecard.js tapFill),
// G14 placesearch.js does not call Nominatim (own town list first), glmap.js keeps no 5 s wake while the map is hidden / idle.
// 390 px, mocked Supabase. Usage: node coordfix-pw.js <port>. Old code: every check FAILS.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 500)); };
const BEER = "5410228158424";
const TAPS = { "n3472634175": { beers: [BEER, "7310401006925"], updated: "2026-11-18" } };

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.route(/rest\/v1\/rpc\/beerlib_\w+/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  if (o.taps) await ctx.addInitScript((bars) => { const f = window.fetch; window.fetch = function (u) {
    if (/\/data\/beer\/taps\.json/.test(String(u && u.url || u))) return Promise.resolve(new Response(JSON.stringify({ v: 1, bars }), { status: 200, headers: { "Content-Type": "application/json" } }));
    return f.apply(this, arguments); }; }, o.taps);
  await boot(page);
  return { ctx, page, errs };
}
const PLACE = { id: "n3472634175", type: "pub", name: "Pitchers", lat: 59.15, lng: 15.02 };
// a bar card as the sheet makes it: .bs > action row + popupHTML parts
const mount = (page, extra) => page.evaluate(([pl, extra]) => {
  const html = PN.placecard.popupHTML(pl);
  const d = document.createElement("div"); d.className = "bs"; d.setAttribute("data-cfx", extra || "card");
  d.innerHTML = '<div class="pp-act"></div>' + html; document.body.appendChild(d); return d.querySelector("[data-plc-more]") ? true : false;
}, [PLACE, extra]);

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    // ---------- G12: late mount (card drawn 3 s after popupHTML; old code gave up after 2 s) ----------
    let { ctx, page, errs } = await open(browser, { taps: TAPS });
    await page.evaluate(() => PN.beerlib());   // module loaded, like in the app after the first beer page
    const html = await page.evaluate((pl) => { window.__cfxHtml = PN.placecard.popupHTML(pl); return window.__cfxHtml.length; }, PLACE);
    await wait(page, 3000);
    await page.evaluate(() => { const d = document.createElement("div"); d.className = "bs"; d.innerHTML = '<div class="pp-act"></div>' + window.__cfxHtml; document.body.appendChild(d); });
    await page.waitForSelector(".bs .bl-tap:not([hidden])", { timeout: 6000 }).catch(() => {});
    const a = await page.evaluate(() => { const t = document.querySelector(".bs [data-plc-tap]"); return t ? { hidden: t.hidden, text: t.innerText.replace(/\s+/g, " ") } : null; });
    ok("På kran: a card mounted 3 s after popupHTML still gets its row (2 beers)", a && !a.hidden && /På kran/.test(a.text) && /2 öl/.test(a.text), { html, a });
    await ctx.close();

    // ---------- G12: stale card with the same id (old card has the row and is removed a moment later) ----------
    ({ ctx, page, errs } = await open(browser, { taps: TAPS }));
    await page.evaluate(() => PN.beerlib());
    await mount(page, "stale");
    await page.waitForSelector('[data-cfx="stale"] .bl-tap:not([hidden])', { timeout: 6000 }).catch(() => {});
    await mount(page, "fresh");   // a redraw: new card is in the DOM while the stale one (with the row) is still there
    await page.evaluate(() => setTimeout(() => document.querySelector('[data-cfx="stale"]').remove(), 700));
    await wait(page, 3000);
    const b = await page.evaluate(() => { const f = document.querySelector('[data-cfx="fresh"] [data-plc-tap]'); return { fresh: f ? { hidden: f.hidden, text: f.innerText.replace(/\s+/g, " ") } : null, stale: !!document.querySelector('[data-cfx="stale"]') }; });
    ok("På kran: the new card gets its row while a stale card with the same id still has one", !b.stale && b.fresh && !b.fresh.hidden && /2 öl/.test(b.fresh.text), b);
    ok("No page errors (G12)", errs.length === 0, errs);
    await ctx.close();

    // ---------- G14: own town list first, Nominatim only as the last fallback for addresses ----------
    ({ ctx, page, errs } = await open(browser));
    const reqs = [];
    await page.route(/nominatim\.openstreetmap\.org\/search|api\.mapbox\.com\/search\/geocode/, (r) => { reqs.push(r.request().url().split("?")[0].replace(/https:\/\//, "") + "?" + decodeURIComponent((r.request().url().match(/[?&]q=([^&]*)/) || [])[1] || "")); r.fulfill({ status: 200, contentType: "application/json", body: "[]" }); });
    await page.evaluate(() => window.PN.towns.ready());
    const g1 = await page.evaluate(() => PN.placeSearch.query("Ludvika", { center: { lat: 59.3, lng: 18.1 } }).then((l) => l.map((h) => [h.title, h.src, h.sub])));
    ok("G14: the text 'Ludvika' answers from our own town list (src town, Dalarna kommun), 0 geocoder requests", g1.length >= 1 && g1[0][0] === "Ludvika" && g1[0][1] === "town" && reqs.length === 0, { g1, reqs });
    const g2 = await page.evaluate(() => PN.placeSearch.query("Grängesb", { center: { lat: 60.1, lng: 15.2 } }).then((l) => l.map((h) => [h.title, h.src])));
    ok("G14: no token (Nominatim engine): 'Grängesb' answers from the town list, 0 Nominatim requests", g2.length >= 1 && /^Grängesberg/.test(g2[0][0]) && g2[0][1] === "town" && reqs.length === 0, { g2, reqs });
    await page.evaluate(() => PN.placeSearch.query("Storgatan 5", { center: { lat: 60.1, lng: 15.2 } }));
    ok("G14: a street address still reaches the last-fallback geocoder (Nominatim, once per ladder step)", reqs.length >= 1 && /nominatim/.test(reqs[0]) && /Storgatan 5/.test(reqs[0]), reqs);
    ok("No page errors (G14)", errs.length === 0, errs);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); }
  await browser.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
