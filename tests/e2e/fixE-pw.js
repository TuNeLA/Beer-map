// fixE-pw.js — lane fixE (polish sweep E, 24 Nov 2026; findings: pn-scratch lanes/polish-FINDINGS.md).
// P-13 one screen never mixes dialect and standard forms: with no region the intro says "Logga in med e-post" (was "mä"),
//      the ticker of a Dalarna map never shows "är" next to "ä" (the rest: tests/unit/dialekt-form.test.mjs).
// P-15 Sök: the close button is the round sheet ✕ (44 px, --ds-raised), not the amber word "Stäng"; the scanner title has
//      the sheet title face and its ✕ the sheet ✕ colour.
// P-18 Levande karta = a row with an icon + one line, on Karta & dialekt (not Integritet); Kontakt on Om appen; the Konto
//      sub line names "Spara konto" only when the Konto page has it; "Hjälp till att förbättra appen" is OFF for a NEW install
//      in the beta (opt-in), an existing user keeps it on.
// P-24 dark only: light and dark system mode draw the same app (form fields too); no prefers-color-scheme rule.
// P-30 the install guide says "hemskärmen" in its own words ("startskärmen" only as Chrome's menu item name).
// P-31 while the intro (role=dialog aria-modal) shows, the app behind it is inert (ÖL! cannot be reached); after it, nothing is.
// Mocked Supabase (d2-helpers). Usage: node fixE-pw.js <port> [shotsDir]
const { ctxFor, boot, wait, clickJS } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SHOTS = process.argv[3] || "";
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: SHOTS + "/fixE-" + name + ".png" }); };
const VP = { width: 390, height: 844 };
const DAL = "(^|[^A-Za-zÅÄÖåäö'’”\"“])(ä|mä|dä|hä|int'|int)(?=$|[^A-Za-zÅÄÖåäö'’”\"“-])";

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, o.vp || VP, o);
  // the e-mail account entry ("Har du redan ett konto? Logga in med e-post") shows only when the server has it on: a fresh cache says so
  if (o.acct) await ctx.addInitScript(() => { try { localStorage.setItem("olnu.acct.cfg", JSON.stringify({ email: true, google: false, gOn: false, authEmail: true, at: Date.now() })); } catch (e) {} });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page, o.clean ? { clean: true } : {});
  if (!o.clean) await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  return { ctx, page, errs };
}
async function settingsPage(page, key) {
  await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
  await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Inställningar/.test(x.textContent)); if (b) b.click(); }); await wait(page, 2200);
  if (key) { await page.evaluate((k) => { const b = document.querySelector(".set-r-" + k); if (b) b.click(); }, key); await wait(page, 600); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--use-fake-ui-for-media-stream"] });
  try {
    // ---------- P-31 + P-13 + P-18 (new install): the intro ----------
    let { ctx, page, errs } = await open(browser, { clean: true, acct: true });
    await page.waitForFunction(() => { const i = document.getElementById("intro"); return i && !i.hidden && i.textContent.length > 20; }, null, { timeout: 20000 }).catch(() => {});
    await wait(page, 600);
    const in1 = await page.evaluate((dal) => {
      const i = document.getElementById("intro"), b = document.getElementById("btn-beer"), t = document.getElementById("toasts");
      return { open: !i.hidden, beerInert: !!(b && b.closest("[inert]")), introInert: !!i.closest("[inert]"), toastsInert: !!(t && t.closest("[inert]")),
        txt: i.textContent.replace(/\s+/g, " "), dal: (i.textContent.match(new RegExp(dal, "g")) || []).slice(0, 5),
        ev: localStorage.getItem("olnu.logEv"), st: window.PNLOG && PNLOG.state ? { mode: PNLOG.state().mode, full: PNLOG.state().full } : null,
        priv: window.PN && PN.privStart ? PN.privStart.state() : null };
    }, DAL);
    await shot(page, "intro-new");
    ok("P-31 the intro is open on a new install", in1.open, in1);
    ok("P-31 the app behind the intro is inert (ÖL! cannot be reached)", in1.beerInert, in1);
    ok("P-31 the intro itself and the toasts stay reachable", !in1.introInert && !in1.toastsInert, in1);
    ok("P-13 the intro (no region) has no Dalarna words (was 'Logga in mä e-post')", in1.dal.length === 0 && /Logga in med e-post/.test(in1.txt), in1.dal.concat([in1.txt.slice(-80)]));
    ok("P-18 the intro says usage is kept only after a yes", /bara om du säger ja/.test(in1.txt) && !/Vi sparar fel och hur appen används/.test(in1.txt), in1.txt.slice(-330));
    ok("P-18 new install in the beta: 'Hjälp till att förbättra appen' is OFF (opt-in)", in1.priv === "new" && in1.ev === "0" && in1.st && in1.st.mode === "on" && in1.st.full === false, in1);
    const in2 = await page.evaluate(() => { const i = document.getElementById("intro"); i.hidden = true; return new Promise((r) => setTimeout(() => {
      const b = document.getElementById("btn-beer"); r({ left: document.querySelectorAll("[data-intro-inert]").length, beerInert: !!(b && b.closest("[inert]")) }); }, 50)); });
    ok("P-31 after the intro nothing stays inert", in2.left === 0 && !in2.beerInert, in2);
    ok("no page errors (new install)", errs.length === 0, errs);
    await ctx.close();

    // ---------- P-30: the install guide words (a new Android phone) ----------
    ({ ctx, page, errs } = await open(browser, { clean: true, install: true }));
    await page.waitForSelector(".mn-inst-act button", { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { const b = document.querySelector(".mn-inst-act button"); if (b) b.click(); });   // "Fortsätt" → the steps
    await page.waitForSelector(".mn-inst-h, #mn-inst-h", { timeout: 15000 }).catch(() => {});
    await wait(page, 700);
    const g = await page.evaluate(() => { const r = document.querySelector("#ux-inst, .mn-inst") || document.body; const lines = [...r.querySelectorAll("p, small, span, div")].map((x) => x.childElementCount ? "" : x.textContent.trim()).filter(Boolean);
      return { lines, start: lines.filter((l) => /startskärm/i.test(l)), home: lines.filter((l) => /hemskärm/i.test(l)) }; });
    await shot(page, "install-guide");
    ok("P-30 install guide: our own lines say 'hemskärmen'; 'startskärmen' only names Chrome's menu item", g.home.length >= 1 && g.start.every((l) => /^Eller Lägg till på startskärmen$/.test(l)), g);
    await ctx.close();

    // ---------- P-18: an existing user keeps the usage switch on ----------
    ({ ctx, page, errs } = await open(browser));
    const old = await page.evaluate(() => ({ ev: localStorage.getItem("olnu.logEv"), priv: PN.privStart ? PN.privStart.state() : null, full: PNLOG.state().full }));
    ok("P-18 an existing user keeps their choice (usage stays on)", old.priv === "old" && old.ev === null && old.full === true, old);

    // ---------- P-18: the settings pages ----------
    await settingsPage(page, "synl");
    const synl = await page.evaluate(() => { const p = document.querySelector('.set-page[data-pg="synl"]'); return { alive: !!(p && p.querySelector(".al-row")), contact: !!(p && p.querySelector(".set-contact")), txt: p ? p.textContent.replace(/\s+/g, " ").slice(0, 400) : "" }; });
    await page.evaluate(() => { const r = document.querySelector('.set-page[data-pg="synl"] .pnlog-row') || document.querySelector('.set-page[data-pg="synl"] .set-rules'); if (r) r.scrollIntoView({ block: "center" }); });
    await wait(page, 300); await shot(page, "settings-integritet");
    ok("P-18 Integritet: no Levande karta row, no Kontakt row", !synl.alive && !synl.contact, synl);
    await page.click("#pn-back").catch(() => {}); await wait(page, 400);
    await page.evaluate(() => { const b = document.querySelector(".set-r-karta"); if (b) b.click(); }); await wait(page, 600);
    const karta = await page.evaluate(() => {
      const p = document.querySelector('.set-page[data-pg="karta"]'), row = p && p.querySelector(".al-row"), sw = row && row.querySelector("[role=switch]");
      if (row) row.scrollIntoView({ block: "center" });
      const r = sw && sw.getBoundingClientRect();
      return { row: !!row, icon: !!(row && row.querySelector("svg")), sub: row && row.querySelector(".al-sub") ? row.querySelector(".al-sub").textContent : "", sw: !!sw, aria: sw && sw.getAttribute("aria-checked"), h: r ? Math.round(r.height) : 0, vis: !!(r && r.height) };
    });
    await wait(page, 300); await shot(page, "settings-karta");
    ok("P-18 Karta & dialekt: Levande karta row with an icon, one line of text and a switch", karta.row && karta.icon && /animationer på kartan/.test(karta.sub) && karta.sw && karta.vis && karta.h >= 44, karta);
    const tog = await page.evaluate(() => { const sw = document.querySelector('.set-page[data-pg="karta"] .al-row [role=switch]'); if (!sw) return []; sw.click(); const a = [sw.getAttribute("aria-checked"), localStorage.getItem("pn_alive_off")]; sw.click(); return a.concat([sw.getAttribute("aria-checked"), localStorage.getItem("pn_alive_off")]); });
    ok("P-18 the Levande karta switch still turns the effects off and on", tog[0] === "false" && tog[1] === "1" && tog[2] === "true" && tog[3] === null, tog);
    await page.click("#pn-back").catch(() => {}); await wait(page, 400);
    await page.evaluate(() => { const b = document.querySelector(".set-r-om"); if (b) b.click(); }); await wait(page, 600);
    const om = await page.evaluate(() => { const p = document.querySelector('.set-page[data-pg="om"]'); return { contact: !!(p && p.querySelector(".set-contact")) }; });
    await shot(page, "settings-om");
    ok("P-18 Om appen has the Kontakt row", om.contact, om);
    await page.click("#pn-back").catch(() => {}); await wait(page, 400);
    const ko = await page.evaluate(() => { const r = document.querySelector(".set-r-konto"), p = document.querySelector('.set-page[data-pg="konto"]');
      return { sub: r ? r.textContent.replace(/\s+/g, " ") : "", save: !!(p && p.querySelector(".set-acc-save, .set-acc-change")) }; });
    ok("P-18 the Konto sub line says 'Spara konto' only when the Konto page has that row", /Spara konto|Konto sparat/.test(ko.sub) === ko.save && /Swish/.test(ko.sub), ko);
    await shot(page, "settings-hub");

    // ---------- P-13: the ticker of a Dalarna map never mixes "är" and "ä" ----------
    const tk = await page.evaluate(() => {
      const D = window.DIALEKT, N = window.NEWS; if (!D || !N || !N.last) return null;
      D.preview("sv-dalarna");
      const out = [];
      for (let i = 0; i < 6; i++) { try { const l = N.last(), r = N.build(l.beers, l.ctx); (r && r.items ? r.items : Array.isArray(r) ? r : []).forEach((x) => out.push(x.text || x)); } catch (e) { out.push("ERR " + e.message); } }
      D.preview(null);
      const L = "A-Za-zÅÄÖåäö'’”\"“", has = (t, w) => new RegExp("(^|[^" + L + "])" + w + "(?=$|[^" + L + "-])").test(t);
      return { n: out.length, ar: out.filter((t) => has(String(t), "är") || has(String(t), "Är")).slice(0, 4), a: out.filter((t) => has(String(t), "ä")).length };
    });
    ok("P-13 Dalarna ticker lines never say 'är' (the pack says 'ä')", tk && tk.n > 0 && tk.ar.length === 0, tk);
    await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await wait(page, 500);

    // ---------- P-15: Sök close = the round sheet ✕; scanner title = the sheet title face ----------
    await page.evaluate(() => { const b = document.getElementById("pn-search"); if (b) b.click(); }); await wait(page, 900);
    const sk = await page.evaluate(() => {
      const x = document.querySelector(".bs-close"), r = x && x.getBoundingClientRect(), cs = x && getComputedStyle(x);
      const ref = document.createElement("button"); ref.className = "icon-btn"; document.querySelector("#sheet .sheet-head").appendChild(ref); const rc = getComputedStyle(ref).backgroundColor; ref.remove();
      return x ? { w: Math.round(r.width), h: Math.round(r.height), rad: cs.borderTopLeftRadius, fs: cs.fontSize, bg: cs.backgroundColor, ref: rc, name: x.textContent, before: getComputedStyle(x, "::before").content } : null;
    });
    await shot(page, "sok");
    ok("P-15 Sök close is a round 44 px ✕ like the sheet ✕ (not the word 'Stäng')", sk && sk.w === 44 && sk.h === 44 && parseFloat(sk.rad) >= 22 && sk.fs === "0px" && sk.bg === sk.ref && sk.before !== "none", sk);
    ok("P-15 Sök close keeps its name for screen readers", sk && /Stäng/.test(sk.name), sk);
    await page.click("#bs-tab-beer").catch(() => {}); await page.waitForSelector("#bs-cam:not([hidden])", { timeout: 10000 }).catch(() => {});
    await page.click("#bs-cam").catch(() => {}); await page.waitForSelector("#bsc .bsc-title", { timeout: 15000 }).catch(() => {});
    await wait(page, 1500);
    const sc = await page.evaluate(() => {
      const t = document.querySelector(".bsc-title"), x = document.querySelector(".bsc-x"), h = document.getElementById("sheet-title");
      return t ? { tf: getComputedStyle(t).fontFamily, hf: getComputedStyle(h).fontFamily, tc: getComputedStyle(t).color, hc: getComputedStyle(h).color, size: getComputedStyle(t).fontSize, hs: getComputedStyle(h).fontSize,
        xbg: x && getComputedStyle(x).backgroundColor } : null;
    });
    await shot(page, "scanner");
    const ref2 = await page.evaluate(() => { const ref = document.createElement("button"); ref.className = "icon-btn"; document.querySelector("#sheet .sheet-head").appendChild(ref); const c = getComputedStyle(ref).backgroundColor; ref.remove(); return c; });
    ok("P-15 scanner title = the sheet title face, size and colour", sc && sc.tf === sc.hf && sc.size === sc.hs && sc.tc === sc.hc, sc);
    ok("P-15 scanner ✕ = the sheet ✕ colour", sc && sc.xbg === ref2, { sc, ref2 });
    ok("no page errors (existing user)", errs.filter((e) => !/camera|getUserMedia|NotFound|NotAllowed|Permission/i.test(e)).length === 0, errs);
    await ctx.close();

    // ---------- P-24: light and dark system mode draw the same app ----------
    const look = async (scheme) => {
      const { ctx: c, page: p } = await ctxFor(browser, VP, {});
      await p.emulateMedia({ colorScheme: scheme });
      await boot(p);
      const r = await p.evaluate(() => {
        const f = document.createElement("div"); f.innerHTML = '<input type="text"><select><option>x</option></select><input type="checkbox" checked>';
        document.body.appendChild(f); const [i, s, k] = f.children, g = (e) => { const c = getComputedStyle(e); return [c.color, c.backgroundColor, c.colorScheme].join("|"); };
        const out = { light: matchMedia("(prefers-color-scheme: light)").matches, body: getComputedStyle(document.body).backgroundColor, input: g(i), select: g(s), box: g(k),
          meta: (document.querySelector('meta[name="color-scheme"]') || {}).content || "" };
        f.remove();
        let rules = 0; for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch (e) { continue; } for (const r of rs) if (r.media && /prefers-color-scheme/.test(r.media.mediaText)) rules++; }
        out.rules = rules; return out;
      });
      await p.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
      await shot(p, "home-" + scheme);
      await c.close(); return r;
    };
    const lt = await look("light"), dk = await look("dark");
    ok("P-24 the light mode is really emulated", lt.light === true && dk.light === false, { lt: lt.light, dk: dk.light });
    ok("P-24 light system mode = the same dark app (body, text field, select, checkbox)", lt.body === dk.body && lt.input === dk.input && lt.select === dk.select && lt.box === dk.box && lt.meta === "dark", { lt, dk });
    ok("P-24 no prefers-color-scheme rule in the app CSS (dark only by design)", lt.rules === 0, lt.rules);
  } catch (e) { ok("no crash", false, String(e && e.stack || e)); }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
