// evsearch-pw.js — lane evsearch (13 Nov 2026): the 📅 event sheet.
//   I-73  a search box at the top: a town ("Ludvika", far away from me) → every event there; a name ("Pubquiz") → that event;
//         "Går" from a result (event_go, friends see it); "Inga event för X"; the clear button; 300 ms debounce; English UI.
//   I-74 / I-76  the TV match window: "På plats: <arena>, <town> · <time>" + "Köp biljett" (the Tickster link, new tab, noopener);
//         no ticket button without a real Tickster / Ticketmaster link (then the match page link only).
//   I-75a one row per game: two TV rows of one game (two sources) and a Tickster twin of a match row show once.
// Mocked Supabase (ds-helpers). usage: node evsearch-pw.js <port> [item-regex]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const ONLY = new RegExp(process.argv[3] || ".");
const { wait } = H;
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 600))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const at = (h) => { const t = new Date(Date.now() + h * 3600e3); t.setMinutes(0, 0, 0); return t.toISOString(); };

// The phone is in Ludvika; the list (events_near2) has local rows + TV matches. The search finds rows anywhere.
const T1 = at(26), T2 = at(50), T3 = at(28);
const NEAR = [
  { id: 7001, kind: "sport", sport: "hockey", league: "HockeyAllsvenskan", title: "Mora IK – Västerås IK", home: "Mora IK", away: "Västerås IK", tv: true, source: "tv", starts_at: T1 },
  { id: 7002, kind: "sport", sport: "fotboll", league: "Landskamp", title: "Sverige – Bosnien", home: "Sverige", away: "Bosnien", tv: true, source: "tv", starts_at: T2 },
  // I-75a: the same game twice (swehockey TV + TheSportsDB TV) and a Tickster twin of a local match
  { id: 7101, kind: "sport", sport: "hockey", title: "Leksands IF – Mora IK", home: "Leksands IF", away: "Mora IK", tv: true, source: "tv", starts_at: T3 },
  { id: 7102, kind: "sport", sport: "hockey", title: "Leksand – Mora", home: "Leksand", away: "Mora", tv: true, source: "tv", starts_at: new Date(Date.parse(T3) + 5 * 60e3).toISOString() },
  { id: 7201, kind: "sport", sport: "hockey", title: "Ludvika HF – Borlänge HF", home: "Ludvika HF", away: "Borlänge HF", place: "Hitachi Arena", town: "Ludvika", lat: 60.147, lng: 15.19, km: 0.5, source: "swehockey", starts_at: T1 },
  { id: 7202, kind: "other", title: "Ludvika HF vs Borlänge HF – Barnens dag", place: "Hitachi Arena", town: "Ludvika", lat: 60.147, lng: 15.19, km: 0.5, source: "tickster", url: "https://secure.tickster.com/ludbor1", starts_at: T1 }
];
const FAR = [
  { id: 8001, kind: "quiz", title: "Pubquiz på Pitchers", place: "Pitchers", town: "Ludvika", lat: 60.14997, lng: 15.18679, starts_at: at(30) },
  { id: 8002, kind: "live", title: "Trubadur Kalle", place: "Bishops Arms", town: "Ludvika", lat: 60.151, lng: 15.188, starts_at: at(52) },
  { id: 8003, kind: "quiz", title: "Pubquiz Majorna", place: "Bryggeriet", town: "Göteborg", lat: 57.69, lng: 11.93, starts_at: at(54) },
  { id: 8004, kind: "sport", sport: "hockey", title: "Leksands IF – Mora IK", home: "Leksands IF", away: "Mora IK", place: "Tegera Arena", town: "Leksand", lat: 60.73, lng: 14.99, source: "swehockey", starts_at: T3 },
  { id: 8005, kind: "sport", sport: "hockey", title: "Leksands IF – Mora IK", home: "Leksands IF", away: "Mora IK", tv: true, source: "tv", starts_at: T3 }
];
function search(q) {
  q = String(q || "").toLowerCase();
  if (q.length < 2) return [];
  return FAR.filter((e) => [e.title, e.place, e.town].some((s) => String(s || "").toLowerCase().includes(q)));
}
const VENUE = {
  7001: { v: 1, found: true, id: 6001, arena: "Wibe Arena", town: "Mora", starts_at: T1, lat: 61.0055, lng: 14.5444,
    game_url: "https://stats.swehockey.se/ScheduleAndResults/Schedule/20962", ticket_url: "https://secure.tickster.com/xuwgnz500lwhtbn" },
  7002: { v: 1, found: true, id: 6002, arena: "Strawberry Arena", town: "Solna", starts_at: T2, lat: 59.37, lng: 18.0,
    game_url: "https://stats.example.org/game/1", ticket_url: "https://example.com/biljett-gissning" }
};

