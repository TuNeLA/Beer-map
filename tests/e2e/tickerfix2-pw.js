// lane tickerfix2 (owner 13 Nov 16:33). Each check FAILS on f279878 and PASSES on the new code.
//  S  I-70 no "///" separators between ticker items: the .tk-sep piece is an empty spacer (a small gap, no symbol)
//  V  I-72 event lines only near the user's REAL position: a user in Göteborg gets no Ludvika event (events_near mocked to
//          answer a Ludvika event), a user in Ludvika gets it with "Ludvika" in the line, a user with NO position whose map
//          shows Ludvika gets no event line (the map centre is not a position)
//  Q  I-71 an empty map: at most ONE quiet / empty-map line per 30 min per phone (kept over a reload, olnu.tkQuietAt);
//          fun lines fill the belt; after 30 (simulated) min a quiet line is allowed again
//  Y  I-71 the Systembolaget countdown: Fri 16:30 Stockholm yes ("2,5 h"), never on Sunday, never after closing
// Mocked Supabase (ds-helpers). usage: node tickerfix2-pw.js <port> [only-regex]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8793, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = new RegExp(process.argv[3] || ".");
const { wait, GID } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { c = !!c; console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 700))); c ? pass++ : fail++; };
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const shot = (page, name) => page.screenshot({ path: SP + "logs/tickerfix2-" + name + ".png" }).catch(() => {});
// quiet / empty-map wording (the packs' calm / emptyFirst / townQuiet lines and the "Lugnt läge" filler)
const QUIET = /Ingen ute|Inga prickar|Tomt på kartan|Int' en själ|Inte en själ|Lugnt läge|kartan (är|ä) tom|tom karta|Tomt i [A-ZÅÄÖ{]|Ingen på kartan|Ingen fackla|Ingen har tryckt|Lugnt i [A-ZÅÄÖ]|Tyst i [A-ZÅÄÖ]|tumbleweed|Radiotystnad/i;
const LUD = { lat: 60.15, lng: 15.19 }, GBG = { lat: 57.70, lng: 11.97 };
const EVT = "Pubquiz Testlaget";
const isoIn = (m) => new Date(Date.now() + m * 60e3).toISOString();
const EV = () => [{ id: 7701, title: EVT, kind: "quiz", starts_at: isoIn(40), ends_at: isoIn(200), place: "Hallen", bar_id: null,
  lat: LUD.lat, lng: LUD.lng, town: "Ludvika", url: null, source: "user", is_mine: false, pending: false, km: 0.2 }];

