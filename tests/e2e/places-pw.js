// places-pw.js — lane places (19 Nov 2026, data-sources.md items 1, 2, 3, 6, 10).
//   E7  town names from our own list (js/towns.js + js/towns-data.js, SCB tätorter CC0): no Nominatim call from the app.
//   E4  "Stämmer öppettiderna?" on the bar sheet (js/hoursvote.js, SQL 0531): yes / no / fix, crowd fixes shown everywhere,
//       closed-place question, PGRST202 = the row is gone.
//   E3  "Sista bussen hem" in Hem-läge (js/lastbus.js + edge function lastbus): consent first, card from the mocked
//       function, rounded points only, no key = no card.
// 390 x 844, mocked Supabase (d2-helpers). Usage: node places-pw.js <port> [e7|e4|e3|shots ...]   (no part = all but shots)
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs");
const PORT = process.argv[2] || 8793;
const PARTS = process.argv.slice(3);
const want = (p) => (PARTS.length ? PARTS.includes(p) : p !== "shots");
const SHOTS = (process.env.PLACES_SHOTS || require("./env.js").OUT + "places-shots").replace(/\/?$/, "/");
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };
const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(body) });
const PITCHERS = "n3472634175";
const HOME_G = { lat: 60.0837, lng: 15.0154, r: 150, ar: 150 };   // a home zone in Grängesberg, 12 km from Pitchers

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { reduced: true });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const net = { nom: 0, rpc: [], fn: [] };
  page.on("request", (q) => {
    const u = q.url();
    if (/nominatim\.openstreetmap\.org/.test(u)) net.nom++;
    const m = u.match(/rest\/v1\/rpc\/(\w+)/); if (m) { let b = {}; try { b = JSON.parse(q.postData() || "{}"); } catch (e) {} net.rpc.push([m[1], b]); }
    if (/functions\/v1\/lastbus/.test(u)) { let b = {}; try { b = JSON.parse(q.postData() || "{}"); } catch (e) {} net.fn.push(b); }
  });
  if (o.home) await ctx.addInitScript((h) => { try { localStorage.setItem("olnu.home", JSON.stringify(Object.assign({ at: Date.now() }, h))); } catch (e) {} }, o.home);
  if (o.routes) await o.routes(page);
  await boot(page);
  return { ctx, page, errs, net };
}
// the real bar sheet (PN.openBarById), open the fold with the hours part
async function barSheet(page) {
  await page.evaluate(() => window.__map.setView([60.14997, 15.18679], 17, { animate: false })); await wait(page, 1800);
  await page.evaluate((id) => window.PN.openBarById(id, 0), PITCHERS);   // the real bar sheet (app-pins.js openBar)
  await wait(page, 1800);
  // barinfo's hours part sits in the "Mer" fold of the bar sheet: open the fold that holds .bi-info
  await page.evaluate(() => { const i = [...document.querySelectorAll(".bi-info")].find((x) => x.closest("details.pp-fold")); const f = i && i.closest("details.pp-fold"); if (f && !f.open) f.querySelector("summary").click(); });
  await wait(page, 600);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll(".bi-info")].find((x) => x.offsetParent); if (!h) return;
    h.scrollIntoView({ block: "start" });
    let p = h.parentElement; while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    if (p) p.scrollTop -= 110;   // the sheet head covers the top: show the "Öppettider" heading too
  });
  await wait(page, 900);
}
const hvInfo = (page) => page.evaluate(() => {
  const all = [...document.querySelectorAll(".hv")], h = all.find((x) => x.offsetParent) || all[0]; if (!h) return null;
  return { n: all.length, text: [...h.children].map((c) => c.textContent).join(" ").replace(/\s+/g, " ").trim(), btns: [...h.querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent, a: b.getAttribute("data-hva"), h: Math.round(r.height), w: Math.round(r.width) }; }) };
});
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll(".toast, #toast, .pn-toast")].filter((t) => t.offsetParent && t.textContent.trim()).map((t) => t.textContent.trim()));
function sthlm(ms) {
  const p = {}; new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute;
}
const BUS = (lastIn, nextIn) => ({ ok: true, src: "Trafiklab", gone: lastIn < 0,
  next: nextIn == null ? null : { dep: sthlm(Date.now() + nextIn * 60e3), line: "Buss 302", stop: "Ludvika resecentrum", walk: 6, arr: "", to: "Grängesberg" },
  last: { dep: sthlm(Date.now() + lastIn * 60e3), line: "Buss 302", stop: "Ludvika resecentrum", walk: 6, arr: "", to: "Grängesberg Centrum" } });
