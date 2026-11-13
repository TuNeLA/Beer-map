// lane tickerfix (13 Nov, finalcheck on the release candidate f5d22f3). Each check FAILS on the old code and PASSES on the new.
//  H  1 "N ute – gå med i ett gäng för att se namn": my own beer does not count; only while OTHERS are out and I am in NO gang;
//       at most once per ticker loop (the belt and the "Ingen data här" toast, pnds.js)
//  Y  2 lines about the user with the fallback name "Du": no "Du har fått sina nya streck" / "Kalla inte Du vid förnamn" / "Namn: Du."
//  B  3 no blank ticker item ("/// /// ///"): blank lines are dropped, never two separators in a row
//  E  4 the header says "1 ute" → no empty-town line ("Inga prickar i Ludvika än") stays or comes on the belt
//  T  4 (coordinator, CI 08:40) no "empty map" line of ANY kind (morning "☕ God morgon! Kartan är tom …", day, night, filler)
//       while the header says N > 0: the clock is mocked (build ctx.now) to 08:40, 13:00, 21:30 and 02:30 Stockholm
// Mocked Supabase (ds-helpers). usage: node tickerfix-pw.js <port> [only-regex]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8793, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = new RegExp(process.argv[3] || ".");
const { wait, GID } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { c = !!c; console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 600))); c ? pass++ : fail++; };
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const shot = (page, name) => page.screenshot({ path: SP + "logs/tickerfix-" + name + ".png" }).catch(() => {});
const HINT = /gå med i ett gäng för att se namn/;
const EMPTY = /Ingen ute|Inga prickar|Tomt på kartan|Int' en själ|Inte en själ|Lugnt läge|kartan (är|ä) tom|tom karta|Tomt i [A-ZÅÄÖ{]|Ingen på kartan|Ingen fackla|Ingen har tryckt/i;
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pid = 5000;
const pin = (lat, lng, o = {}) => ({ id: pid++, lat, lng, beer_count: o.n || 2, precise: true, created_at: iso(30), is_mine: !!o.mine, friend_name: o.f || null,
  skal_count: 0, i_skaled: false, shot_count: 0 });
const ME = () => pin(60.14997, 15.18679, { mine: 1, n: 1 });
const STRANGERS = () => [pin(60.15124, 15.18797), pin(60.15098, 15.18663, { n: 3 })];