async function setup(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, o);
  page.__calls = [];
  page.on("request", (q) => { const m = q.url().match(/rest\/v1\/rpc\/(\w+)/); if (m) { let b = null; try { b = JSON.parse(q.postData() || "null"); } catch (e) {} page.__calls.push({ fn: m[1], body: b, t: Date.now() }); } });
  await page.route(/rest\/v1\/rpc\/(events_near2|events_near3)\b/, (r) => J(r, { v: 1, server_time: new Date().toISOString(), dedupe: 1, events: NEAR }));
  await page.route(/rest\/v1\/rpc\/events_search\b/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} J(r, { v: 1, q: b.p_q, events: search(b.p_q) }); });
  await page.route(/rest\/v1\/rpc\/event_venue\b/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} J(r, VENUE[b.p_id] || { v: 1, found: false }); });
  await page.route(/rest\/v1\/rpc\/event_go\b/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    J(r, { id: b.p_event_id, mine: !!b.p_on, n: b.p_on ? 1 : 0, total: b.p_on ? 1 : 0, who: b.p_on ? [{ name: "Anton", me: true }] : [], remind: true, told: true }); });
  if (o.init) await ctx.addInitScript(o.init);
  await H.boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.waitForFunction(() => window.EVSHEET && EVSHEET._cache().rows.length > 0, null, { timeout: 15000 }).catch(() => console.log("no events"));
  return { ctx, page };
}
const calls = (page, fn) => page.__calls.filter((c) => c.fn === fn);
const typeQ = async (page, q) => {
  const has = await page.$("#sheet-body .evs-q");
  if (!has) return false;
  await page.fill("#sheet-body .evs-q", q);
  return true;
};
const titles = (page) => page.evaluate(() => [...document.querySelectorAll("#sheet-body .evs-list .evs-row .evs-t")].map((x) => x.textContent));

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });

  // ================= 1. search: town (far away), name, Går from a result, empty state, clear, debounce =================
  if (ONLY.test("1")) {
    const { ctx, page } = await setup(browser);
    await page.evaluate(() => window.EVSHEET.open()); await wait(page, 1200);
    const box = await page.evaluate(() => { const i = document.querySelector("#sheet-body .evs-bar .evs-q"); return i ? { ph: i.placeholder, top: i.getBoundingClientRect().top < document.querySelector("#sheet-body .evs-time").getBoundingClientRect().top } : null; });
    ok(!!box && /Sök/.test(box.ph) && box.top, "1a one search box at the top of the event sheet (above Ikväll · Helgen …)", box);
    // debounce: 4 quick key strokes → one request
    if (box) { await page.type("#sheet-body .evs-q", "Ludv", { delay: 40 }); await wait(page, 150); }
    const early = calls(page, "events_search").length;
    await wait(page, 700);
    await typeQ(page, "Ludvika"); await wait(page, 900);
    const sc = calls(page, "events_search");
    ok(early === 0 && sc.length >= 1 && sc.length <= 3 && sc[sc.length - 1].body && sc[sc.length - 1].body.p_q === "Ludvika", "1b debounced (300 ms): no call while typing, then events_search(p_q='Ludvika')", { early, sc: sc.map((c) => c.body) });
    const t1 = await titles(page);
    ok(t1.length === 2 && t1.includes("Pubquiz på Pitchers") && t1.includes("Trubadur Kalle"), "1c search by town: every event in Ludvika (from the server, any distance)", t1);
    const sum = await page.evaluate(() => { const s = document.querySelector("#sheet-body .evs-s-sum"); return s ? s.textContent : ""; });
    ok(/2 träffar för/.test(sum), "1d the result line says '2 träffar för ”Ludvika”'", sum);
    const sub = await page.evaluate(() => { const r = [...document.querySelectorAll("#sheet-body .evs-list .evs-row")].find((x) => /Pubquiz/.test(x.textContent)); return r ? r.querySelector(".evs-sub").textContent : ""; });
    ok(/Pitchers, Ludvika/.test(sub), "1e a result row says the place and the town", sub);
    // 1f Går from a result (friends see it: event_go on the server)
    const gb = await page.$("#sheet-body .evs-list .evs-row[data-evs='8001'] .evs-gar");
    if (gb) await gb.click(); await wait(page, 900);
    const go = calls(page, "event_go");
    const on = await page.evaluate(() => { const b = document.querySelector("#sheet-body .evs-list .evs-row[data-evs='8001'] .evs-gar"); return b ? b.getAttribute("aria-pressed") : null; });
    ok(go.length === 1 && go[0].body.p_event_id === 8001 && go[0].body.p_on === true && on === "true", "1f 'Går' from a search result → event_go(8001, on) and the button is on", { go: go.map((c) => c.body), on });
    // 1g a result opens the detail view (title, where, when)
    const card = await page.$("#sheet-body .evs-list .evs-row[data-evs='8002']");
    if (card) await card.click(); await wait(page, 800);
    const det = await page.evaluate(() => { const d = document.querySelector("#sheet-body .evs-detail"); return d ? d.textContent : ""; });
    ok(/Trubadur Kalle/.test(det) && /Bishops Arms/.test(det) && /Jag går/.test(det), "1g a tap on a result row opens the event window (title, place, when, Jag går)", det.slice(0, 200));
    await page.evaluate(() => { const b = document.querySelector("#sheet-body .evs-back"); if (b) b.click(); }); await wait(page, 500);
    // 1h name search
    await typeQ(page, "Pubquiz"); await wait(page, 900);
    const t2 = await titles(page);
    ok(t2.length === 2 && t2.every((t) => /Pubquiz/.test(t)), "1h search by name: 'Pubquiz' → the Pubquiz events (any town)", t2);
    // 1i dedupe in results: Leksand (arena row + TV row of one game) = one row
    await typeQ(page, "Leksand"); await wait(page, 900);
    const t3 = await titles(page);
    ok(t3.length === 1 && /Leksands IF – Mora IK/.test(t3[0]), "1i a game with an arena row and a TV row shows once in the results", t3);
    // 1j empty state
    await typeQ(page, "Xyzzyby"); await wait(page, 900);
    const none = await page.evaluate(() => { const e = document.querySelector("#sheet-body .evs-s-none"); return e ? e.textContent : ""; });
    ok(/Inga event för .Xyzzyby./.test(none), "1j 'Inga event för ”Xyzzyby”' when nothing matches", none);
    // 1k clear → the normal list comes back
    const x = await page.$("#sheet-body .evs-qx");
    if (x) await x.click(); await wait(page, 600);
    const back = await page.evaluate(() => ({ q: (document.querySelector("#sheet-body .evs-q") || {}).value, seg: !!document.querySelector("#sheet-body .evs-time") && getComputedStyle(document.querySelector("#sheet-body .evs-time")).display !== "none",
      searching: document.getElementById("sheet-body").classList.contains("evs-searching") }));
    ok(!!x && back.q === "" && back.seg && !back.searching, "1k the clear button empties the box and shows the list again", back);
    ok(await page.evaluate(() => { const i = document.querySelector("#sheet-body .evs-q"), r = i && i.getBoundingClientRect(); return !!r && r.height >= 44 && document.documentElement.scrollWidth <= 390; }), "1l the box is >= 44 px high, no side scroll at 390 px");
    await ctx.close();
  }

  // ================= 2. English UI =================
  if (ONLY.test("2")) {
    // The app is Swedish only today (i18n.js SAFE 2026-11-07); the sheet's English texts work when I18N.lang is "en".
    const { ctx, page } = await setup(browser);
    await page.evaluate(() => { try { Object.defineProperty(window.I18N, "lang", { configurable: true, get: () => "en" }); } catch (e) {} });
    await page.evaluate(() => window.EVSHEET.open()); await wait(page, 1000);
    const ph = await page.evaluate(() => { const i = document.querySelector("#sheet-body .evs-q"); return i ? i.placeholder : ""; });
    await typeQ(page, "Nowhere"); await wait(page, 900);
    const none = await page.evaluate(() => { const e = document.querySelector("#sheet-body .evs-s-none"); return e ? e.textContent : ""; });
    ok(/Search/.test(ph) && /No events for .Nowhere./.test(none), "2 English UI: 'Search a town or event' and 'No events for “Nowhere”'", { ph, none });
    await ctx.close();
  }

  // ================= 3. TV match window: På plats + Köp biljett; no guessed ticket link =================
  if (ONLY.test("3")) {
    const { ctx, page } = await setup(browser);
    await page.evaluate(() => window.EVSHEET.open()); await wait(page, 1000);
    await page.evaluate(() => window.EVSHEET.openDetail("7001")); await wait(page, 1200);
    const v = await page.evaluate(() => { const d = document.querySelector("#sheet-body .evs-detail"), a = d && d.querySelector(".evs-d-arena"), k = d && d.querySelector("a.evs-buy");
      return { arena: a ? a.textContent : "", buy: k ? { href: k.getAttribute("href"), target: k.target, rel: k.rel, t: k.textContent } : null,
        order: !!(a && d.querySelector(".evs-d-pubs, .evs-nopub")) && !!(d.querySelector(".evs-d-pubs, .evs-nopub").compareDocumentPosition(a) & 4) }; });
    ok(/På plats: Wibe Arena, Mora · \d\d:\d\d/.test(v.arena) && v.order, "3a TV match window: 'På plats: Wibe Arena, Mora · <time>' under 'Visas på'", v);
    ok(!!v.buy && v.buy.href === "https://secure.tickster.com/xuwgnz500lwhtbn" && v.buy.target === "_blank" && /noopener/.test(v.buy.rel) && /Köp biljett/.test(v.buy.t),
      "3b 'Köp biljett' = the Tickster link, new tab, rel=noopener", v.buy);
    const vc = calls(page, "event_venue");
    ok(vc.length === 1 && vc[0].body.p_id === 7001, "3c one event_venue(7001) call", vc.map((c) => c.body));
    await page.evaluate(() => { const b = document.querySelector("#sheet-body .evs-back"); if (b) b.click(); }); await wait(page, 400);
    await page.evaluate(() => window.EVSHEET.openDetail("7002")); await wait(page, 1200);
    const w = await page.evaluate(() => { const d = document.querySelector("#sheet-body .evs-detail"); return { arena: (d.querySelector(".evs-d-arena") || {}).textContent || "",
      buy: !!d.querySelector("a.evs-buy"), anyEx: [...d.querySelectorAll("a")].some((a) => /example\.com/.test(a.href)), game: (d.querySelector("a.evs-gamelink") || {}).href || "" }; });
    ok(/Strawberry Arena, Solna/.test(w.arena) && !w.buy && !w.anyEx && /stats\.example\.org/.test(w.game), "3d no 'Köp biljett' without a real Tickster / Ticketmaster link (the match page link only)", w);
    await ctx.close();
  }

  // ================= 4. duplicate rows show once (list) =================
  if (ONLY.test("4")) {
    const { ctx, page } = await setup(browser);
    const ids = await page.evaluate(() => EVSHEET._cache().rows.map((e) => e.id));
    ok(ids.filter((i) => i === 7101 || i === 7102).length === 1, "4a two TV rows of one game (Leksands IF – Mora IK / Leksand – Mora) = one row", ids);
    ok(ids.includes(7201) && !ids.includes(7202), "4b the Tickster twin of a match row folds into the match row", ids);
    const tk = await page.evaluate(() => (EVSHEET._cache().rows.filter((e) => e.id === 7201)[0] || {}).ticket_url);
    ok(tk === "https://secure.tickster.com/ludbor1", "4c ... and its shop link becomes the match row's ticket link", tk);
    await page.evaluate(() => { window.EVSHEET.open(); }); await wait(page, 900);
    await page.evaluate(() => window.EVSHEET._setTime("week")); await wait(page, 500);
    const n = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .evs-list .evs-row .evs-t")].filter((x) => /Ludvika HF/.test(x.textContent)).length);
    ok(n === 1, "4d the list shows 'Ludvika HF – Borlänge HF' once", n);
    await ctx.close();
  }

  console.log("SUMMARY evsearch pass=" + pass + " fail=" + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash " + (e && e.stack || e)); process.exit(1); });
