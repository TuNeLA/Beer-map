// i18n-pw.js — E8 (owner 14 Nov 2026 "start English texts"; OWNER-INPUTS D5 Swedish only until the Nordic plan): the English
// switch behind a test flag (docs/js/i18n.js, Inställningar > Karta & dialekt). The local server serves the staging config =
// a test build, so the flag is on here. Checks:
//   1. the 11 main screens in English: no Swedish left in visible text, aria-label, placeholder, title or CSS content
//      (scripts/i18n/svdetect.js; proper names and the test data's user text are allowed), <html lang="en">
//   2. the switch: in Karta & dialekt, the dialect choice is hidden in English, a tap on Svenska stores "sv" and reloads
//   3. the same screens in Swedish (pictures for the contact sheet; html lang="sv")
// Pictures: $TEST_OUT/i18n-shots/<lang>-<nn>-<screen>.png. Report: $TEST_OUT/i18n-report.json. Usage: node i18n-pw.js <port>
const { ctxFor, boot, wait, settle } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs");
const { OUT, CHROME } = require("./env.js");
const { svWords } = require("../../scripts/i18n/svdetect.js");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 1500)); };
const SHOTS = OUT + "i18n-shots/"; fs.mkdirSync(SHOTS, { recursive: true });
// user text from the test data (rally body, chat lines, group names): a person writes it, the app does not translate it
// "Borlänge · 37 km": a town name + a distance (search results)
const PLACE_KM = /^[A-ZÅÄÖ][\wåäöé-]+(?: [A-ZÅÄÖ][\wåäöé-]+)* · [\d.,]+ k?m$/;
// KNOWN_LEFT: Swedish that is still on a main screen, with the reason. Each one is in lanes/i18n-DONE.md "Not done".
const KNOWN_LEFT = [
  // the medal names (docs/js/medals.js: 67 medals with name + 2 lines each, a content pack of its own)
  /^(Första kapsylen|Hemvärnet|Vattenbäraren|Tisdagstörst)( ×\d+)?$/,
];
const USER_TEXT = ["Alla till La Parma, jag bjuder på första rundan!!", "Våffelbruket", "Jobbet (ABB-gänget)"];   // + place and group names of the test data

// one screen = how to open it + where its text is (the sheet, or the whole page for the map)
const SCREENS = [
  { k: "01-map", root: "body", open: async () => {} },
  { k: "02-ikvall", root: ".hud-left, #pn-ikm", open: (p) => p.evaluate(() => { const b = document.getElementById("pn-ikv2") || document.getElementById("my-streak"); b && b.click(); }) },
  { k: "03-more", root: ".pn-more-pop, .mm-pop, #sheet:not([hidden])", open: (p) => p.evaluate(() => document.getElementById("btn-more").click()) },
  { k: "04-beer", root: "#toasts, #sheet:not([hidden]), .dock", quick: true, open: (p) => p.evaluate(() => document.getElementById("btn-beer").click()) },
  { k: "04b-other", root: "#sheet:not([hidden])", open: (p) => p.evaluate(() => { localStorage.removeItem("olnu.otherCd"); document.getElementById("btn-other").click(); }) },
  { k: "05-groups", root: "#sheet:not([hidden])", open: (p) => p.evaluate(() => document.getElementById("btn-groups").click()) },
  { k: "06-search", root: "#bs-panel", open: async (p) => {
    await p.evaluate(() => window.BARSEARCH.open("bars")); await wait(p, 600);
    await p.fill("#bs-q", "pi").catch(() => {});
  } },
  { k: "07-barcard", root: ".mapboxgl-popup, .olnu-bar, #sheet:not([hidden])", open: (p) => p.evaluate(() => window.PN.openBarById("n3472634175", 0)) },
  { k: "08-beerpage", root: "#sheet:not([hidden])", open: async (p) => {
    await p.evaluate(() => window.BARSEARCH.open("beer"));
    await p.waitForFunction(() => !!document.querySelector("#bs-beer [data-bl-beer]"), null, { timeout: 10000 }).catch(() => {});
    await p.evaluate(() => { const c = document.querySelector("#bs-beer [data-bl-beer]:not([data-bl-add])"); c && c.click(); });
  } },
  { k: "09-settings", root: "#sheet:not([hidden])", open: async (p) => {
    await p.evaluate(() => document.getElementById("btn-settings").click()); await wait(p, 900);
    await p.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Inställningar|Settings/.test(x.textContent)); b && b.click(); });
  } },
  // Inställningar: every page of the hub (10-karta = Karta & dialekt, where the language switch is)
  ...["konto", "synl", "notis", "plats", "karta", "bjud", "hjalp", "om"].map((pg) => ({ k: (pg === "karta" ? "10-" : "10-set-") + pg, root: "#sheet:not([hidden])", open: async (p) => {
    await p.evaluate(() => document.getElementById("btn-settings").click()); await wait(p, 900);
    await p.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Inställningar|Settings/.test(x.textContent)); b && b.click(); }); await wait(p, 900);
    await p.evaluate((k) => { const b = document.querySelector(".set-r-" + k); b && b.click(); }, pg);
  } })),
  { k: "11-profile", root: "#sheet:not([hidden])", open: async (p) => {
    await p.evaluate(() => document.getElementById("btn-settings").click()); await wait(p, 900);
    await p.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Profil/.test(x.textContent)); b && b.click(); });
  } },
  { k: "12-top", root: "#sheet:not([hidden])", open: (p) => p.evaluate(() => document.getElementById("btn-top").click()) },
];