// One phone. world.beers = what live_beers answers, world.gang = in a group or not.
async function phone(browser, world, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, { checkin: false, reduced: !!o.reduced });
  await page.route(/rest\/v1\/rpc\/(live_beers|live_others|live_checkins|my_groups|gang_poll|home_status|poll_v2|zone_counts)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    if (fn === "live_beers") return J(r, world.beers);
    // the header's zone pill (zones.js): Ludvika = everyone out in this world (the server counts my own beer too)
    if (fn === "zone_counts") return J(r, { kommun: [{ c: "2085", n: world.beers.length }], lan: [{ c: "20", n: world.beers.length, top: "2085" }], total: world.beers.length, k: 1, at: new Date().toISOString() });
    if (fn === "my_groups") return J(r, world.gang ? [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 4, active_count: 0 }] : []);
    if (fn === "gang_poll") return J(r, { v: 1, groups: world.gang ? [{ id: GID, name: "Ludvika Lager" }] : [] });
    return J(r, []);
  });
  await page.addInitScript(() => {
    window.__tk = []; window.__toasts = [];
    const watch = () => {
      const tr = document.getElementById("ticker-track"), ts = document.getElementById("toasts");
      if (!tr || !ts) return setTimeout(watch, 50);
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList.contains("tk-item")) window.__tk.push({ t: n.textContent, c: n.className, at: Date.now() });
        if (n.nodeType === 1 && n.classList.contains("tk-sep")) window.__tk.push({ sep: 1, at: Date.now() });
      }))).observe(tr, { childList: true });
      new MutationObserver(() => { const t = ts.textContent || ""; if (t && window.__toasts[window.__toasts.length - 1] !== t) window.__toasts.push(t); }).observe(ts, { childList: true, subtree: true, characterData: true });
    };
    watch();
  });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__map && window.PN && document.querySelector("#ticker-track .tk-item"), null, { timeout: 30000 }).catch(() => console.log("no ticker"));
  await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 15, { animate: false }));
  await wait(page, 4000);
  return { ctx, page };
}
// a sheet that opens by itself (no gang: "Vem går du ut med?") pauses the belt and the toasts: close it
async function noSheet(page) {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => { const s = document.getElementById("sheet"); if (!s || s.hidden) return false; const x = document.getElementById("sheet-close"); if (x) x.click(); return true; });
    if (!open) return; await wait(page, 700);
  }
}
// run the belt fast for ms and return the items it appended in that time
async function belt(page, ms, f) {
  await noSheet(page);
  const t0 = await page.evaluate((f) => { window.PN_TICK_F = f; window.dispatchEvent(new Event("pn:tickf")); return Date.now(); }, f || 25);
  for (let t = 0; t < ms; t += 1000) {   // a sheet that opens late pauses the belt (and the controller eases the speed back): close it, speed up again
    await wait(page, Math.min(1000, ms - t)); await noSheet(page);
    await page.evaluate((f) => { if (window.PN_TICK_F !== f) { window.PN_TICK_F = f; window.dispatchEvent(new Event("pn:tickf")); } }, f || 25);
  }
  return page.evaluate((t0) => { window.PN_TICK_F = 1; window.dispatchEvent(new Event("pn:tickf")); return window.__tk.filter((x) => x.at >= t0 && !x.sep).map((x) => x.t); }, t0);
}
const hdr = (page) => page.evaluate(() => { const e = document.getElementById("live-count"); return { out: e.getAttribute("data-out"), txt: e.textContent }; });
// the "Ingen data här" toast check (pnds.js): a map move to a new area at zoom >= 13
async function moveToast(page) {
  await noSheet(page);
  await page.evaluate(() => { window.__toasts = []; window.__map.setView([60.1530, 15.1950], 15, { animate: false }); });
  await wait(page, 3200);
  return page.evaluate(() => window.__toasts.slice());
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* ================= H: the names hint ================= */
    if (ONLY.test("H")) {
      // H1: only I am out, no gang → the header says "1 ute", but nobody ELSE is out: no hint
      {
        const world = { beers: [ME()], gang: false };
        const { ctx, page } = await phone(browser, world);
        const h = await hdr(page);
        ok("H precondition: only my beer → the header says 1 ute (data-out 1)", h.out === "1", h);
        const got = await belt(page, 5000);
        ok("H 1 only I am out → the ticker never says 'gå med i ett gäng för att se namn'", got.length > 4 && !got.some((t) => HINT.test(t)), got.filter((t) => HINT.test(t)).concat(["n=" + got.length]));
        const qi = await page.evaluate(() => { window.NEWS.build = () => []; (window.PN.s.newsDirty = true, window.PN.s.tickerKey = "", window.PN.renderTicker()); return 1; });
        const got2 = await belt(page, 3000);
        ok("H 1 only I am out, no headlines (filler) → still no hint", qi && got2.length > 3 && !got2.some((t) => HINT.test(t)), got2.slice(0, 6));
        const ts = await moveToast(page);
        ok("H 1 only I am out → no '1 ute – gå med i ett gäng' toast on a map move", !ts.some((t) => HINT.test(t)), ts);
        await shot(page, "H1-only-me");
        await ctx.close();
      }
      // H2: me + 2 strangers, no gang → hint with the OTHERS' number (2, not 3), at most once per loop
      {
        const world = { beers: [ME()].concat(STRANGERS()), gang: false };
        const { ctx, page } = await phone(browser, world);
        const h = await hdr(page);
        ok("H precondition: me + 2 others → the header says 3 ute", h.out === "3", h);
        const got = await belt(page, 6000);
        const hints = got.filter((t) => HINT.test(t));
        ok("H 1 others out, no gang → the hint shows, with the others' number: '2 ute – gå med …'", hints.length >= 1 && hints.every((t) => /^2 ute – /.test(t)), hints.concat(["n=" + got.length]));
        const gaps = (list) => { const ix = []; list.forEach((t, i) => { if (HINT.test(t)) ix.push(i); }); return ix.slice(1).map((v, i) => v - ix[i]); };
        ok("H 1 the real belt: at least 6 other lines between two hints", gaps(got).every((g) => g >= 7), { gaps: gaps(got), got: got.slice(0, 14) });
        // a short loop (the hint + 2 lines) and an empty build (only the filler): the hint still at most once per 7 lines
        await page.evaluate(() => { window.NEWS.build = () => [{ text: "2 ute – gå med i ett gäng för att se namn", cls: "", k: "townNames" }, { text: "📺 Rad A", cls: "" }, { text: "📺 Rad B", cls: "" }]; (window.PN.s.newsDirty = true, window.PN.s.tickerKey = "", window.PN.renderTicker()); });
        const s1 = await belt(page, 4000);
        ok("H 1 a 3-line loop → the hint is not in every loop (≥ 6 lines between two)", s1.length >= 8 && gaps(s1).every((g) => g >= 7), { gaps: gaps(s1), s1: s1.slice(0, 12) });
        await page.evaluate(() => { window.NEWS.build = () => []; (window.PN.s.newsDirty = true, window.PN.s.tickerKey = "", window.PN.renderTicker()); });
        const s2 = await belt(page, 4000);
        ok("H 1 no headlines (filler only) → the hint at most once per 7 lines, the rest 'N ute'", s2.length >= 8 && gaps(s2).every((g) => g >= 7) && s2.filter((t) => HINT.test(t)).length <= Math.ceil(s2.length / 7), { gaps: gaps(s2), s2: s2.slice(0, 12) });
        const ts = await moveToast(page);
        ok("H 1 others out, no gang → the map-move toast says '2 ute – gå med …' (others, not me)", ts.some((t) => /2 ute – gå med i ett gäng/.test(t)) && !ts.some((t) => /3 ute – gå med/.test(t)), ts);
        await shot(page, "H2-others");
        await ctx.close();
      }
      // H3: me + 2 strangers, I AM in a gang → no hint anywhere
      {
        const world = { beers: [ME()].concat(STRANGERS()), gang: true };
        const { ctx, page } = await phone(browser, world);
        await page.waitForFunction(() => window.GANG && window.GANG.data && window.GANG.data(), null, { timeout: 15000 }).catch(() => {});
        const g = await page.evaluate(() => { const d = window.GANG && window.GANG.data && window.GANG.data(); return d ? d.groups.length : null; });
        ok("H precondition: gang_poll knows my gang", g === 1, g);
        await page.evaluate(() => { (window.PN.s.newsDirty = true, window.PN.s.tickerKey = "", window.PN.renderTicker()); });
        const got = await belt(page, 5000);
        ok("H 1 in a gang → the ticker never says 'gå med i ett gäng'", got.length > 4 && !got.some((t) => HINT.test(t)), got.filter((t) => HINT.test(t)));
        await page.evaluate(() => { window.NEWS.build = () => []; (window.PN.s.newsDirty = true, window.PN.s.tickerKey = "", window.PN.renderTicker()); });
        const got2 = await belt(page, 3000);
        ok("H 1 in a gang, filler only → no hint", got2.length > 3 && !got2.some((t) => HINT.test(t)), got2.slice(0, 6));
        const ts = await moveToast(page);
        ok("H 1 in a gang → no 'gå med i ett gäng' toast on a map move", !ts.some((t) => HINT.test(t)), ts);
        await ctx.close();
      }
    }

    /* ================= Y: "Du" lines ================= */
    if (ONLY.test("Y")) {
      const world = { beers: [ME()].concat(STRANGERS()), gang: true };
      const { ctx, page } = await phone(browser, world);
      const r = await page.evaluate(() => {
        const now = new Date(), all = [];
        // a promotion tonight for the user without a name (fallback "Du"): Menig → Korpral Kanin
        localStorage.setItem("olnu.newsRanks", JSON.stringify({ night: window.NEWS.nightKey(now), t: { Du: "Menig" }, fresh: {} }));
        const me = window.PN.s.beers.filter((b) => b.is_mine);
        for (let i = 0; i < 80; i++) {
          const items = window.NEWS.build(me, { center: { lat: 60.1505, lng: 15.1872 }, now, prev: [], titles: null, liveTotal: 3, hdrOut: 3, namesHint: 0, others: [], checkins: [], home: [], rallies: [], myName: null, myTitle: "Korpral Kanin", myMedals: [] });
          items.forEach((x) => { if (/(^|[^A-Za-zÅÄÖåäö])Du(?![A-Za-zÅÄÖåäö])/.test(x.text)) all.push(x.text); });
        }
        return [...new Set(all)];
      });
      const bad = /sina |sitt |\bsin |Kalla inte Du|Kalla int' Du|Namn: Du|Grattis Du|hälsar .*Du\b|[a-zåäö] Du\b|Du[.,!]/;
      ok("Y 2 the user's own news lines exist (promotion 'Korpral Kanin' tonight)", r.some((t) => /Korpral Kanin/.test(t)), r.slice(0, 5));
      ok("Y 2 no 3rd-person 'Du' line (sina / Kalla inte Du / Namn: Du / Grattis Du …)", r.length > 0 && !r.some((t) => bad.test(t)), r.filter((t) => bad.test(t)).slice(0, 6));
      ok("Y 2 every 'Du' opens a sentence and a verb follows", r.every((t) => { const re = /(^|[^A-Za-zÅÄÖåäö])Du(?![A-Za-zÅÄÖåäö])/g; let m; while ((m = re.exec(t))) { const b = t.slice(0, m.index + m[1].length), a = t.slice(m.index + m[0].length); if (!(/^[^A-Za-zÅÄÖåäö0-9]*$/.test(b) || /[.!?:]\s+[^A-Za-zÅÄÖåäö0-9]*$/.test(b)) || !/^ [a-zåäö]/.test(a)) return false; } return true; }), r.slice(0, 8));
      const streck = await page.evaluate(() => {   // the template "{name} har fått sina nya streck" with "Du" → 2nd person
        const T = (window.NEWS_GT || []).filter((x) => x.k === "groupNewRank"), out = [];
        localStorage.setItem("olnu.newsRanks", JSON.stringify({ night: window.NEWS.nightKey(new Date()), t: { Du: "Menig" }, fresh: {} }));
        const keep = window.NEWS_GT; window.NEWS_GT = T.filter((x) => /sina nya streck/.test(String(x.f({ name: "Du", title: "X" }))));
        try {
          for (let i = 0; i < 3; i++) window.NEWS.build([], { center: { lat: 60.1505, lng: 15.1872 }, now: new Date(), prev: [], titles: null, liveTotal: 0, hdrOut: 0, others: [], checkins: [], home: [], rallies: [], myName: null, myTitle: "Korpral Kanin", myMedals: [] })
            .forEach((x) => { if (/streck/.test(x.text)) out.push(x.text); });
        } finally { window.NEWS_GT = keep; }
        return { n: window.NEWS_GT.length, out };
      });
      ok("Y 2 'Du har fått dina nya streck' (2nd person), not 'sina'", streck.out.length > 0 && streck.out.every((t) => /Du har fått dina nya streck/.test(t)), streck);
      await ctx.close();
    }

    /* ================= B: blank items ================= */
    if (ONLY.test("B")) {
      const world = { beers: [ME()].concat(STRANGERS()), gang: true };
      const { ctx, page } = await phone(browser, world);
      await page.evaluate(() => { window.NEWS.build = () => [{ text: "📺 Rad Ett", cls: "" }, { text: "   ", cls: "" }, { text: "", cls: "" }, { text: "​", cls: "" }, { text: "📺 Rad Två", cls: "" }, { text: " \n ", cls: "tk-real" }]; (window.PN.s.newsDirty = true, window.PN.s.tickerKey = "", window.PN.renderTicker()); });
      const got = await belt(page, 4000);
      ok("B 3 the belt never shows a blank item (blank / whitespace / zero-width lines dropped)", got.length > 4 && got.every((t) => String(t).replace(/[\s​-‍﻿]+/g, "") !== ""), got.slice(0, 10).map((t) => JSON.stringify(t)));
      // freshBelt cuts the off-screen end of the belt; it can leave a "///" last. The next piece must not add a 2nd one.
      const cut = await page.evaluate(() => {
        const tr = document.getElementById("ticker-track"), k = [...tr.children]; let i = k.findIndex((x, j) => j > 0 && x.classList.contains("tk-sep"));
        if (i < 0) return -1; for (let j = k.length - 1; j > i; j--) tr.removeChild(k[j]); return tr.lastElementChild.className;
      });
      await wait(page, 1200);
      const dbl = await page.evaluate(() => { const k = [...document.getElementById("ticker-track").children]; let n = 0; for (let i = 1; i < k.length; i++) if (k[i].classList.contains("tk-sep") && k[i - 1].classList.contains("tk-sep")) n++; return { n, kids: k.length, txt: k.slice(0, 8).map((x) => x.textContent.slice(0, 16)) }; });
      ok("B 3 a belt that ends with '///' gets no 2nd '///' (no '/// ///')", cut === "tk-sep" && dbl.kids > 3 && dbl.n === 0, { cut, dbl });
      await shot(page, "B-belt");
      await ctx.close();
    }

    /* ================= E: header N > 0 → no empty-town line ================= */
    if (ONLY.test("E")) {
      const world = { beers: [], gang: true };
      const { ctx, page } = await phone(browser, world);
      await page.evaluate(() => { try { localStorage.removeItem("olnu.tkQuietAt"); } catch (e) {} window.PN.s.newsDirty = true; window.PN.s.tickerKey = ""; window.PN.renderTicker(); });   // tickerfix2: fresh quiet cap for E (I-71: one quiet line per 30 min)
      await wait(page, 1500);
      const h0 = await hdr(page);
      const pre = await page.evaluate((re) => [...document.querySelectorAll("#ticker-track .tk-item")].map((e) => e.textContent).filter((t) => new RegExp(re, "i").test(t)), EMPTY.source);
      ok("E precondition: empty town → the header says 0 and the belt has an empty-town line", h0.out === "0" && pre.length > 0, { h0, pre });
      // I tap ÖL!: my pin comes, the header says "1 ute" (the same update the app makes after a beer)
      world.beers = [ME()];
      const h1 = await page.evaluate(() => {
        const b = { id: 9999, lat: 60.14997, lng: 15.18679, beer_count: 1, other_count: 0, other_kind: null, precise: true, is_mine: true, friend_name: null, skal_count: 0, i_skaled: false, created_at: new Date().toISOString() };
        // the next zone_counts answer counts my beer: Ludvika 1 (the zone pill = the header's number)
        const c = window.ZONES && window.ZONES._counts && window.ZONES._counts();
        if (c && c.kk && c.kk["2085"]) { c.kk["2085"].n = 1; c.kk["2085"].some = true; c.ll["20"].n = 1; c.total = 1; c.some = true; }
        window.PN.s.beers = [b]; window.PN.updateCounts();
        return 1;
      }).then(() => page.waitForFunction(() => document.getElementById("live-count").getAttribute("data-out") === "1", null, { timeout: 8000 }).catch(() => {}))
        .then(() => page.evaluate(() => { window.__tkSwitch = Date.now(); const e = document.getElementById("live-count"); return { out: e.getAttribute("data-out"), txt: e.textContent }; }));
      ok("E precondition: after my beer the header says 1 ute", h1.out === "1", h1);
      await wait(page, 1500);
      const after = await page.evaluate((re) => {
        const R = new RegExp(re, "i"), vp = document.querySelector("#ticker-track").parentNode.getBoundingClientRect();
        const vis = [...document.querySelectorAll("#ticker-track .tk-item")].filter((e) => { const r = e.getBoundingClientRect(); return r.right > vp.left && r.left < vp.right && !e.classList.contains("tk-stale") && getComputedStyle(e).opacity !== "0"; }).map((e) => e.textContent);
        return { vis: vis.filter((t) => R.test(t)), all: vis };
      }, EMPTY.source);
      ok("E 4 header '1 ute' → no empty-town line stays on screen (1.5 s)", after.vis.length === 0, after);
      const t1 = await page.evaluate(() => window.__tkSwitch);
      const got = await belt(page, 5000);
      const newer = await page.evaluate((t1) => window.__tk.filter((x) => x.at >= t1 && !x.sep).map((x) => x.t), t1);
      ok("E 4 header '1 ute' → no new empty-town line comes on the belt", newer.length > 4 && !newer.some((t) => EMPTY.test(t)), newer.filter((t) => EMPTY.test(t)).concat(["n=" + newer.length]));
      // a time-of-day line that says the map is empty (the morning line CI met at 08:40) is never put on the belt now
      await page.evaluate(() => { window.NEWS.build = () => [{ text: "☕ God morgon! Kartan är tom och kaffet är varmt. Precis som det ska vara.", cls: " tk-x", k: "tMorning" }, { text: "📺 Rad A", cls: "" }, { text: "📺 Rad B", cls: "" }]; (window.PN.s.newsDirty = true, window.PN.s.tickerKey = "", window.PN.renderTicker()); });
      const mo = await belt(page, 3000);
      ok("E 4 header '1 ute' → the morning line 'Kartan är tom' never comes on the belt", mo.length > 4 && !mo.some((t) => /Kartan är tom/.test(t)), mo.slice(0, 8));
      await shot(page, "E-header-1");
      await ctx.close();
    }
    /* ================= T: time of day, the header says 7 ute ================= */
    if (ONLY.test("T")) {
      const world = { beers: [], gang: true };
      const { ctx, page } = await phone(browser, world);
      for (const [lbl, iso] of [["08:40 morning", "2026-11-13T07:40:00Z"], ["13:00 day", "2026-11-13T12:00:00Z"], ["21:30 evening", "2026-11-13T20:30:00Z"], ["02:30 night", "2026-11-14T01:30:00Z"]]) {
        const r = await page.evaluate(([iso, re]) => {
          const R = new RegExp(re, "i"), now = new Date(iso), all = [], c0 = { lat: 60.1505, lng: 15.1872 };
          for (let i = 0; i < 40; i++) window.NEWS.build([], { center: c0, now, prev: [], titles: null, liveTotal: 7, hdrOut: 7, others: [], checkins: [], home: [], rallies: [], myName: "Anton", myTitle: null, myMedals: [] }).forEach((x) => all.push(x.text));
          try { localStorage.removeItem("olnu.tkQuietAt"); } catch (e) {}   // tickerfix2: the 30 min quiet cap (I-71) is not part of this sanity check
          const zero = [];   // the same clock with the header at 0: the empty-map lines are still there (the check is not empty by luck)
          for (let i = 0; i < 40; i++) window.NEWS.build([], { center: c0, now, prev: [], titles: null, liveTotal: 0, hdrOut: 0, others: [], checkins: [], home: [], rallies: [], myName: "Anton", myTitle: null, myMedals: [] }).forEach((x) => zero.push(x.text));
          return { bad: [...new Set(all.filter((t) => R.test(t)))], n: all.length, zero: [...new Set(zero.filter((t) => R.test(t)))].length };
        }, [iso, EMPTY.source]);
        ok("T 4 " + lbl + ", header 7 ute → no 'empty map' line in 40 builds (morning 'Kartan är tom', 'Tomt i …', 'Ingen ute' …)", r.n > 40 && r.bad.length === 0, r.bad.slice(0, 5));
        ok("T 4 " + lbl + ", header 0 → the empty-map lines still exist (sanity)", r.zero > 0, r);
      }
      await ctx.close();
    }
  } catch (e) { console.log("ERROR", e && e.stack || e); fail++; }
  await browser.close();
  console.log(`\ntickerfix: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
