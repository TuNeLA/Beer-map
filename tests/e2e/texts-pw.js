// texts-pw.js — lane texts (24 Nov 2026, owner defaults OWNER-INPUTS B1/A36, B3, I-19). Mocked Supabase, 390 px.
//  B3/B8: a NEW user (fresh phone) starts with area position, "Bara vänner", position log off; an OLD phone keeps its settings.
//  E2/B1: no shipped ticker line praises a count; the empty Min kväll text is a fact; the rank line has no "N öl kvar till".
//  I-19b: the installed app (standalone) of an old phone shows a one-line reinstall note on Notiser.
// Usage: node texts-pw.js <port>   (SHOTS=<dir> also saves the before/after pictures, TAG=before|after)
const { ctxFor, boot, wait, clickJS } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs");
const SH = process.env.SHOTS || "", TAG = process.env.TAG || "after";
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };
const shot = async (page, name) => { if (!SH) return; fs.mkdirSync(SH, { recursive: true }); await page.screenshot({ path: `${SH}/${name}-${TAG}.png` }); console.log("shot", name); };
const BANNED = /nästa öl om|öl kvar till|respekt från redaktionen|kör hårt:|hot streak|fått upp farten|bara att köra|skicka en hyllning|legendrapport|en öl till och|sitta hemma|sitter i soffan\?|tappat räkningen|första ölen\.|väntar på en hjälte|beers? left to|legend mode!|one beer from|you go hard|lost count|still on the couch/i;
const clearToasts = (page) => page.evaluate(() => document.querySelectorAll("#toasts .toast, .dl-cap, #pnlog-note").forEach((x) => x.remove()));

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    // 1. a NEW user: nothing on the phone yet
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { clean: true });
      const calls = [];
      await page.route(/rest\/v1\/rpc\/(my_visibility|set_visibility)\b/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        calls.push([fn, b]); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, friends_only: fn === "set_visibility" ? !!b.p_friends_only : false }) });
      });
      await boot(page, { clean: true });
      const s = await page.evaluate(() => ({ ps: window.PN && PN.privStart && PN.privStart.state(), prec: localStorage.getItem("olnu.prec"), sPrec: window.PN && PN.s && PN.s.prec,
        vis: localStorage.getItem("olnu.visMode"), log: localStorage.getItem("olnu.logLoc"), mode: window.PNVIS && PNVIS.mode(),
        areaBtn: (document.getElementById("prec-area") || { getAttribute: () => null }).getAttribute("aria-checked"),
        loc: window.PNLOG && PNLOG.state ? PNLOG.state().loc : null }));
      ok("B3 new user: phone marked new", s.ps === "new", s);
      ok("B3 new user: area position (olnu.prec = area, PN.s.prec = area, Område selected)", s.prec === "area" && s.sPrec === "area" && s.areaBtn === "true", s);
      ok("B3 new user: visible to friends and groups only (Bara vänner)", s.vis === "vanner" && s.mode === "vanner", s);
      ok("B3 new user: position log off (olnu.logLoc = 0, PNLOG loc off)", s.log === "0" && s.loc === false, s);
      const intro = await page.evaluate(() => (document.querySelector(".intro-priv") || {}).textContent || "");
      ok("B3 new user: the intro text matches the start state (friends + groups, area)", /vänner och gänget/.test(intro) && !/Okända ser bara ungefär/.test(intro), intro);
      await shot(page, "01-new-user-intro");
      // past the intro (18+ answered): the map of a new user
      await page.evaluate(() => { localStorage.setItem("olnu.intro", "1"); localStorage.setItem("olnu.age18", "1"); localStorage.setItem("olnu.locOk", "1"); });
      await page.reload(); await wait(page, 4500); await clearToasts(page); await wait(page, 300);
      const s2 = await page.evaluate(() => ({ ps: PN.privStart && PN.privStart.state(), prec: PN.s.prec, mode: PNVIS.mode(), lbl: (document.querySelector("#pn-ghost .mn-rail-l") || {}).textContent || null }));
      ok("B3 new user after a reload: still area + Bara vänner (the start runs once)", s2.ps === "new" && s2.prec === "area" && s2.mode === "vanner", s2);
      await shot(page, "02-new-user-map");
      // the server learns "Bara vänner" once the account exists (a server without 0534 answers false)
      await page.evaluate(() => { try { if (window.PNVIS && PNVIS.open) PNVIS.open(); } catch (e) {} }); await wait(page, 800);
      await shot(page, "03-new-user-synlighet");
      const vis = await page.evaluate(() => { const m = document.getElementById("pn-vis"); const c = m && m.querySelector('[aria-checked="true"],[aria-pressed="true"],.on'); return { open: !!m, sel: c ? c.textContent.trim() : null }; });
      ok("B3 new user: the Synlighet menu shows Bara vänner chosen", vis.open && /vänner/i.test(vis.sel || ""), vis);
      const sv = calls.filter((c) => c[0] === "set_visibility");
      ok("B3 new user: when the account answers, set_visibility(true) is sent at most once, never false", sv.length <= 1 && sv.every((c) => c[1].p_friends_only === true), calls);
      await ctx.close();
    }
    // 2. an OLD phone (the seeded user): nothing changes
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      await boot(page);
      const s = await page.evaluate(() => ({ ps: PN.privStart && PN.privStart.state(), prec: localStorage.getItem("olnu.prec"), sPrec: PN.s.prec, vis: localStorage.getItem("olnu.visMode"),
        log: localStorage.getItem("olnu.logLoc"), mode: window.PNVIS && PNVIS.mode() }));
      ok("B3 old phone: marked old, keeps exact position / Alla / log setting untouched", s.ps === "old" && s.prec === null && s.sPrec === "exact" && s.vis === null && s.log === null && s.mode === "alla", s);
      await clearToasts(page); await wait(page, 300);
      await shot(page, "04-old-user-map");
      // E2: ticker lines for a night with big counts (me 9, a friend 11, strangers 7): no praise, no race
      const lines = await page.evaluate(() => {
        const mk = (id, n, o) => Object.assign({ id, lat: 60.1500 + id * 1e-4, lng: 15.1868, beer_count: n, precise: true, created_at: new Date().toISOString(), is_mine: false, friend_name: null, skal_count: 0, shot_count: 0 }, o);
        const out = new Set(), pins = [mk(1, 9, { is_mine: true }), mk(2, 11, { friend_name: "Linnea" }), mk(3, 7), mk(4, 5), mk(5, 4, { friend_name: "Oskar" }), mk(6, 10)];
        for (let i = 0; i < 60; i++) { try { (window.NEWS.build(pins, { now: new Date(new Date().setHours(22 + (i % 5), i, 0, 0)), center: { lat: 60.15, lng: 15.1868 } }) || []).forEach((l) => out.add(typeof l === "string" ? l : (l.text || l.t || JSON.stringify(l)))); } catch (e) { out.add("ERR " + e.message); } }
        return [...out];
      });
      const bad = lines.filter((l) => BANNED.test(l) || /^ERR/.test(l));
      ok("E2 ticker: " + lines.length + " distinct lines for a big night, none praises a count", lines.length > 3 && bad.length === 0, bad.slice(0, 5));
      // E2: rank line, cooldown, labels (the app runs in Swedish only, I18N "SAFE"; the en strings are checked by tests/unit/nopush)
      const tx = await page.evaluate(() => { const T = (k, ...a) => window.I18N.t(k, ...a);
        return { next: T("titleNext", 9, "Kapten Kagge"), cd: T("cooldownToast", "9:59"), chaos: T("chaosHot", 3), lvl5: T("lvl5"), hot: T("hot"), med: T("medTitle") }; });
      ok("E2 rank line: no 'N öl kvar till', the rank name only", tx.next === "Nästa rang: Kapten Kagge", tx);
      ok("E2 cooldown, chaos facts and labels are information only", !BANNED.test(JSON.stringify(tx)) && /^Paus\./.test(tx.cd) && !/hot streak/i.test(tx.chaos), tx);
      await ctx.close();
    }
    // 3. a fresh night: the empty Min kväll text is a fact
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      await page.addInitScript(() => { try { localStorage.removeItem("olnu.night"); } catch (e) {} });
      await boot(page);
      await clearToasts(page);
      const r = await page.evaluate(async () => { if (!window.NIGHTLOG || !NIGHTLOG.open) return null; NIGHTLOG.open(); await new Promise((x) => setTimeout(x, 1200)); return (document.getElementById("sheet-body") || {}).innerText || ""; });
      ok("E2 Min kväll empty: no 'Tryck ÖL! så börjar rapporten'", r !== null && !/så börjar rapporten/i.test(r), (r || "").slice(0, 200));
      await shot(page, "05-min-kvall-empty");
      await ctx.close();
    }
    // 4. I-19b: the installed app of an old phone shows the reinstall note on Notiser; a browser tab does not
    for (const standalone of [true, false]) {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      if (standalone) await page.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : mm(q); });
      await boot(page);
      await clearToasts(page);
      await clickJS(page, "#btn-settings"); await wait(page, 1200);
      await clickJS(page, "#sheet-body [data-pf=s]"); await wait(page, 900);
      await clickJS(page, "#sheet-body .set-r-notis"); await wait(page, 900);
      await page.evaluate(() => { const f = document.querySelector("#sheet-body .pn-fold-row"); if (f) f.click(); }); await wait(page, 900);
      const n = await page.evaluate(() => { const e = document.querySelector(".pn-np-reinstall"); if (e) e.scrollIntoView({ block: "center" }); return e ? { t: e.textContent, vis: e.getClientRects().length > 0 } : null; });
      if (standalone) {
        ok("I-19b installed app (old phone): one reinstall note on Notiser, sv text", !!n && /Öl Nu/.test(n.t) && /Spara kontot först/.test(n.t), n);
        await wait(page, 300); await shot(page, "06-notiser-reinstall");
      } else ok("I-19b browser tab: no reinstall note", n === null, n);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack || e); }
  await browser.close();
  console.log(`\nTOTAL: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