async function phone(browser, world, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, { checkin: false });
  if (o.noGeo) await ctx.clearPermissions(); else if (o.geo) await ctx.setGeolocation({ latitude: o.geo.lat, longitude: o.geo.lng });
  await page.route(/rest\/v1\/rpc\/(live_beers|live_others|live_checkins|my_groups|gang_poll|home_status|poll_v2|zone_counts|events_near)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    if (fn === "live_beers") return J(r, world.beers || []);
    if (fn === "events_near") { world.evCalls = (world.evCalls || 0) + 1; return J(r, EV()); }   // the server answers a Ludvika event whatever point it gets
    if (fn === "zone_counts") return J(r, { kommun: [{ c: "2085", n: 0 }], lan: [{ c: "20", n: 0, top: "2085" }], total: 0, k: 1, at: new Date().toISOString() });
    if (fn === "my_groups") return J(r, [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 4, active_count: 0 }]);
    if (fn === "gang_poll") return J(r, { v: 1, groups: [{ id: GID, name: "Ludvika Lager" }] });
    return J(r, []);
  });
  await page.addInitScript(() => {
    window.__tk = [];
    const watch = () => {
      const tr = document.getElementById("ticker-track");
      if (!tr) return setTimeout(watch, 50);
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList.contains("tk-item")) window.__tk.push({ t: n.textContent, c: n.className, at: Date.now() });
      }))).observe(tr, { childList: true });
    };
    watch();
  });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__map && window.PN && window.NEWS && document.querySelector("#ticker-track .tk-item"), null, { timeout: 30000 }).catch(() => console.log("no ticker"));
  await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 14, { animate: false }));
  await wait(page, 3000);
  return { ctx, page };
}
async function noSheet(page) {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => { const s = document.getElementById("sheet"); if (!s || s.hidden) return false; const x = document.getElementById("sheet-close"); if (x) x.click(); return true; });
    if (!open) return; await wait(page, 700);
  }
}
async function belt(page, ms, f) {
  await noSheet(page);
  const t0 = await page.evaluate((f) => { window.PN_TICK_F = f; window.dispatchEvent(new Event("pn:tickf")); return Date.now(); }, f || 25);
  for (let t = 0; t < ms; t += 1000) {
    await wait(page, Math.min(1000, ms - t)); await noSheet(page);
    await page.evaluate((f) => { if (window.PN_TICK_F !== f) { window.PN_TICK_F = f; window.dispatchEvent(new Event("pn:tickf")); } }, f || 25);
  }
  return page.evaluate((t0) => { window.PN_TICK_F = 1; window.dispatchEvent(new Event("pn:tickf")); return window.__tk.filter((x) => x.at >= t0); }, t0);
}
// set the user's position: own pin none, the server "me" without a place, lastLoc = p (null = no real position)
async function placeMe(page, p) {
  await page.evaluate((p) => {
    const s = window.PN.s;
    s.beers = (s.beers || []).filter((b) => !b.is_mine);
    if (s.meState) s.meState = Object.assign({}, s.meState, { lat: null, lng: null });
    s.lastLoc = p ? { lat: p.lat, lng: p.lng } : null;
  }, p);
}
// the event candidates (events.js) + what the REAL belt shows (all modules' event lines: events.js + invite.js evMix)
async function evNews(page, p) {
  await placeMe(page, p);
  await page.evaluate(() => window.EVENTS._load(true, 7));
  await wait(page, 800);
  await placeMe(page, p);
  const r = await page.evaluate(() => {
    const c = window.__map.getCenter(), lp = window.PN.s.lastLoc, center = lp || { lat: c.lat, lng: c.lng };
    let cands = []; try { cands = (window.BARSPLUS.newsCands({ center }) || []).filter((x) => /^ev/.test(x.k)); } catch (e) { cands = [{ err: e.message }]; }
    let rp = null; try { rp = window.EVENTS._realPos ? window.EVENTS._realPos() : "n/a"; } catch (e) {}
    window.__tk = []; window.PN.s.newsDirty = true; window.PN.s.tickerKey = ""; window.PN.renderTicker();
    return { cands: cands.map((x) => x.d || x), rows: (window.EVENTS._cache().rows || []).length, realPos: rp };
  });
  const got = await belt(page, 9000);
  r.n = got.length; r.lines = [...new Set(got.map((x) => x.t).filter((t) => t.indexOf(EVT) >= 0))];
  return r;
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    /* ================= S: no "///" between items (I-70) ================= */
    if (ONLY.test("S")) {
      const { ctx, page } = await phone(browser, { beers: [] });
      const got = await belt(page, 4000);
      const r = await page.evaluate(() => { const tr = document.getElementById("ticker-track"), seps = [...tr.querySelectorAll(".tk-sep")];
        return { txt: tr.textContent.indexOf("///") >= 0, sepTxt: seps.map((e) => e.textContent).filter((x) => x !== ""), seps: seps.length, w: seps.slice(0, 3).map((e) => e.getBoundingClientRect().width) }; });
      ok("S I-70 no '///' text anywhere in the ticker, every .tk-sep is empty", got.length > 3 && !r.txt && r.sepTxt.length === 0, r);
      ok("S I-70 a small visual gap between items stays (the spacer has a width, 8–30 px)", r.seps > 0 && r.w.every((w) => w >= 8 && w <= 30), r);
      await shot(page, "S-belt");
      await ctx.close();
    }
    /* ================= V: event lines only near the REAL position (I-72) ================= */
    if (ONLY.test("V")) {
      const pg = await phone(browser, { beers: [] }, { geo: GBG });
      const g = await evNews(pg.page, GBG);
      ok("V I-72 user in Göteborg, events_near answers a Ludvika event → NO event candidate and NO event line on the belt", g.cands.length === 0 && g.lines.length === 0 && g.rows > 0 && g.n > 6, g);
      await pg.ctx.close();
      const pl = await phone(browser, { beers: [] }, { geo: LUD });
      const l = await evNews(pl.page, LUD);
      ok("V I-72 user in Ludvika → event candidates with {stad} = 'Ludvika' (the event's own town)", l.cands.length > 0 && l.cands.every((d) => d.stad === "Ludvika"), l);
      ok("V I-72 user in Ludvika → the event line shows on the belt", l.lines.length > 0, l);
      const lb = await pl.page.evaluate((t) => { const out = []; for (let i = 0; i < 15; i++) { try { localStorage.removeItem("olnu.tkNight"); } catch (e) {} window.NEWS.build([], { center: window.PN.s.lastLoc, now: new Date(new Date().setHours(20)), prev: [], liveTotal: 0, hdrOut: 0, others: [], checkins: [], home: [], rallies: [] }).forEach((x) => { if (x.k === "evTonight") out.push(x.text); }); } return [...new Set(out)]; }, EVT);
      ok("V I-72 user in Ludvika → an events.js line names 'Ludvika'", lb.some((t) => /Ludvika/.test(t)), lb);
      await pl.ctx.close();
      const w2 = { beers: [] };
      const p2 = await phone(browser, w2, { noGeo: true });
      await p2.page.evaluate(() => window.__map.setView([60.1505, 15.1872], 14, { animate: false }));
      const n = await evNews(p2.page, null);
      ok("V I-72 no real position, the map centre is Ludvika → NO event line", n.cands.length === 0 && n.lines.length === 0 && n.rows > 0, n);
      await p2.ctx.close();
    }
    /* ================= Q: max one quiet line per 30 min (I-71) ================= */
    if (ONLY.test("Q")) {
      const { ctx, page } = await phone(browser, { beers: [] });
      await page.evaluate(() => { try { localStorage.removeItem("olnu.tkQuietAt"); } catch (e) {} window.PN.s.newsDirty = true; window.PN.s.tickerKey = ""; window.PN.renderTicker(); });
      const isQ = (x) => /(^|\s)tk-quiet(\s|$)/.test(x.c) || QUIET.test(x.t);
      const a = await belt(page, 14000);
      const qa = a.filter(isQ).map((x) => x.t);
      ok("Q I-71 empty map, a fast belt (many lines) → at most ONE quiet / empty-map line", a.length >= 12 && qa.length <= 1, { n: a.length, quiet: qa.slice(0, 8) });
      const fun = await page.evaluate(() => (window.NEWS_GT || []).filter((x) => /^fun/.test(x.k)).length);
      ok("Q I-71 at least 40 new fun lines (kinds fun*)", fun >= 40, fun);
      const funTxt = a.filter((x) => !isQ(x)).length;
      ok("Q I-71 the other lines fill the belt (no quiet filler loop)", funTxt >= a.length - 1, { n: a.length, nonQuiet: funTxt });
      // still the same 30 min after a reload: the time is kept per phone (localStorage)
      await page.reload();
      await page.waitForFunction(() => window.NEWS && document.querySelector("#ticker-track .tk-item"), null, { timeout: 30000 }).catch(() => {});
      await wait(page, 2500);
      const b = await belt(page, 8000), qb = b.filter(isQ).map((x) => x.t);
      const boot = await page.evaluate(() => window.__tk.filter((x) => /(^|\s)tk-quiet(\s|$)/.test(x.c)).map((x) => x.t));
      ok("Q I-71 after a reload (same 30 min): still at most ONE quiet line in all (before + after the reload)", b.length >= 6 && qa.length + boot.length <= 1, { qa, qb, boot });
      // 31 simulated minutes later a quiet line is allowed again (one)
      const later = await page.evaluate(() => { const t = Date.now() - 31 * 60e3; localStorage.setItem("olnu.tkQuietAt", String(t)); if (!window.NEWS.quietOk) return { okNow: "n/a" }; const okNow = window.NEWS.quietOk(); window.NEWS.quietMark(); return { okNow, okAfterMark: window.NEWS.quietOk() }; });
      ok("Q I-71 31 min later a quiet line may show again, and the next one waits 30 min", later.okNow === true && later.okAfterMark === false, later);
      await shot(page, "Q-belt");
      await ctx.close();
    }
    /* ================= Y: Systembolaget countdown (I-71) ================= */
    if (ONLY.test("Y")) {
      const { ctx, page } = await phone(browser, { beers: [] });
      const R = await page.evaluate(() => {
        const AV = {}, c0 = { lat: 60.1505, lng: 15.1872 }, run = (iso) => { const now = new Date(iso), out = []; let n = 0;
          for (let i = 0; i < 300; i++) { try { localStorage.removeItem("olnu.tkNight"); } catch (e) {} const o = window.NEWS.build([], { center: c0, now, prev: [], titles: null, liveTotal: 0, hdrOut: 0, others: [], checkins: [], home: [], rallies: [], myName: null, myTitle: null, myMedals: [] }); n += o.length; o.forEach((x) => { if (/Systembolaget/.test(x.text)) out.push(x.text); }); }
          AV[iso] = n / 300; return [...new Set(out)]; };   // tickerfix2b: 300 builds (the mix is random), the exact rule via NEWS._sys
        return { fri: run("2026-11-13T16:30:00+01:00"), sun: run("2026-11-15T16:30:00+01:00"), friLate: run("2026-11-13T19:20:00+01:00"), satLate: run("2026-11-14T15:30:00+01:00"),
          friNoon: run("2026-11-13T12:00:00+01:00"), sat: run("2026-11-14T13:00:00+01:00"), av: AV };
      });
      const sysOf = await page.evaluate(() => ["2026-11-13T16:30:00+01:00", "2026-11-14T13:00:00+01:00", "2026-11-15T16:30:00+01:00", "2026-11-13T19:20:00+01:00", "2026-11-14T15:30:00+01:00", "2026-11-13T12:00:00+01:00"].map((d) => window.NEWS._sys(new Date(d))));
      ok("Y I-71 the countdown rule (Stockholm time): Fri 16:30 '2,5 h', Sat 13:00 '2 h', Sun / Fri 19:20 / Sat 15:30 / Fri 12:00 none", JSON.stringify(sysOf) === JSON.stringify(["2,5 h", "2 h", null, null, null, null]), sysOf);   // tickerfix2b
      ok("Y I-71 an empty-map build is full again: about 6 lines (was ~4: the dropped quiet lines left holes)", R.av["2026-11-13T16:30:00+01:00"] >= 5.5 && R.av["2026-11-14T13:00:00+01:00"] >= 5.5, R.av);   // tickerfix2b
      ok("Y I-71 Fri 16:30 Stockholm → the Systembolaget line shows, '2,5 h'", R.fri.length > 0 && R.fri.every((t) => /2,5 h/.test(t)), R.fri);
      ok("Y I-71 Sat 13:00 (closes 15:00) → shows with '2 h'", R.sat.length > 0 && R.sat.every((t) => /\b2 h\b/.test(t)), R.sat);
      ok("Y I-71 never on Sunday, never after closing (Fri 19:20, Sat 15:30), not more than 3 h before (Fri 12:00)", !R.sun.length && !R.friLate.length && !R.satLate.length && !R.friNoon.length, R);
      await ctx.close();
    }
  } catch (e) { console.log("ERROR", e && e.stack || e); fail++; }
  await browser.close();
  console.log(`\ntickerfix2: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
