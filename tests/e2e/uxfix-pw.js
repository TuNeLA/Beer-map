// lane uxfix (13 Nov, blind test 22da459): release quick wins. Each check FAILS on the old code (4f84d53) and PASSES on the new.
//  A  P1-1 the age sheet comes ONCE: an existing user (old 18+ box, server age_ok null) gets it, answers, the answer could not be sent,
//     the app is reopened → no 2nd sheet, and the pending answer is sent then (localStorage until set_age_ok is OK)
//  A  P1-2 the age sheet: solid card (ds token) + dim backdrop (the map shows through, dimmed), fits 360 / 390 / 430
//  N  P1-5 one count source: header "N ute" (#live-count[data-out]); the ticker never says "Ingen ute / Tomt / Int' en själ" then,
//     and with no named pins it says "N ute – gå med i ett gäng för att se namn"
//  J  P1-6 invite join: primary "Till kartan – se gänget", install guide folded (optional), intro without step 3, no install wall on reopen
//  S  P1-4 Systembolaget: a row in "Mer på kartan" (opens the nearest store card, the switch hides / shows the pins) + a chip in "Ställen nära dig"
//  P  P2-4 push page: main switch off → sub-switches grey; the blocked help text is not cut
//  F  P1-3 first ÖL!: max 2 things in the first 10 s; Escape / back / map tap close "Vilken sort?"; medal toasts + "Befordrad!" wait while a sheet is open
// Mocked Supabase (ds-helpers). usage: node uxfix-pw.js <port> [only-regex]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8793, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = new RegExp(process.argv[3] || ".");
const { wait, GID } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { c = !!c; console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 500))); c ? pass++ : fail++; };
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const W3 = [360, 390, 430], HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name) => page.screenshot({ path: SP + "logs/uxfix-" + name + ".png" }).catch(() => {});
const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return 0; const p = m[1].split(",").map((x) => +x); return p.length > 3 ? p[3] : 1; };

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* ================= A: age sheet once + solid card ================= */
    if (ONLY.test("A")) {
      const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
      const calls = []; let phase = 1;
      await page.route(/rest\/v1\/rpc\/(safety_state|set_age_ok)\b/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        if (fn === "safety_state") return J(r, { v: 1, age_ok: null, terms_ver: 1, terms_at: new Date().toISOString(), store: "off", blocks: 0, notices: [] });
        calls.push({ phase, body });
        return phase === 1 ? J(r, { message: "boom" }, 500) : J(r, { age_ok: true });
      });
      await page.goto(BASE);
      await page.waitForSelector(".sf-ov .sf-age-sel", { timeout: 20000 }).catch(() => {});
      const first = await page.evaluate(() => !!document.querySelector(".sf-ov .sf-age-sel"));
      ok("A P1-1 upgrade user (old 18+ box, server age_ok null) gets the birth-year sheet once", first);
      for (const w of W3) {
        await page.setViewportSize({ width: w, height: HT[w] }); await wait(page, 300);
        const st = await page.evaluate(() => {
          const ov = document.querySelector(".sf-ov"), c = document.querySelector(".sf-card"); if (!ov || !c) return null;
          const r = c.getBoundingClientRect(), cs = getComputedStyle(c), os = getComputedStyle(ov);
          const tok = getComputedStyle(document.documentElement).getPropertyValue("--ds-card").trim();
          return { cardBg: cs.backgroundColor, ovBg: os.backgroundColor, tok, l: r.left, r: r.right, vw: innerWidth, sw: document.documentElement.scrollWidth };
        });
        if (w === 390) {
          ok("A P1-2 card is solid (alpha 1, the --ds-card token)", st && alpha(st.cardBg) === 1 && st.tok && st.cardBg.replace(/\s/g, "") === (function (h) { const n = parseInt(h.slice(1), 16); return "rgb(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + ")"; })(st.tok), st);
          ok("A P1-2 backdrop is dim, not opaque (0.5 < alpha < 1)", st && alpha(st.ovBg) > 0.5 && alpha(st.ovBg) < 1, st);
        }
        ok("A P1-2 card fits the screen at " + w, st && st.l >= 0 && st.r <= st.vw && st.sw <= st.vw, st);
        await shot(page, "A-age-" + w);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.selectOption(".sf-age-sel", "1990").catch(() => {}); await wait(page, 400);
      await page.click(".sf-card .btn-amber").catch(() => {}); await wait(page, 800);
      ok("A P1-1 answer tried to reach the server (failed: offline-like 500)", calls.some((c) => c.phase === 1 && c.body.p_birth_year === 1990), calls);
      // reopen: the app was closed (sessionStorage gone), the server still has no answer
      phase = 2;
      await page.evaluate(() => sessionStorage.clear());
      await page.reload(); await wait(page, 9000);
      const again = await page.evaluate(() => !!document.querySelector(".sf-ov .sf-age-sel"));
      ok("A P1-1 after a reopen: NO 2nd age sheet", !again);
      ok("A P1-1 after a reopen: the pending answer is sent (set_age_ok 1990)", calls.some((c) => c.phase === 2 && c.body.p_birth_year === 1990), calls);
      ok("A P1-1 the pending answer is gone after OK", await page.evaluate(() => !localStorage.getItem("olnu.agePend")));
      await ctx.close();
    }

    /* ================= N: one count source ================= */
    if (ONLY.test("N")) {
      const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
      await H.boot(page);
      const hd = await page.evaluate(() => { const e = document.getElementById("live-count"); const m = /(\d+)\s*ute/.exec(e.textContent || ""); return { out: e.getAttribute("data-out"), txt: e.textContent, n: m ? +m[1] : null }; });
      ok("N P1-5 the header's own number is published (#live-count[data-out] = the 'N ute' it shows)", hd.out != null && hd.out !== "" && (hd.n == null || +hd.out === hd.n), hd);
      const r = await page.evaluate(() => {
        const bad = /Ingen ute|Inga prickar|Tomt på kartan|Int' en själ|Ingen data|Lugnt läge|kartan är tom|Ingen har tryckt/i, res = [];
        for (let i = 0; i < 8; i++) {
          const items = window.NEWS.build([], { center: { lat: 60.1505, lng: 15.1872 }, now: new Date(), prev: [], titles: null, liveTotal: 7, hdrOut: 7, others: [], checkins: [], home: [], rallies: [], myName: "Anton", myTitle: null, myMedals: [] });
          res.push(items.map((x) => x.text));
        }
        const all = [].concat.apply([], res);
        return { bad: all.filter((t) => bad.test(t)), hint: res.every((l) => l.some((t) => /^7 ute – gå med i ett gäng för att se namn$/.test(t))), first: res.map((l) => l[0]) };
      });
      ok("N P1-5 header says 7 ute → no 'nobody here' line in the ticker (8 builds)", r.bad.length === 0, r.bad.slice(0, 4));
      ok("N P1-5 no named pins → '7 ute – gå med i ett gäng för att se namn' in every build", r.hint, r.first);
      await ctx.close();
    }

    /* ================= J: invite join → the map ================= */
    if (ONLY.test("J")) for (const w of W3) {
      const calls = [];
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] }, { clean: true, install: true });
      await page.route(/rest\/v1\/rpc\/(link_preview|join_preview|join_group|ev_preview)\b/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; calls.push(fn);
        if (fn === "link_preview") return J(r, { ok: true, kind: "join", name: "Fredagsgänget", members: 2, ute: 2, faces: [{ n: "Lisa" }, { n: "Erik" }] });
        if (fn === "join_preview") return J(r, { ok: true, name: "Fredagsgänget", members: 2, member: false, out: 2, faces: ["L", "E"] });
        if (fn === "join_group") return J(r, { id: GID, name: "Fredagsgänget", code: "SE5686" });
        return J(r, {});
      });
      await page.goto(BASE + "?join=SE5686&by=Lisa");
      await page.waitForSelector(".jn-joinbtn", { timeout: 20000 }).catch(() => {});
      await wait(page, 3000);
      await page.fill("#jn-name", "Sara").catch(() => {});
      await page.click(".jn-joinbtn").catch(() => {}); await wait(page, 600);
      await page.selectOption("#sf-age-year", "2002").catch(() => {}); await wait(page, 300);
      await page.click(".jn-age-go").catch(() => {}); await wait(page, 3500);
      const st = await page.evaluate(() => {
        const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && (!e.checkVisibility || e.checkVisibility({ contentVisibilityAuto: true }));
        const go = document.querySelector(".jn-tomap"), card = document.querySelector("#jn-wel");
        const steps = [...document.querySelectorAll("#jn-wel .jn-steps, #jn-wel .jn-install")];
        const gr = go && go.getBoundingClientRect();
        return { joined: !!document.querySelector(".jn-donebox"), go: go ? go.textContent : null, goVis: vis(go), primary: !!go && /btn-amber/.test(go.className),
          goInView: !!gr && gr.top >= 0 && gr.bottom <= innerHeight && gr.left >= 0 && gr.right <= innerWidth,
          guideShown: steps.some(vis), folded: !!document.querySelector("#jn-wel details.jn-instfold:not([open])"), skipVis: vis(document.querySelector(".jn-skip")),
          sw: document.documentElement.scrollWidth, vw: innerWidth, card: !!card };
      });
      await shot(page, "J-joined-" + w);
      ok("J P1-6 joined, primary 'Till kartan – se gänget' visible in view (" + w + ")", st.joined && st.go === "Till kartan – se gänget" && st.goVis && st.primary && st.goInView, st);
      ok("J P1-6 install guide is optional: folded, not shown (" + w + ")", st.folded && !st.guideShown, st);
      ok("J P1-6 no horizontal scroll (" + w + ")", st.sw <= st.vw, st);
      if (w === 390) {
        if (st.go) await page.click(".jn-tomap").catch(() => {}); else await page.click(".jn-skip").catch(() => {});
        await wait(page, 3000);
        const intro = await page.evaluate(() => { const r = document.getElementById("intro"); return { shown: !!r && !r.hidden, card: !!document.getElementById("jn-wel"), steps: [...document.querySelectorAll("#intro .intro-steps li")].map((l) => l.textContent) }; });
        ok("J P1-6 'Till kartan' closes the card", !intro.card, intro);
        ok("J P1-6 intro after a join: no 'Gå med i en grupp' step", intro.shown && intro.steps.length >= 2 && !intro.steps.some((t) => /Gå med i en grupp/.test(t)), intro);
        await page.goto(BASE); await wait(page, 4000);   // the next open (no ?join): intro not finished yet
        const inst = await page.evaluate(() => ({ want: window.INSTALL1 && window.INSTALL1.want ? window.INSTALL1.want() : null, wall: [...document.querySelectorAll("[class*='mn-inst']")].some((e) => e.getClientRects().length > 0) }));
        ok("J P1-6 next open: no install wall after a join", inst.want === false && !inst.wall, inst);
      }
      await ctx.close();
    }

    /* ================= S: Systembolaget is findable ================= */
    if (ONLY.test("S")) {
      const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
      await H.boot(page);
      for (const w of W3) {
        await page.setViewportSize({ width: w, height: HT[w] }); await wait(page, 300);
        await page.evaluate(() => { const b = document.getElementById("btn-more"); if (b) b.click(); }); await wait(page, 1200);
        const row = await page.evaluate(() => { const r = document.querySelector("#sheet-body .pn-sb-row"); if (!r) return null; const b = r.getBoundingClientRect(); return { t: r.textContent, l: b.left, r: b.right, vw: innerWidth, sw: document.getElementById("sheet-body").scrollWidth, cw: document.getElementById("sheet-body").clientWidth, sws: !!r.querySelector('.switch[role="switch"]') }; });
        ok("S P1-4 'Mer på kartan' has a Systembolaget row with a switch, fits at " + w, row && /Systembolaget/.test(row.t) && row.sws && row.l >= 0 && row.r <= row.vw && row.sw <= row.cw, row);
        if (w === 390) await shot(page, "S-mer-390");
        if (w !== 390) await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); });
        await wait(page, 500);
      }
      // the switch hides / shows the pins
      await page.evaluate(() => { const b = document.getElementById("btn-more"); if (b) b.click(); }); await wait(page, 1200);
      const sw = await page.evaluate(() => { const s = document.querySelector("#sheet-body .pn-sb-row .switch"); if (!s) return null; const a = s.getAttribute("aria-checked"); s.click(); const b = localStorage.getItem("olnu.sb"); s.click(); return { a, b, c: localStorage.getItem("olnu.sb") }; });
      ok("S P1-4 the row switch toggles the pins (olnu.sb)", sw && sw.a === "true" && sw.b === "0" && sw.c === "1", sw);
      await page.evaluate(() => { const g = document.querySelector("#sheet-body .pn-sb-go"); if (g) g.click(); });
      await page.waitForSelector(".leaflet-popup .sb-card", { timeout: 12000 }).catch(() => {});
      const card = await page.evaluate(() => { const c = document.querySelector(".leaflet-popup .sb-card"); return c ? { t: c.textContent.slice(0, 120), sheet: !document.getElementById("sheet").hidden } : null; });
      ok("S P1-4 the row opens the nearest store card (hours)", card && /Systembolaget/.test(card.t) && !card.sheet, card);
      await shot(page, "S-card-390");
      await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} window.NEARPLACES && window.NEARPLACES.open(); }); await wait(page, 1500);
      const chip = await page.evaluate(() => !!document.querySelector("#sheet-body .np-sb"));
      ok("S P1-4 'Ställen nära dig' has a Systembolaget chip", chip);
      await page.evaluate(() => { const c = document.querySelector("#sheet-body .np-sb"); if (c) c.click(); });
      await page.waitForSelector(".leaflet-popup .sb-card", { timeout: 12000 }).catch(() => {});
      ok("S P1-4 the chip opens the nearest store card", await page.evaluate(() => !!document.querySelector(".leaflet-popup .sb-card") && document.getElementById("sheet").hidden));
      await ctx.close();
    }

    /* ================= P: push page ================= */
    if (ONLY.test("P")) {
      const { ctx, page } = await H.ctxFor(browser, { width: 360, height: 780 });
      await ctx.addInitScript(() => { try { Object.defineProperty(Notification, "permission", { configurable: true, get: () => "denied" }); } catch (e) {} });
      await H.boot(page);
      await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
      await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Inställningar/.test(x.textContent)); b && b.click(); }); await wait(page, 2000);
      await page.evaluate(() => { const b = document.querySelector(".set-r-notis"); b && b.click(); }); await wait(page, 2500);
      await page.evaluate(() => { const x = [...document.querySelectorAll("#sheet-body summary, #sheet-body button, #sheet-body [role=button]")].find((e) => /Välj notiser/.test(e.textContent) && e.getClientRects().length); if (x) x.click(); }); await wait(page, 1200);
      const st = await page.evaluate(() => {
        const pg = document.querySelector('.set-page[data-pg="notis"]') || document.getElementById("sheet-body");
        const main = [...pg.querySelectorAll('.switch[role="switch"]')].find((s) => /Notiser om vänner/.test(s.getAttribute("aria-label") || ""));
        const subs = [...pg.querySelectorAll('.push-prefs .switch[aria-checked="true"]')].filter((s) => s.getClientRects().length);
        const look = subs.map((s) => { const cs = getComputedStyle(s); return { f: cs.filter, o: +cs.opacity }; });
        const info = [...pg.querySelectorAll(".info")].find((e) => /blockerade/.test(e.textContent) && e.getClientRects().length);
        return { main: main ? main.getAttribute("aria-checked") : null, n: subs.length, look: look.slice(0, 2),
          info: info ? { sh: info.scrollHeight, ch: info.clientHeight } : null };
      });
      await shot(page, "P-notis-360");
      ok("P P2-4 main switch off → the 'on' sub-switches look off (grey, dimmed)", st.main === "false" && st.n > 0 && st.look.every((x) => /grayscale/.test(x.f) && x.o < 0.8), st);
      ok("P P2-4 the blocked help text is shown whole (not cut)", st.info && st.info.sh <= st.info.ch + 1, st);
      await ctx.close();
    }

    /* ================= F: first beer, calm ================= */
    if (ONLY.test("F")) {
      const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
      await page.route(/rest\/v1\/rpc\/award_medals\b/, (r) => J(r, [{ medal: "m1", count: 1, is_new: true, earned_at: new Date().toISOString() }, { medal: "pluton", count: 1, is_new: true, earned_at: new Date().toISOString() }]));
      await H.boot(page);
      await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); });
      await wait(page, 800);
      // what the app does on an accepted 1st beer (app-beer beerDone) + the poll's promotion (social.js → MEDALS.levelUp)
      await page.evaluate(() => {
        const n = JSON.parse(localStorage.getItem("olnu.night")); n.count = 1; localStorage.setItem("olnu.night", JSON.stringify(n));
        window.__seen = {}; const t0 = Date.now();
        window.__spy = setInterval(() => {
          const s = window.__seen, at = Date.now() - t0;
          document.querySelectorAll("#toasts .toast").forEach((t) => { const k = /UXBEER/.test(t.textContent) ? "beer-toast" : /medalj/i.test(t.textContent) || t.classList.contains("medal-toast") ? "medal:" + t.textContent.slice(0, 40) : null; if (k && s[k] == null) s[k] = at; });
          if (document.querySelector(".pn-beerok") && s.chip == null) s.chip = at;
          const st = document.querySelector(".bp-strip"); if (st && !st.hidden && s.strip == null) s.strip = at;
          if (document.querySelector(".mx-pop") && s.pop == null) s.pop = at;
        }, 100);
        window.PN.toast("UXBEER Öl #1 – skål!", { ms: 6000 });
        window.PN.mods("onBeerAccepted", { beer_count: 1, lat: 60.15, lng: 15.1868, accepted: true }, { precise: true, ghost: false, total: 1 });
        window.MEDALS.levelUp("Rekryt Lättöl", "Värnpliktig Veteöl", 8);
      });
      await wait(page, 9600);
      const s10 = await page.evaluate(() => Object.assign({}, window.__seen));
      const in10 = Object.keys(s10).filter((k) => s10[k] <= 10000);
      ok("F P1-3 the first ÖL!: at most 2 things in the first 10 s", in10.length <= 2, s10);
      ok("F P1-3 'Vilken sort?' strip is up", await page.evaluate(() => { const s = document.querySelector(".bp-strip"); return !!s && !s.hidden; }));
      await page.keyboard.press("Escape"); await wait(page, 400);
      ok("F P1-3 Escape closes the 'Vilken sort?' strip", await page.evaluate(() => { const s = document.querySelector(".bp-strip"); return !s || s.hidden; }));
      await wait(page, 9000);
      const later = await page.evaluate(() => Object.assign({}, window.__seen));
      ok("F P1-3 the medal toasts and 'Befordrad!' still come when idle (queued, not lost)", Object.keys(later).some((k) => /^medal:/.test(k)) && later.pop != null, later);
      await page.evaluate(() => { clearInterval(window.__spy); document.querySelectorAll(".mx-pop .btn-amber").forEach((b) => b.click()); });
      await wait(page, 800);
      // back closes the strip (one history step, the page stays)
      const url0 = page.url();
      await page.evaluate(() => window.BARSPLUS.onBeerAccepted({ beer_count: 2 })); await wait(page, 1800);
      const up2 = await page.evaluate(() => { const s = document.querySelector(".bp-strip"); return !!s && !s.hidden; });
      await page.evaluate(() => history.back()).catch(() => {}); await wait(page, 900);
      const b2 = await page.evaluate(() => { const s = document.querySelector(".bp-strip"); return { closed: !s || s.hidden, url: location.href }; }).catch(() => ({ closed: false, url: "gone" }));
      ok("F P1-3 back closes the strip and stays in the app", up2 && b2.closed && b2.url === url0, { up2, b2, url0 });
      if (b2.url !== url0) { await page.goto(BASE); await page.waitForFunction(() => window.__map && window.BARSPLUS, null, { timeout: 30000 }).catch(() => {}); await wait(page, 3000); }
      // a map tap closes the strip
      await page.evaluate(() => window.BARSPLUS.onBeerAccepted({ beer_count: 2 })); await wait(page, 1800);
      const up3 = await page.evaluate(() => { const s = document.querySelector(".bp-strip"); return !!s && !s.hidden; });
      await page.evaluate(() => window.__map.fire("click", { latlng: window.__map.getCenter() })); await wait(page, 500);
      ok("F P1-3 a map tap closes the strip", up3 && await page.evaluate(() => { const s = document.querySelector(".bp-strip"); return !s || s.hidden; }), { up3 });
      // a sheet is open: medal toasts and "Befordrad!" wait, then come when it closes
      await wait(page, 10500);   // past the 10 s calm window of the beer above
      await page.evaluate(() => {
        document.querySelectorAll(".mx-pop").forEach((p) => p.remove());
        window.PN.openSheet("Test", (b) => { b.textContent = "uxfix"; });
        window.__seen = {}; const t0 = Date.now();
        window.__spy = setInterval(() => {
          const s = window.__seen, at = Date.now() - t0;
          document.querySelectorAll("#toasts .toast").forEach((t) => { if ((/medalj/i.test(t.textContent) || t.classList.contains("medal-toast")) && s.medal == null) s.medal = at; });
          if (document.querySelector(".mx-pop") && s.pop == null) s.pop = at;
        }, 100);
        window.MEDALS.award(null, true); window.MEDALS.levelUp("Värnpliktig Veteöl", "Menig Mellanöl", 12);
      });
      await wait(page, 5500);
      const during = await page.evaluate(() => Object.assign({ open: !document.getElementById("sheet").hidden }, window.__seen));
      ok("F P1-3 while a sheet is open: no medal toast, no 'Befordrad!'", during.open && during.medal == null && during.pop == null, during);
      await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); });
      await wait(page, 9000);
      const after = await page.evaluate(() => Object.assign({}, window.__seen));
      ok("F P1-3 the sheet closed → they come (toast first, then the card)", after.medal != null && after.pop != null && after.medal <= after.pop, after);
      await ctx.close();
    }
  } catch (e) { console.log("ERROR", e && e.stack); fail++; }
  await browser.close();
  console.log(`uxfix: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
