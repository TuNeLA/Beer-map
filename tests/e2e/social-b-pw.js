// social-b lane: S3 Betaversion switch, S4 e-mail login in the beta, Dialekt row, S1 avatar focus, R1 style items.
// Usage: node social-b-pw.js <port> [part …]   parts: s3 s4 dk s1 r1 (default: all). Mocked Supabase (ds-helpers).
// Each check prints PASS/FAIL. Screenshots: OUT/social-b-shots/<name>-<w>.png
const fs = require("fs");
const { chromium } = require("playwright");
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const OUT = require("./env.js").OUT, SHOTS = OUT + "social-b-shots/";
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.slice(3);
const want = (p) => !ONLY.length || ONLY.includes(p);
const WIDTHS = [360, 390, 430];
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 700))); c ? pass++ : fail++; };

// beta code: what beta.js does in the beta build (window.PN_BETA); direct = the test URL itself (olnu.betaUrl = this server)
async function app(browser, w, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: w, height: o.h || 844 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await ctx.addInitScript((o) => {
    if (o.beta) window.PN_BETA = "abc1234";
    if (o.direct) { try { localStorage.setItem("olnu.betaUrl", o.base); } catch (e) {} }
    if (o.fakeSw && navigator.serviceWorker) {   // the launcher worker: answers on the port, records the channel messages
      const fake = { postMessage(msg, ports) {
        try { if (msg && /^pn-kanal/.test(msg.type)) { const l = JSON.parse(localStorage.getItem("sb.kanalMsgs") || "[]"); l.push(msg); localStorage.setItem("sb.kanalMsgs", JSON.stringify(l)); } } catch (e) {}
        try { if (ports && ports[0]) ports[0].postMessage({ ok: true }); } catch (e) {}
      } };
      try { Object.defineProperty(navigator.serviceWorker, "controller", { configurable: true, get() { return fake; } }); } catch (e) {}
    }
  }, { ...o, base: BASE });
  await boot(page);
  return { ctx, page, errs };
}
async function openTab(page, tab) {
  await clickJS(page, "#btn-settings"); await wait(page, 1300);
  await page.waitForSelector("#sheet-body [data-pf=" + tab + "]", { timeout: 10000 }).catch(() => {});
  await clickJS(page, "#sheet-body [data-pf=" + tab + "]"); await wait(page, 1600);
}
// d1settings hub (setfix): Inställningar = 8 rows; a row opens its page (om = Om appen, karta = Karta & dialekt, konto = Konto)
async function openPg(page, key) { await clickJS(page, "#sheet-body .set-r-" + key); await wait(page, 700); }
async function clipShot(page, sel, name, pad = 80) {
  const box = await page.evaluate(([s, pad]) => {
    const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: "center" });
    const r = e.getBoundingClientRect(); const y = Math.max(0, r.top - pad);
    return { x: 0, y, width: innerWidth, height: Math.min(innerHeight - y, r.height + pad * 2) };
  }, [sel, pad]);
  await wait(page, 250);
  if (box && box.height > 0) await page.screenshot({ path: SHOTS + name + ".png", clip: box }); else await page.screenshot({ path: SHOTS + name + ".png" });
}
// the Betaversion row: on, hint lines, section, note
const kanalRow = (page) => page.evaluate(() => {
  const r = document.querySelector("#sheet-body .pn-kanal"); if (!r) return null;
  const sw = r.querySelector(".switch"), sm = r.querySelector("small"), info = r.querySelector(".kn-info");
  const lh = sm ? parseFloat(getComputedStyle(sm).lineHeight) || 20 : 20;
  const sec = r.closest("section.ds-section, .set-page");
  return { on: sw && sw.getAttribute("aria-checked"), sub: sm ? sm.textContent.trim() : "", lines: sm ? Math.round(sm.getBoundingClientRect().height / lh) : 0,
    sec: sec && (sec.getAttribute("data-ds") || sec.getAttribute("data-pg")), h: Math.round(r.getBoundingClientRect().height), info: !!info && !info.hidden && info.getBoundingClientRect().height > 0,
    infoText: info ? info.textContent : "", link: info && info.querySelector("a") ? info.querySelector("a").href : "", right: Math.round(r.getBoundingClientRect().right), vw: innerWidth };
});

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });

  /* ---------- S3: Betaversion ---------- */
  if (want("s3")) for (const w of WIDTHS) {
    // a) beta through the launcher (same app, beta channel): row ON, 2-line hint; OFF → stable, same account
    {
      const { ctx, page, errs } = await app(browser, w, { beta: true, fakeSw: true });
      await openTab(page, "s"); await openPg(page, "om");
      const r = await kanalRow(page);
      ok(`[${w}] S3 launcher beta: Betaversion row shown, ON, in Om appen`, !!r && r.on === "true" && r.sec === "om", r);
      ok(`[${w}] S3 launcher beta: hint says beta + 'Av = vanliga appen, samma konto', max 2 lines (R1-28)`, !!r && /Beta abc1234\. Av = vanliga appen, samma konto\./.test(r.sub) && r.lines <= 2, r);
      await clipShot(page, "#sheet-body .pn-kanal", `s3-launcher-on-${w}`);
      if (w === 390) {
        const uid0 = await page.evaluate(() => (JSON.parse(localStorage.getItem("olnu.auth") || "{}").user || {}).id);
        await page.evaluate(() => { window.__sbMark = 1; localStorage.removeItem("sb.kanalMsgs"); const b = document.querySelector("#sheet-body .pn-kanal .switch"); if (b) b.click(); });
        await page.waitForFunction(() => !window.__sbMark, null, { timeout: 8000 }).catch(() => {});   // the page reloads
        await wait(page, 1500);
        const after = await page.evaluate(async () => {
          const l = JSON.parse(localStorage.getItem("sb.kanalMsgs") || "[]"), set = l.filter((m) => m.type === "pn-kanal-set").pop();
          let rec = null; try { const c = await caches.open("olnu-pending"); const x = await c.match("./__kanal"); rec = x ? await x.json() : null; } catch (e) {}
          return { set: set && set.rec, rec, uid: (JSON.parse(localStorage.getItem("olnu.auth") || "{}").user || {}).id, reloaded: !window.__sbMark };
        });
        ok(`[${w}] S3 launcher beta: OFF → worker told 'stable' (pn-kanal-set), record stable, page reloaded`, after.reloaded && after.set && after.set.ch === "stable" && after.rec && after.rec.ch === "stable", after);
        ok(`[${w}] S3 launcher beta: same account after OFF`, !!uid0 && after.uid === uid0, { uid0, uid: after.uid });
      }
      ok(`[${w}] S3 launcher beta: no page errors`, errs.length === 0, errs);
      await ctx.close();
    }
    // b) the test URL itself (tunela.github.io/pintsnow-beta): shown ON + why it cannot switch; a tap stays beta
    {
      const { ctx, page, errs } = await app(browser, w, { beta: true, direct: true });
      await openTab(page, "s"); await openPg(page, "om");
      const r = await kanalRow(page);
      ok(`[${w}] S3 test URL: Betaversion row shown, ON, with the explanation`, !!r && r.on === "true" && /Testadressen kör alltid betan/.test(r.sub) && r.lines <= 2, r);
      await clipShot(page, "#sheet-body .pn-kanal", `s3-testurl-on-${w}`);
      await page.evaluate(() => { window.__sbMark = 1; const b = document.querySelector("#sheet-body .pn-kanal .switch"); if (b) b.click(); });
      await wait(page, 1200);
      const r2 = await kanalRow(page), still = await page.evaluate(() => window.__sbMark === 1);
      ok(`[${w}] S3 test URL: tap OFF does not switch (stays ON, no reload), note + link to the normal app shown`,
        !!r2 && r2.on === "true" && still && r2.info && /kan inte byta kanal/.test(r2.infoText) && /\/Beer-map\/docs\/\?kanal=stabil$/.test(r2.link), r2);
      ok(`[${w}] S3 test URL: no dialog box (inline note only)`, await page.evaluate(() => !document.querySelector("dialog[open], .mx-pop")));
      await clipShot(page, "#sheet-body .pn-kanal", `s3-testurl-note-${w}`);
      ok(`[${w}] S3 test URL: no page errors`, errs.length === 0, errs);
      await ctx.close();
    }
    // c) the stable app: row OFF, short hint, the logging text opens under it ("Vad loggas?") without flipping the switch
    {
      const { ctx, page, errs } = await app(browser, w, {});
      await openTab(page, "s"); await openPg(page, "om");
      const r = await kanalRow(page);
      ok(`[${w}] S3 stable: row OFF, hint max 2 lines (R1-28)`, !!r && r.on === "false" && r.lines <= 2 && r.right <= r.vw, r);
      await clipShot(page, "#sheet-body .pn-kanal", `s3-stable-off-${w}`);
      await clickJS(page, "#sheet-body .pn-kanal .kn-more"); await wait(page, 400);
      const r2 = await kanalRow(page);
      ok(`[${w}] S3 stable: 'Vad loggas?' opens the full logging text, switch stays OFF`, !!r2 && r2.info && /loggar vi allt/.test(r2.infoText) && r2.on === "false", r2);
      ok(`[${w}] S3 stable: no page errors`, errs.length === 0, errs);
      await ctx.close();
    }
  }

  /* ---------- S4: e-mail login in the beta (account_config says email false in the mock) ---------- */
  if (want("s4")) for (const w of WIDTHS) {
    for (const beta of [true, false]) {
      if (!beta && w !== 390) continue;
      const { ctx, page, errs } = await app(browser, w, { beta });
      await openTab(page, "p");
      const hero = await page.evaluate(() => { const b = document.querySelector("#sheet-body .pf-acct"); return b && b.getBoundingClientRect().height > 0 ? b.textContent.trim() : null; });
      if (beta) await page.screenshot({ path: SHOTS + `s4-beta-profil-${w}.png` });
      // the rows below the Profil hero sit behind the "Namn, konto och mer" fold
      await page.evaluate(() => { const f = document.querySelector("#sheet-body .pn-fold-t"); const b = document.getElementById("sheet-body"); if (f && !b.classList.contains("pn-pfopen")) f.click(); });
      await wait(page, 700);
      // d1settings move 6 (setfix): the account rows moved to Inställningar › Konto; Profil has one "Konto" link row that opens it
      await clickJS(page, "#sheet-body .pf-konto-row"); await wait(page, 1200);
      const a = await page.evaluate(() => {
        const b = document.querySelector("#sheet-body .set-acc-save"); if (b) b.scrollIntoView({ block: "center" });
        return { save: !!b && b.getBoundingClientRect().height > 0 ? b.textContent.trim() : null, on: !!(window.ACCOUNT && window.ACCOUNT.on && window.ACCOUNT.on()), cfg: window.ACCOUNT && window.ACCOUNT._cfg && window.ACCOUNT._cfg() };
      });
      a.hero = hero;
      if (beta) {
        ok(`[${w}] S4 beta: Profil hero shows the account badge ('Int' sparat')`, !!hero && /sparat/i.test(hero), a);
        ok(`[${w}] S4 beta: 'Spara kontot' (e-post) shown (Profil → Konto) although account_config says email false`, a.on && !!a.save, a);
        await clipShot(page, "#sheet-body .set-acc-save", `s4-beta-save-${w}`);
        if (w === 390) {   // the flow opens (no mail is sent: the test stops at the e-mail field)
          await clickJS(page, "#sheet-body .set-acc-save"); await wait(page, 1200);
          const f = await page.evaluate(() => { const i = document.querySelector('#sheet-body input[type="email"], #sheet-body input[autocomplete="email"]'); return { input: !!i, title: (document.querySelector(".sheet-head h2") || {}).textContent }; });
          ok(`[${w}] S4 beta: tap → the e-mail step opens`, f.input, f);
          await page.screenshot({ path: SHOTS + `s4-beta-email-step-${w}.png` });
          // owner 11 Nov: the code step covers the whole phone screen, code + Klart near the top (above the keyboard)
          await page.route(/auth\/v1\/(otp|user)\b/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
          await page.evaluate(() => { const i = document.querySelector('#sheet-body input[type="email"], #sheet-body input[autocomplete="email"]'); if (i) { i.value = "test@example.com"; i.dispatchEvent(new Event("input", { bubbles: true })); } });
          await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => !x.disabled && x.getBoundingClientRect().height > 0 && /skicka|fortsätt|kod/i.test(x.textContent)); if (b) b.click(); });
          await wait(page, 1500);
          const c = await page.evaluate(() => { const s = document.getElementById("sheet"), v = document.querySelector("#sheet-body .acct-verify"), o = document.querySelector("#sheet-body .acct-otp");
            return { code: !!o, full: s.classList.contains("acct-full"), top: Math.round(s.getBoundingClientRect().top), vb: v ? Math.round(v.getBoundingClientRect().bottom) : null, vh: innerHeight }; });
          ok(`[${w}] S4 code step: full screen on a phone, code + Klart in the top half (above the keyboard)`, c.code && c.full && c.top <= 1 && c.vb !== null && c.vb < c.vh * 0.55, c);
          await page.screenshot({ path: SHOTS + `s4-beta-code-step-${w}.png` });
          await page.evaluate(() => { const x = document.querySelector("#sheet .sheet-close, #sheet [aria-label='Stäng'], #sheet-close"); if (x) x.click(); else if (window.OLNU && window.OLNU.closeSheet) window.OLNU.closeSheet(); });
          await wait(page, 600);
          const after = await page.evaluate(() => document.getElementById("sheet").classList.contains("acct-full"));
          ok(`[${w}] S4 code step: the full-screen class goes away when the sheet closes`, !after, after);
        }
      } else ok(`[${w}] S4 stable: e-mail login still hidden (flag off): no badge, no button`, !a.on && !a.save && !a.hero, a);
      ok(`[${w}] S4 ${beta ? "beta" : "stable"}: no page errors`, errs.length === 0, errs);
      await ctx.close();
    }
  }

  /* ---------- Dialekt row in Inställningar (Skoj & överraskningar → the "Mer" fold) ---------- */
  if (want("dk")) for (const w of WIDTHS) {
    const { ctx, page, errs } = await app(browser, w, {});
    await page.route(/rest\/v1\/rpc\/my_home_town\b/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, town: "Ludvika" }) }));
    await openTab(page, "s"); await openPg(page, "karta");
    const d0 = await page.evaluate(() => {
      const r = document.querySelector("#sheet-body .dk-set"); if (!r) return null;
      const pg = r.closest(".set-page");
      return { n: document.querySelectorAll("#sheet-body .dk-set").length, pg: pg && pg.getAttribute("data-pg") };
    });
    // d1settings hub (setfix): Dialekt is on the page "Karta & dialekt" (was: Skoj & överraskningar behind Mer)
    ok(`[${w}] Dialekt: one row in Inställningar, on the page Karta & dialekt`, !!d0 && d0.n === 1 && d0.pg === "karta", d0);
    const m = await page.evaluate(() => {
      const b = document.querySelector("#sheet-body .dk-set .dk-sw"); if (!b) return null; b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect(), sub = b.querySelector(".dk-sub");
      return { h: Math.round(r.height), right: Math.round(r.right), vw: innerWidth, vis: r.height > 0, aria: b.getAttribute("aria-checked"), sub: sub && sub.textContent, cut: sub && sub.scrollWidth > sub.clientWidth + 1 };
    });
    ok(`[${w}] Dialekt: row visible on Karta & dialekt, ≥ 56 px, inside the screen, ON = Auto, sub not cut`, !!m && m.vis && m.h >= 56 && m.right <= m.vw && m.aria === "true" && /^Auto · /.test(m.sub) && !m.cut, m);
    await clipShot(page, "#sheet-body .dk-set", `dk-row-${w}`, 120);
    await clickJS(page, "#sheet-body .dk-set .dk-sw"); await wait(page, 400);
    const off = await page.evaluate(() => { const b = document.querySelector("#sheet-body .dk-sw"); return { mode: window.DIALEKT && window.DIALEKT.mode(), aria: b && b.getAttribute("aria-checked") }; });
    ok(`[${w}] Dialekt: tap → Av`, off.mode === "off" && off.aria === "false", off);
    await clickJS(page, "#sheet-body .dk-set .dk-sw"); await wait(page, 300);
    ok(`[${w}] Dialekt: second tap → Auto`, await page.evaluate(() => window.DIALEKT.mode() === "auto"));
    ok(`[${w}] Dialekt: no page errors`, errs.length === 0, errs);
    await ctx.close();
  }

  /* ---------- S1: avatar editor focus view (glasses + hat on the character) ---------- */
  const SPEC = { v: 2, sk: 11, fs: 2, ey: 0, br: 6, mt: 0, hr: 2, hc: 1, fh: 1, hw: 1, gl: 1, up: 1, uc: 0, bg: 0, ns: 4, ms: 1 };
  async function avApp(browser, w) {
    const t = await app(browser, w, {});
    t.saves = [];
    await t.page.route(/rest\/v1\/rpc\/(my_avatar|set_my_avatar)\b/, (r) => {
      if (/set_my_avatar/.test(r.request().url())) { t.saves.push(r.request().postData()); return r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); }
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, spec: SPEC, seed: "5e3a91c2", facts: { r: 8, m: [] } }) });
    });
    await t.page.evaluate(() => window.AVATAR && window.AVATAR.loadMe && window.AVATAR.loadMe(true)); await wait(t.page, 800);
    return t;
  }
  const pv = (page, sel, pill) => page.evaluate(([sel, pill]) => {
    const p = document.querySelector(sel), b = document.querySelector(pill);
    return { html: p ? p.innerHTML.replace(/\bav\d+/g, "ID") : "",   /* the SVG ids are new on every render */ pill: !!b && !b.hidden && b.getBoundingClientRect().height > 0, label: b ? b.textContent.trim() : "", pressed: b ? b.getAttribute("aria-pressed") : null,
      h: b ? Math.round(b.getBoundingClientRect().height) : 0, w: b ? Math.round(b.getBoundingClientRect().width) : 0, icon: !!(b && b.querySelector("svg")) };
  }, [sel, pill]);
  if (want("s1")) for (const w of WIDTHS) {
    // a) the full editor "Min karaktär"
    {
      const { ctx, page, errs, saves } = await avApp(browser, w);
      await page.evaluate(() => window.AVATAR.openEditor({ full: true })); await wait(page, 1500);
      const P = "#sheet-body .ave-prev", B = "#sheet-body .ave-acc", tab = async (t) => { await clickJS(page, `#sheet-body .ave-tab[data-t="${t}"]`); await wait(page, 450); };
      await tab("face-sk"); const h0 = await pv(page, P, B);
      ok(`[${w}] S1 editor: Hudton shows everything (glasses + hat), no pill`, !!h0.html && !h0.pill, h0);
      await tab("face-ey"); const h1 = await pv(page, P, B);
      ok(`[${w}] S1 editor: Ögon hides the glasses in the preview + pill 'Visa allt' (PNI icon)`, h1.html !== h0.html && h1.pill && h1.label === "Visa allt" && h1.pressed === "false" && h1.icon, { pill: h1.pill, label: h1.label, same: h1.html === h0.html });
      await clipShot(page, "#sheet-body .ave-top", `s1-editor-eyes-hidden-${w}`, 10);
      await clickJS(page, B); await wait(page, 450); const h2 = await pv(page, P, B);
      ok(`[${w}] S1 editor: 'Visa allt' shows everything again, pill → 'Dölj tillbehör'`, h2.html === h0.html && h2.label === "Dölj tillbehör" && h2.pressed === "true", { label: h2.label, same: h2.html === h0.html });
      await clipShot(page, "#sheet-body .ave-top", `s1-editor-eyes-showall-${w}`, 10);
      await clickJS(page, B); await wait(page, 450); const h3 = await pv(page, P, B);
      ok(`[${w}] S1 editor: 'Dölj tillbehör' hides them again`, h3.html === h1.html && h3.label === "Visa allt", { label: h3.label });
      await clickJS(page, B); await wait(page, 300);   // show all, then leave the tab
      await tab("face-ec"); const h4 = await pv(page, P, B);
      ok(`[${w}] S1 editor: Ögonfärg = new tab → auto-hide again ('Visa allt')`, h4.html !== h0.html && h4.pill && h4.label === "Visa allt", { label: h4.label });
      await tab("face-br"); const h5 = await pv(page, P, B);
      ok(`[${w}] S1 editor: Bryn hides the glasses too`, h5.html !== h0.html && h5.pill, { pill: h5.pill });
      await tab("face-ns"); const h6 = await pv(page, P, B);
      ok(`[${w}] S1 editor: Näsa (leaving the tab) restores everything, no pill`, h6.html === h0.html && !h6.pill, { pill: h6.pill, same: h6.html === h0.html });
      await tab("hair-hr"); const h7 = await pv(page, P, B);
      ok(`[${w}] S1 editor: Frisyr hides the hat + pill`, h7.html !== h0.html && h7.pill, { pill: h7.pill });
      await clipShot(page, "#sheet-body .ave-top", `s1-editor-hair-hidden-${w}`, 10);
      await tab("hair-hc"); const h8 = await pv(page, P, B);
      ok(`[${w}] S1 editor: Hårfärg hides the hat`, h8.html !== h0.html && h8.pill, { pill: h8.pill });
      await tab("head-hw"); const h9 = await pv(page, P, B);
      ok(`[${w}] S1 editor: Huvudbonad shows the hat (normal view)`, h9.html === h0.html && !h9.pill, { pill: h9.pill });
      const sv = await page.evaluate(() => ({ bar: !!document.querySelector("#sheet-body .ave-bar") && document.querySelector("#sheet-body .ave-bar").hidden, spec: window.AVATAR.me() && window.AVATAR.me().spec }));
      ok(`[${w}] S1 editor: the saved avatar is unchanged (no Spara bar, no save call, glasses + hat kept)`, sv.bar === true && saves.length === 0 && sv.spec && sv.spec.gl === 1 && sv.spec.hw === 1, { sv, saves });
      ok(`[${w}] S1 editor: pill ≥ 28 px high, fits`, h1.h >= 28 && h1.w <= w, h1);
      ok(`[${w}] S1 editor: no page errors`, errs.length === 0, errs);
      await ctx.close();
    }
    // b) the step wizard "Steg för steg"
    {
      const { ctx, page, errs, saves } = await avApp(browser, w);
      await page.evaluate(() => window.AVWIZ.open()); await wait(page, 1500);
      const P = "#sheet-body .avw-prev", B = "#sheet-body .avw-acc";
      const steps = await page.evaluate(() => window.AVWIZ._steps.map((s) => s.k || s.id));
      const go = async (k) => { const i = steps.indexOf(k); await clickJS(page, `#sheet-body .avw-quick [data-i="${i}"]`); await wait(page, 500); };
      await go("sk"); const h0 = await pv(page, P, B);
      ok(`[${w}] S1 wizard: Hudton shows everything, no pill`, !!h0.html && !h0.pill, h0.pill);
      await go("ey"); const h1 = await pv(page, P, B);
      ok(`[${w}] S1 wizard: Ögon step hides the glasses + pill 'Visa allt'`, h1.html !== h0.html && h1.pill && h1.label === "Visa allt", { pill: h1.pill, label: h1.label });
      await clipShot(page, "#sheet-body .avw-prevs", `s1-wizard-eyes-hidden-${w}`, 60);
      await clickJS(page, B); await wait(page, 400); const h2 = await pv(page, P, B);
      ok(`[${w}] S1 wizard: 'Visa allt' shows everything, 'Dölj tillbehör'`, h2.html === h0.html && h2.label === "Dölj tillbehör", { label: h2.label });
      await clickJS(page, "#sheet-body .avw-next"); await wait(page, 500); const h3 = await pv(page, P, B);
      ok(`[${w}] S1 wizard: Nästa → Ögonbryn: auto-hide again`, h3.html !== h0.html && h3.label === "Visa allt", { label: h3.label });
      await clickJS(page, "#sheet-body .avw-next"); await wait(page, 500); const h4 = await pv(page, P, B);
      ok(`[${w}] S1 wizard: Nästa → Mun restores everything, no pill`, h4.html === h0.html && !h4.pill, { pill: h4.pill });
      await go("hr"); const h5 = await pv(page, P, B);
      ok(`[${w}] S1 wizard: Frisyr step hides the hat + pill`, h5.html !== h0.html && h5.pill, { pill: h5.pill });
      await clipShot(page, "#sheet-body .avw-prevs", `s1-wizard-hair-hidden-${w}`, 60);
      const d = await page.evaluate(() => ({ spec: window.AVATAR.me() && window.AVATAR.me().spec }));
      ok(`[${w}] S1 wizard: the saved avatar is unchanged (no save call)`, saves.length === 0 && d.spec && d.spec.gl === 1 && d.spec.hw === 1, { d, saves });
      ok(`[${w}] S1 wizard: no page errors`, errs.length === 0, errs);
      await ctx.close();
    }
  }
  /* ---------- R1 style items ---------- */
  // every word of the text in these elements sits on ONE line (no "medaljcere/monin")
  const brokenWords = (page, sel) => page.evaluate((sel) => {
    const bad = [];
    document.querySelectorAll(sel).forEach((e) => {
      const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n;
      while ((n = tw.nextNode())) { const re = /\S+/g; let m; while ((m = re.exec(n.data))) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const rs = [...r.getClientRects()].filter((x) => x.width > 0); if (rs.length > 1) bad.push(m[0]); } }
    });
    return bad;
  }, sel);
  if (want("r1")) for (const w of WIDTHS) {
    const { ctx, page, errs } = await app(browser, w, {});
    // R1-47 + R1-06 + R1-07 (uniform): Min uniform
    await page.evaluate(() => window.MEDALS.showMine()); await wait(page, 1800);
    const u = await page.evaluate(() => {
      const b = document.querySelector("#sheet-body .uni-box"), cs = b && getComputedStyle(b), lis = [...document.querySelectorAll("#sheet-body .medal-grid > .medal")];
      const xs = [...new Set(lis.map((l) => Math.round(l.getBoundingClientRect().left)))];
      return { r: cs ? parseFloat(cs.borderTopLeftRadius) : 0, top: cs ? parseFloat(cs.borderTopWidth) : 9, n: lis.length, cols: xs.length,
        marks: document.querySelectorAll("#sheet-body .uni-ribbon .rb i, #sheet-body .uni-ribbon .rb b").length };
    });
    ok(`[${w}] R1-47 Min uniform: hero card rounded (≥ 16 px), no 3 px top stripe`, u.r >= 16 && u.top <= 1, u);
    await page.screenshot({ path: SHOTS + `r1-uniform-top-${w}.png` });
    ok(`[${w}] R1-06 Min uniform: medals in ONE column of rows`, u.n > 4 && u.cols === 1, u);
    const bw = await brokenWords(page, "#sheet-body .medal-grid .md-n, #sheet-body .medal-grid .md-d");
    ok(`[${w}] R1-06 Min uniform: no word breaks inside medal names / texts`, bw.length === 0, bw.slice(0, 8));
    ok(`[${w}] R1-07 uniform rack keeps its ★ / ×N marks`, u.marks > 0, u);
    await clipShot(page, "#sheet-body .medal-grid", `r1-uniform-medals-${w}`, 40);
    await clickJS(page, "#sheet-close"); await wait(page, 800);
    // R1-41 + R1-07 (Profil hero rack)
    await openTab(page, "p");
    const pr = await page.evaluate(() => {
      const s = document.querySelector("#sheet-body .pf-hero .pf-bar > span"), a = s ? getComputedStyle(s, "::after") : null;
      return { bar: !!s, knob: !!a && a.content !== "none" && a.display !== "none" && parseFloat(a.width) > 0, marks: document.querySelectorAll("#sheet-body .pf-medals .rb i, #sheet-body .pf-medals .rb b").length,
        rb: document.querySelectorAll("#sheet-body .pf-medals .rb").length };
    });
    ok(`[${w}] R1-41 Profil rank bar: no white knob (not a slider)`, pr.bar && !pr.knob, pr);
    ok(`[${w}] R1-07 Profil rack: ribbons without ★ / ×N`, pr.rb > 0 && pr.marks === 0, pr);
    await clipShot(page, "#sheet-body .pf-hero", `r1-profil-hero-${w}`, 10);
    await clickJS(page, "#sheet-close"); await wait(page, 800);
    // R1-15 level-up card
    await page.evaluate(() => window.MEDALS.levelUp("Fänrik Fatöl", "Löjtnant Lager", 43));
    await page.waitForSelector(".mx-level .mx-card", { timeout: 9000 }).catch(() => {}); await wait(page, 700);
    const lv = await page.evaluate(() => { const c = document.querySelector(".mx-level .mx-card"), t = document.querySelector(".mx-level .mx-title"); if (!c) return null;
      const cs = getComputedStyle(c), ts = getComputedStyle(t); return { r: parseFloat(cs.borderTopLeftRadius), top: parseFloat(cs.borderTopWidth), text: t.textContent, tt: ts.textTransform }; });
    ok(`[${w}] R1-15 level-up: rounded card (≥ 16 px), no top stripe`, !!lv && lv.r >= 16 && lv.top <= 1, lv);
    ok(`[${w}] R1-15 level-up: title not ALL CAPS ('Befordrad!')`, !!lv && lv.text === "Befordrad!" && lv.tt === "none", lv);
    await clipShot(page, ".mx-level .mx-card", `r1-levelup-${w}`, 20);
    await page.evaluate(() => { const b = document.querySelector(".mx-level .btn-amber"); if (b) b.click(); }); await wait(page, 700);
    // R1-21 meriter explainer icons
    await page.evaluate(() => window.MERITER.explain()); await wait(page, 1200);
    const me = await page.evaluate(() => { const rows = [...document.querySelectorAll("#sheet-body .mer-row")]; return { n: rows.length, svg: rows.filter((r) => r.querySelector(".mer-e svg")).length,
      emoji: rows.filter((r) => /\p{Extended_Pictographic}/u.test((r.querySelector(".mer-e") || {}).textContent || "")).length }; });
    ok(`[${w}] R1-21 meriter explainer: every row icon is a PNI icon (no emoji)`, me.n > 10 && me.svg === me.n && me.emoji === 0, me);
    await clipShot(page, "#sheet-body .mer-list", `r1-meriter-${w}`, 0);
    await clickJS(page, "#sheet-close"); await wait(page, 800);
    // R1-25 Topplistor → Meriter
    await clickJS(page, "#btn-top"); await wait(page, 1500);
    await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body [role=tab], #sheet-body .tabs > button")].find((x) => /^Meriter$/.test(x.textContent.trim())); if (b) b.click(); });
    await wait(page, 1800);
    const tb = await page.evaluate(() => {
      const segs = [...document.querySelectorAll("#sheet-body .mer-board .mer-tabs, #sheet-body .mer-board .mer-groups")].filter((s) => !s.hidden && s.getBoundingClientRect().height > 0);
      const btns = segs.flatMap((s) => [...s.children]);
      return { segs: segs.length, ds: segs.filter((s) => s.classList.contains("ds-seg")).length, outlined: btns.filter((b) => parseFloat(getComputedStyle(b).borderTopWidth) > 0).length,
        cut: btns.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent), n: btns.length };
    });
    ok(`[${w}] R1-25 Topplistor → Meriter: filters are segmented controls (no outlined option rows)`, tb.segs >= 2 && tb.ds === tb.segs && tb.outlined === 0, tb);
    ok(`[${w}] R1-25 Topplistor → Meriter: no filter text cut`, tb.n > 0 && tb.cut.length === 0, tb);
    await clipShot(page, "#sheet-body .mer-board", `r1-top-meriter-${w}`, 10);
    await clickJS(page, "#sheet-close"); await wait(page, 800);
    ok(`[${w}] R1: no page errors`, errs.length === 0, errs);
    await ctx.close();
    // R1-08 avatar wizard: quick tabs whole, 4 bottom controls, PNI ‹ + dice
    {
      const t = await avApp(browser, w);
      await t.page.evaluate(() => window.AVWIZ.open()); await wait(t.page, 1500);
      const q = await t.page.evaluate(() => {
        const bs = [...document.querySelectorAll("#sheet-body .avw-quick > button")], bar = document.querySelector("#sheet-body .avw-bar");
        const vis = bar ? [...bar.querySelectorAll("button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height > 0) : [];
        return { n: bs.length, cut: bs.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent), barN: vis.length, small: vis.filter((b) => b.getBoundingClientRect().height < 44).length,
          backIcon: !!document.querySelector("#sheet-body .avw-back svg"), diceIcon: !!document.querySelector("#sheet-body .avw-dice svg"), backLabel: (document.querySelector("#sheet-body .avw-back") || {}).ariaLabel || (document.querySelector("#sheet-body .avw-back") || { getAttribute: () => "" }).getAttribute("aria-label") };
      });
      ok(`[${w}] R1-08 wizard: quick tabs show the whole word (no 'Fo…')`, q.n >= 10 && q.cut.length === 0, q);
      ok(`[${w}] R1-08 wizard: bottom bar has 4 controls (‹ · dice · Klar nu · Nästa), all ≥ 44 px`, q.barN === 4 && q.small === 0, q);
      ok(`[${w}] R1-08 wizard: ‹ and the dice are PNI icons with labels`, q.backIcon && q.diceIcon && q.backLabel === "Tillbaka", q);
      await clipShot(t.page, "#sheet-body .avw-quick", `r1-wizard-tabs-${w}`, 10);
      await t.page.screenshot({ path: SHOTS + `r1-wizard-${w}.png` });
      await clickJS(t.page, "#sheet-body .avw-dice"); await wait(t.page, 500);
      const ta = await t.page.evaluate(() => [...document.querySelectorAll(".toast button, .toast a")].map((b) => b.textContent.trim()));
      ok(`[${w}] R1-08 wizard: 'Slumpa resten' is the action on the dice toast`, ta.some((x) => /Slumpa resten/.test(x)), ta);
      ok(`[${w}] R1-08 wizard: no page errors`, t.errs.length === 0, t.errs);
      await t.ctx.close();
    }
  }

  console.log(`social-b: ${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", e && e.stack || e); process.exit(1); });