// every text a person can see or hear on the screen part(s) `sel`
function collect(sel) {
  const vis = (e) => {
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
      if (x.hidden) return false;
      const cs = getComputedStyle(x); if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    }
    const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
    return sel !== "body" || (r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);   // a sheet: all of it (scrolled parts too)
  };
  const roots = [...document.querySelectorAll(sel)].filter(vis), out = [];
  const add = (t, where) => { t = String(t || "").replace(/\s+/g, " ").trim(); if (t && !out.some((o) => o.t === t)) out.push({ t, where }); };
  for (const root of roots) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    // an element marked lang="sv" is Swedish on purpose (the "Svenska" choice of the language switch)
    const svOk = (e) => { const l = e.closest("[lang]"); return !!l && l !== document.documentElement && l.getAttribute("lang") === "sv"; };
    for (let n; (n = tw.nextNode());) { const p = n.parentElement; if (p && !p.closest("script,style,svg,canvas,.mapboxgl-ctrl,.maplibregl-ctrl") && !svOk(p) && vis(p)) add(n.nodeValue, p.className && String(p.className).slice(0, 40)); }
    for (const e of [root, ...root.querySelectorAll("*")]) {
      if (e.closest("svg") || svOk(e) || !vis(e)) continue;
      for (const a of ["aria-label", "placeholder", "title", "alt"]) if (e.getAttribute(a)) add(e.getAttribute(a), "@" + a);
      for (const ps of ["::before", "::after"]) { const c = getComputedStyle(e, ps).content; if (c && /^".*[A-Za-zÅÄÖåäö]{2}.*"$/.test(c)) add(c.slice(1, -1), ps); }
    }
  }
  return out;
}

async function run(browser, lang, report) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { lang, checkin: false });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  const st = await page.evaluate(() => ({ lang: I18N.lang, html: document.documentElement.lang, flag: I18N.available(), loc: I18N.locale() }));
  ok(lang + ": I18N.lang, <html lang> and the locale follow the stored choice (test build: flag on)",
    st.lang === lang && st.html === lang && st.flag === true && st.loc === (lang === "en" ? "en-GB" : "sv-SE"), st);
  for (const s of SCREENS) {
    await s.open(page); if (s.quick) await wait(page, 700); else await settle(page, 1800);
    await page.screenshot({ path: SHOTS + lang + "-" + s.k + ".png" });
    if (lang === "en") {
      const texts = await page.evaluate(collect, s.root + (s.root === "body" ? "" : ", #toasts, .mn-note, .pn-kaos-line"));   // + the overlays any screen can show
      const sv = texts.filter((x) => !PLACE_KM.test(x.t) && !KNOWN_LEFT.some((re) => re.test(x.t))).map((x) => ({ ...x, w: svWords(x.t, USER_TEXT) })).filter((x) => x.w.length);
      report[s.k] = { n: texts.length, sv };
      ok("en " + s.k + ": " + texts.length + " texts, no Swedish left", texts.length > 0 && sv.length === 0, sv.map((x) => x.t.slice(0, 70) + " [" + x.w.join(",") + "] " + x.where));
    }
    await page.evaluate(() => { document.querySelectorAll(".mapboxgl-popup").forEach((x) => x.remove()); if (window.BARSEARCH && BARSEARCH._state().open) BARSEARCH.close(); });
    await page.keyboard.press("Escape"); await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); });
    await wait(page, 500);
  }
  ok(lang + ": no page errors", errs.length === 0, errs);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const report = {};
  try {
    await run(browser, "en", report);
    await run(browser, "sv", {});
    // the switch itself (Karta & dialekt): English hides the dialect choice; a tap on Svenska stores sv and reloads
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { lang: "en" });
    await boot(page);
    await SCREENS.find((s) => s.k === "10-karta").open(page); await settle(page, 1500);
    const sw = await page.evaluate(() => {
      const box = document.querySelector(".pn-lang"), b = box && [...box.querySelectorAll("button")];
      const vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
      return { box: vis(box), btns: b ? b.map((x) => x.textContent.trim() + ":" + x.getAttribute("aria-checked")) : null, h: b ? Math.min(...b.map((x) => x.getBoundingClientRect().height)) : 0,
        dialect: vis(document.querySelector(".dk-set")) };
    });
    ok("switch: shown in Karta & dialekt with Svenska + English, English checked, 44 px", sw.box && sw.btns && sw.btns.length === 2 && /English:true/.test(sw.btns.join()) && sw.h >= 44, sw);
    ok("switch: the dialect choice is hidden in English", sw.dialect === false, sw);
    await page.screenshot({ path: SHOTS + "en-switch.png" });
    await Promise.all([page.waitForEvent("load", { timeout: 15000 }).catch(() => null),
      page.evaluate(() => { const b = [...document.querySelectorAll(".pn-lang button")].find((x) => /Svenska/.test(x.textContent)); b && b.click(); })]);
    await page.waitForFunction(() => window.I18N && document.documentElement.lang === "sv", null, { timeout: 15000 }).catch(() => {});
    const after = await page.evaluate(() => ({ lang: I18N.lang, stored: localStorage.getItem("olnu.lang"), html: document.documentElement.lang }));
    ok("switch: Svenska stores sv, reloads, <html lang=sv>", after.lang === "sv" && after.stored === "sv" && after.html === "sv", after);
    await ctx.close();
  } finally {
    fs.writeFileSync(OUT + "i18n-report.json", JSON.stringify(report, null, 1));
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