async function hem(page) {
  await page.evaluate(() => { const o = window.BOLD.on; window.BOLD.on = (k) => k === "bold_hemlage" ? true : o.call(window.BOLD, k); window.BOLD_HEM.open({}); });
  await wait(page, 1200);
}
const lbInfo = (page) => page.evaluate(() => { const b = document.querySelector("#bh-ov .lb"); if (!b) return null; const r = b.getBoundingClientRect();
  return { text: b.innerText.replace(/\s+/g, " ").trim(), cls: b.className, go: !!b.querySelector(".lb-go"), goH: b.querySelector(".lb-go") ? Math.round(b.querySelector(".lb-go").getBoundingClientRect().height) : 0, top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) }; });

(async () => {
  const browser = await chromium.launch(require("./env.js").CHROME ? { executablePath: require("./env.js").CHROME } : {});
  try {
    /* ------------------------------ E7 ------------------------------ */
    if (want("e7")) {
      const { ctx, page, errs, net } = await open(browser);
      const lazy0 = await page.evaluate(() => !!(window.PN.townsData));
      const a = await page.evaluate(() => Promise.all([window.PN.towns.area(60.1511, 15.1876), window.PN.towns.area(59.3150, 18.0720), window.PN.towns.area(60.36, 15.47)]));
      ok("E7 PN.towns.area(): Ludvika (Pitchers), Stockholm (Södermalm), '<kommun> kommun' in the forest", a[0] === "Ludvika" && a[1] === "Stockholm" && / kommun$/.test(a[2]), a);
      ok("E7 the town list is a lazy file: not loaded at start, loaded on demand", !lazy0 && (await page.evaluate(() => window.PN.towns.list().length)) >= 1900);
      // the home town picker: search knows every tätort ("Grängesberg västra" is not in the old short list)
      await page.evaluate(() => window.HOMETOWN.open()); await wait(page, 1200);
      await page.fill(".ht-inp", "Grängesberg"); await wait(page, 500);
      const rows = await page.evaluate(() => [...document.querySelectorAll(".ht-list2 .ht-row-n")].map((x) => x.textContent));
      ok("E7 home town search finds every tätort ('Grängesberg västra')", rows.includes("Grängesberg västra") && rows.includes("Grängesberg"), rows);
      ok("E7 no request to Nominatim at all", net.nom === 0, net.nom);
      ok("E7 no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    /* ------------------------------ E4 ------------------------------ */
    if (want("e4")) {
      let { ctx, page, errs, net } = await open(browser);
      await barSheet(page);
      let h = await hvInfo(page);
      // Pitchers has no OpenStreetMap hours (data-sources.md: Ludvika 0 of 1): the row asks for them
      ok("E4 no hours known: 'Vet du öppettiderna?' [Lägg till tider]", !!h && /Vet du öppettiderna\?/.test(h.text) && h.btns.map((b) => b.a).join() === "fix", h);
      // with OpenStreetMap hours (hours.json row for the bar): Ja / Nej / Rätta
      await page.evaluate((id) => { window.OPPET._set({ bars: { [id]: ["", "", "960-1440", "960-1440", "960-1560", "720-1560", ""] } }); window.BARINFO._refresh(id); }, PITCHERS);
      await wait(page, 300);
      h = await hvInfo(page);
      ok("E4 Info fold: 'Stämmer öppettiderna?' with Ja / Nej / Rätta", !!h && /Stämmer öppettiderna\?/.test(h.text) && h.btns.map((b) => b.a).join() === "yes,no,fix", h);
      ok("E4 buttons are 44 px targets", !!h && h.btns.every((b) => b.h >= 44 && b.w >= 44), h && h.btns);
      ok("E4 the state is asked once (bar_hours_state for the bar)", net.rpc.some((x) => x[0] === "bar_hours_state" && x[1].p_bar_id === PITCHERS), net.rpc.map((x) => x[0]).filter((n) => /hours/.test(n)));
      await page.evaluate(() => document.querySelector('.hv [data-hva="yes"]').click()); await wait(page, 900);
      const v = net.rpc.filter((x) => x[0] === "vote_bar_hours");
      h = await hvInfo(page);
      ok("E4 Ja → vote_bar_hours(yes), the row says thanks", v.length === 1 && v[0][1].p_kind === "yes" && v[0][1].p_bar_id === PITCHERS && /Tack för ditt svar/.test(h.text), { v, h });
      const t1 = await toasts(page);
      ok("E4 one text pop-up for the tap", t1.length <= 1, t1);
      // Rätta: the 7-day sheet, Friday 16:00–02:00, the rest closed → week in the hours.json format
      await page.evaluate(() => document.querySelector('.hv [data-hva="fix"]').click()); await wait(page, 1200);
      const days = await page.evaluate(() => document.querySelectorAll("#sheet .hv-day").length);
      ok("E4 Rätta opens the sheet with 7 day rows", days === 7, days);
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll("#sheet .hv-day")];
        rows.forEach((r, i) => { const x = r.querySelector(".hv-x"); const want = i !== 4; if ((x.getAttribute("aria-pressed") === "true") !== want) x.click(); });
        const f = rows[4].querySelectorAll(".hv-tm"); f[0].value = "16:00"; f[1].value = "02:00";
      });
      await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet button")].find((x) => /^Skicka$/.test(x.textContent.trim())); b.click(); }); await wait(page, 1200);
      const fx = net.rpc.filter((x) => x[0] === "vote_bar_hours" && x[1].p_kind === "fix")[0];
      ok("E4 Skicka → vote_bar_hours(fix) with the week ['','','','','960-1560','','']", !!fx && JSON.stringify(fx[1].p_week) === JSON.stringify(["", "", "", "", "960-1560", "", ""]), fx && fx[1]);
      const dd = await page.evaluate(() => [window.PN.hoursvote._day("16", "0200", false), window.PN.hoursvote._day("16.30", "23:00", false), window.PN.hoursvote._day("", "", true), window.PN.hoursvote._day("25:00", "02:00", false)]);
      ok("E4 24 h time text: '16'+'0200' = 960-1560, '16.30'+'23:00' = 990-1380, Stängt = '', 25:00 = invalid", JSON.stringify(dd) === JSON.stringify(["960-1560", "990-1380", "", null]), dd);
      const mine = await page.evaluate((id) => ({ src: window.OPPET.hoursSrc(window.BARS.byId(id)), w: window.OPPET.hoursFor(window.BARS.byId(id)) }), PITCHERS);
      ok("E4 my fix shows at once for me (source 'me')", mine.src && mine.src.src === "me" && mine.w[4] === "960-1560", mine);
      await ctx.close();

      // a crowd fix from the server beats OpenStreetMap everywhere + the closed-place question
      ({ ctx, page, errs, net } = await open(browser, { routes: async (p) => {
        await p.route(/rest\/v1\/rpc\/bar_hours_fixes\b/, (r) => J(r, [{ id: PITCHERS, w: ["", "", "", "960-1440", "960-1500", "960-1500", ""], src: "crowd", at: "2026-11-12T20:00:00Z" }]));
        await p.route(/rest\/v1\/rpc\/bar_hours_state\b/, (r) => J(r, { bar_id: PITCHERS, counts: { yes: 3, no: 0, fix: 2, here: 0 }, last_yes: "2026-11-12T20:00:00Z", mine: null,
          fixed: { w: ["", "", "", "960-1440", "960-1500", "960-1500", ""], src: "crowd", at: "2026-11-12T20:00:00Z", n: 2 }, need: 2, check: true }));
      } }));
      await barSheet(page);
      h = await hvInfo(page);
      const src = await page.evaluate((id) => ({ s: window.OPPET.hoursSrc(window.BARS.byId(id)), w: window.OPPET.hoursFor(window.BARS.byId(id)), line: (document.querySelector(".bi-info .bi-r") || {}).textContent }), PITCHERS);
      ok("E4 a crowd fix (2 guests) is what we show; the line says 'rättat av gäster · 12 nov'", src.s && src.s.src === "crowd" && src.w[5] === "960-1500" && /rättat av gäster · 12 nov/.test(src.line || ""), src);
      ok("E4 'Bekräftat av 3 gäster · senast 12 nov'", !!h && /Bekräftat av 3 gäster · senast 12 nov/.test(h.text), h);
      ok("E4 closed-place signal: 'Finns stället kvar?' [Ja, det finns] [Nej, stängt]", !!h && /Finns stället kvar\?/.test(h.text) && h.btns.some((b) => b.a === "here") && h.btns.some((b) => b.a === "gone"), h);
      if (want("shots") || process.env.PLACES_SHOTS) await page.screenshot({ path: SHOTS + "after-e4-check.png" });
      await page.evaluate(() => document.querySelector('.hv [data-hva="here"]').click()); await wait(page, 900);
      ok("E4 'Ja, det finns' → vote_bar_hours(here)", net.rpc.some((x) => x[0] === "vote_bar_hours" && x[1].p_kind === "here"), net.rpc.filter((x) => x[0] === "vote_bar_hours"));
      ok("E4 no page errors", errs.length === 0, errs);
      await ctx.close();

      // an old server (no 0531): PGRST202 = no row, nothing breaks
      ({ ctx, page, errs, net } = await open(browser, { routes: async (p) => {
        await p.route(/rest\/v1\/rpc\/(bar_hours_state|bar_hours_fixes|vote_bar_hours)\b/, (r) => J(r, { code: "PGRST202", message: "Could not find the function public.bar_hours_state(p_bar_id) in the schema cache", details: null, hint: null }, 404));
      } }));
      await barSheet(page);
      h = await hvInfo(page);
      const info = await page.evaluate(() => !!document.querySelector(".bi-info"));
      ok("E4 PGRST202 (no SQL 0531): the row is gone, the Info fold still shows", h === null && info, { h, info });
      ok("E4 PGRST202: no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    /* ------------------------------ E3 ------------------------------ */
    if (want("e3")) {
      // a home zone 12 km away + the function answers
      let { ctx, page, errs, net } = await open(browser, { home: HOME_G, routes: async (p) => { await p.route(/functions\/v1\/lastbus/, (r) => J(r, BUS(52, 22))); } });
      await hem(page);
      let b = await lbInfo(page);
      ok("E3 first time: the card asks first (rounded home zone, Trafiklab, nothing stored) + 'Visa tider' ≥ 44 px", !!b && /Sista bussen hem/.test(b.text) && /avrundad/.test(b.text) && b.go && b.goH >= 44, b);
      ok("E3 nothing is sent before the yes", net.fn.length === 0, net.fn);
      if (want("shots") || process.env.PLACES_SHOTS) await page.screenshot({ path: SHOTS + "after-e3-ask.png" });
      await page.evaluate(() => document.querySelector("#bh-ov .lb-go").click()); await wait(page, 1200);
      b = await lbInfo(page);
      ok("E3 the card: time of the last bus, 'om 52 min', Buss 302 från Ludvika resecentrum, 6 min walk, Nästa, Trafiklab", !!b && /om 5[12] min/.test(b.text) && /Buss 302 från Ludvika resecentrum/.test(b.text) && /6 min att gå/.test(b.text) && /Nästa: /.test(b.text) && /Trafiklab/.test(b.text), b);
      const sent = net.fn[0] || {};
      const grid = (v) => Math.abs(v / 0.005 - Math.round(v / 0.005)) < 1e-6;
      ok("E3 only rounded points are sent (0.005° grid), never the exact home zone", net.fn.length === 1 && grid(sent.to.lat) && grid(sent.to.lng) && grid(sent.from.lat) && grid(sent.from.lng) && sent.to.lat !== HOME_G.lat, sent);
      ok("E3 no key anywhere in the request", !/trafiklab|accessId|key/i.test(JSON.stringify(sent)), sent);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      ok("E3 390 px: no horizontal scroll", !ov);
      if (want("shots") || process.env.PLACES_SHOTS) { await page.evaluate(() => { const b = document.querySelector("#bh-ov .bh-box"); if (b) b.scrollTop = 99999; }); await wait(page, 300); await page.screenshot({ path: SHOTS + "after-e3-card.png" }); }
      ok("E3 no page errors", errs.length === 0, errs);
      await ctx.close();

      // the last bus has left
      ({ ctx, page, errs, net } = await open(browser, { home: HOME_G, routes: async (p) => {
        await p.addInitScript(() => { try { localStorage.setItem("olnu.lastbusOk", "1"); } catch (e) {} });
        await p.route(/functions\/v1\/lastbus/, (r) => J(r, BUS(-20, null)));
      } }));
      await hem(page); await wait(page, 600);
      b = await lbInfo(page);
      ok("E3 after the last one: 'Sista bussen har gått' (taxi row is above)", !!b && /Sista bussen har gått/.test(b.text), b);
      if (want("shots") || process.env.PLACES_SHOTS) { await page.evaluate(() => { const b = document.querySelector("#bh-ov .bh-box"); if (b) b.scrollTop = 99999; }); await wait(page, 300); await page.screenshot({ path: SHOTS + "after-e3-gone.png" }); }
      await ctx.close();

      // no key on the server = no card (and no new ask for 6 h)
      ({ ctx, page, errs, net } = await open(browser, { home: HOME_G, routes: async (p) => {
        await p.addInitScript(() => { try { localStorage.setItem("olnu.lastbusOk", "1"); } catch (e) {} });
        await p.route(/functions\/v1\/lastbus/, (r) => J(r, { ok: false, code: "no_key" }));
      } }));
      await hem(page); await wait(page, 800);
      b = await lbInfo(page);
      const off = await page.evaluate(() => window.PN.lastbus._state().off);
      ok("E3 no Trafiklab key on the server: the card is hidden and stays off", b === null && off === true, { b, off });
      await page.evaluate(() => window.BOLD_HEM.close()); await wait(page, 500); await hem(page);
      ok("E3 no key: the next open does not ask the function again", net.fn.length === 1, net.fn.length);
      await ctx.close();

      // no home zone = no card; function not deployed (404) = no card
      ({ ctx, page, errs, net } = await open(browser, { routes: async (p) => { await p.route(/functions\/v1\/lastbus/, (r) => J(r, { message: "not found" }, 404)); } }));
      await hem(page);
      ok("E3 no home zone: no card, no call", (await lbInfo(page)) === null && net.fn.length === 0, net.fn);
      await ctx.close();
      ({ ctx, page, errs, net } = await open(browser, { home: HOME_G, routes: async (p) => {
        await p.addInitScript(() => { try { localStorage.setItem("olnu.lastbusOk", "1"); } catch (e) {} });
        await p.route(/functions\/v1\/lastbus/, (r) => J(r, { message: "not found" }, 404));
      } }));
      await hem(page); await wait(page, 800);
      ok("E3 function not deployed (404): no card", (await lbInfo(page)) === null);
      ok("E3 404: no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    /* --------------------- before pictures (same state, the new part switched off) --------------------- */
    if (want("shots")) {
      let { ctx, page } = await open(browser);
      await page.evaluate(() => { delete window.PN.hoursvote; });
      await barSheet(page); await page.screenshot({ path: SHOTS + "before-e4-info.png" });
      await page.evaluate((id) => { window.OPPET._set({ bars: { [id]: ["", "", "960-1440", "960-1440", "960-1560", "720-1560", ""] } }); window.BARINFO._refresh(id); }, PITCHERS);
      await wait(page, 300); await page.screenshot({ path: SHOTS + "before-e4-info-osm.png" });
      await ctx.close();
      ({ ctx, page } = await open(browser));
      await barSheet(page); await page.screenshot({ path: SHOTS + "after-e4-info.png" });
      await page.evaluate((id) => { window.OPPET._set({ bars: { [id]: ["", "", "960-1440", "960-1440", "960-1560", "720-1560", ""] } }); window.BARINFO._refresh(id); }, PITCHERS);
      await wait(page, 300); await page.screenshot({ path: SHOTS + "after-e4-info-osm.png" });
      await page.evaluate(() => [...document.querySelectorAll('.hv [data-hva="fix"]')].find((x) => x.offsetParent).click()); await wait(page, 1200);
      await page.screenshot({ path: SHOTS + "after-e4-fix-sheet.png" });
      await ctx.close();
      ({ ctx, page } = await open(browser, { home: HOME_G }));
      await page.evaluate(() => { delete window.PN.lastbus; });
      await hem(page); await page.evaluate(() => { const b = document.querySelector("#bh-ov .bh-box"); if (b) b.scrollTop = 99999; }); await wait(page, 300);
      await page.screenshot({ path: SHOTS + "before-e3-hem.png" });
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack ? e.stack.slice(0, 600) : e); }
  await browser.close();
  console.log("places: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
