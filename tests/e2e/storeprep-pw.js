// storeprep-pw.js — lane storeprep (19 Nov 2026).
// F5 (= I-100): store builds (window.OLNU_STORE) show no beer-count medal (m10 … m1000) as a reward: not in MEDALS.mine(),
//   the uniform (earned + locked catalog), a member's uniform, a ribbon row, a new-medal toast or an avatar chest.
//   The web build keeps them (same mocks, same checks the other way round).
// F4: radera.html shows ONE delete text: today "direct" (0402 not live); body class del-7d shows the 7-day text instead.
// 390 px, mocked Supabase (d2-helpers). Usage: node storeprep-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 400)); };
const PORT = process.argv[2] || 8793, BASE = `http://127.0.0.1:${PORT}/`;
const BEER = ["m10", "m50", "m100", "m250", "m500", "m1000"];
const NAMES = /Tian|Femtiolappen|Hundringen|Kvartstusen|Halvtusen|Tusenåringen|Logga \d+ öl totalt/;

async function open(browser, store) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  if (store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  // a new medal from the server: one beer-count medal (m100) and one other (n5)
  await page.route(/rest\/v1\/rpc\/claim_medal/, (r) => {
    const b = JSON.parse(r.request().postData() || "{}");
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ medal: b.p_medal, is_new: true, count: 1, earned_at: new Date().toISOString() }]) });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => window.MEDALS && window.MEDALS.on && window.MEDALS.on(), null, { timeout: 15000 }).catch(() => console.log("MEDALS not on"));
  return { ctx, page, errs };
}

async function medals(page) {
  await page.evaluate(() => window.MEDALS.showMine()); await wait(page, 1500);
  return page.evaluate((BEER) => {
    const body = document.getElementById("sheet-body"), txt = body ? body.innerText : "";
    const mine = window.MEDALS.mine() || {};
    const row = window.MEDALS.medalRowHTML({ m1: { count: 1 }, m10: { count: 1 }, m1000: { count: 2 } }, 8, false);
    const norm = (s) => String(s).replace(/av\d+/g, "av#").replace(/__ID__/g, "av#");
    let chest = null;
    try {
      const A = window.AVATAR, sp = A.defaultSpec ? A.defaultSpec() : null;
      if (sp) chest = norm(A.svg(sp, { md: ["m1", "m100"] })) === norm(A.svg(sp, { md: ["m1"] }));
    } catch (e) { chest = "err " + e.message; }
    return { store: !!window.OLNU_STORE, txt, mineBeer: BEER.filter((k) => mine[k]), mineAll: Object.keys(mine),
      cards: BEER.filter((k) => body && body.querySelector('[data-md="' + k + '"]')), row, rowM10: /Tian|Tusen/.test(row), rowM1: /Första kapsylen/.test(row), chest,
      hidden: window.MEDALS.storeHidden ? BEER.map((k) => window.MEDALS.storeHidden(k)) : null };
  }, BEER);
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------- F5: web build keeps the medals ----------
    let { ctx, page, errs } = await open(browser, false);
    let w = await medals(page);
    ok("F5 web: OLNU_STORE off", w.store === false, w.store);
    ok("F5 web: MEDALS.mine() keeps m10 (beer count)", w.mineBeer.indexOf("m10") >= 0, w.mineAll);
    ok("F5 web: the uniform shows 'Tian' and the locked beer-count cards", /Tian/.test(w.txt) && /Logga 100 öl totalt/.test(w.txt) && w.cards.indexOf("m10") >= 0, w.txt.slice(0, 300));
    ok("F5 web: a ribbon row keeps m10 / m1000", w.rowM10 && w.rowM1, w.row.slice(0, 200));
    ok("F5 web: an avatar chest shows m100", w.chest === false, w.chest);
    ok("F5 web: storeHidden() is false for every beer-count medal", Array.isArray(w.hidden) && w.hidden.every((x) => x === false), w.hidden);
    await ctx.close();

    // ---------- F5: store build hides them everywhere ----------
    ({ ctx, page, errs } = await open(browser, true));
    const s = await medals(page);
    ok("F5 store: OLNU_STORE on", s.store === true, s.store);
    ok("F5 store: MEDALS.storeHidden() exists and hides all six", Array.isArray(s.hidden) && s.hidden.every((x) => x === true), s.hidden);
    ok("F5 store: MEDALS.mine() has no beer-count medal (the server sent m10)", s.mineBeer.length === 0 && s.mineAll.indexOf("m1") >= 0, s.mineAll);
    ok("F5 store: the uniform has no beer-count medal, earned or locked", !NAMES.test(s.txt) && s.cards.length === 0 && /Första kapsylen/.test(s.txt), { cards: s.cards, txt: s.txt.slice(0, 400) });
    ok("F5 store: a ribbon row drops m10 / m1000, keeps m1", !s.rowM10 && s.rowM1, s.row.slice(0, 200));
    ok("F5 store: an avatar chest drops m100 (same picture as without it)", s.chest === true, s.chest);
    // a member's uniform (member_medals mock: Oskar has m10, m50, m100)
    const mem = await page.evaluate(async () => {
      window.MEDALS.openMember({ id: "g-test" }, { name: "Oskar", is_me: false }, null);
      await new Promise((r) => setTimeout(r, 1500));
      const b = document.getElementById("sheet-body");
      return { txt: b ? b.innerText : "", cards: ["m10", "m50", "m100"].filter((k) => b && b.querySelector('[data-md="' + k + '"]')), b5: !!(b && b.querySelector('.medal.on[data-md="b5"]')) };
    });
    ok("F5 store: a member's uniform has no beer-count medal (Oskar: m10, m50, m100 from the server)", mem.cards.length === 0 && !/Tian|Femtiolappen|Hundringen/.test(mem.txt) && mem.b5, mem);
    await page.evaluate(() => { try { window.PN && window.PN.closeSheet ? window.PN.closeSheet() : document.querySelector("#sheet .sheet-close, #sheet-close") && document.querySelector("#sheet .sheet-close, #sheet-close").click(); } catch (e) {} });
    // new medal from the server: no toast for m100, a toast for n5 (proves toasts work here)
    const t = await page.evaluate(async () => {
      // every app toast goes through CALM.filter first (app-ui.js); medal toasts become CALM news, not a DOM toast
      const seen = [], C = window.CALM, f0 = C && C.filter;
      if (f0) C.filter = function (msg, o) { if (/medal-toast/.test((o && o.cls) || "")) seen.push(String(msg)); return f0.apply(this, arguments); };
      await window.MEDALS.claim("m100");
      await window.MEDALS.claim("n5");
      await new Promise((r) => setTimeout(r, 3000));
      if (f0) C.filter = f0;
      return { seen, mine100: !!(window.MEDALS.mine() || {}).m100, mineN5: !!(window.MEDALS.mine() || {}).n5 };
    });
    ok("F5 store: a new m100 gives no toast and no row in mine(); n5 still does", !t.seen.some((x) => /Hundringen/.test(x)) && !t.mine100 && t.mineN5 && t.seen.some((x) => /Nattpatrull/.test(x)), t);
    ok("F5 no page errors", errs.length === 0, errs);
    await ctx.close();

    // ---------- F4: radera.html ----------
    ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }));
    await page.goto(BASE + "radera.html");
    const vis = () => page.evaluate(() => {
      const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0).length;
      return { cls: document.body.className, text: document.body.innerText, d: shown(".when-direct"), s7: shown(".when-7d"),
        nd: document.querySelectorAll(".when-direct").length, n7: document.querySelectorAll(".when-7d").length };
    });
    const r1 = await vis();
    ok("F4 today (0402 not live): body del-direct, the direct text shows", r1.cls === "del-direct" && /Det sker direkt/.test(r1.text) && /immediate/.test(r1.text), r1.cls);
    ok("F4 today: the 7-day text exists but is hidden", r1.n7 >= 3 && r1.s7 === 0 && !/7 dagar|after 7 days/.test(r1.text), { n7: r1.n7, s7: r1.s7 });
    await page.evaluate(() => { document.body.className = "del-7d"; });
    const r2 = await vis();
    ok("F4 switch del-7d: only the 7-day text shows (Ångra, Radera direkt)", r2.s7 === r2.n7 && r2.d === 0 && /7 dagar/.test(r2.text) && /Ångra – behåll kontot/.test(r2.text) && !/Det sker direkt/.test(r2.text) && /after 7 days/.test(r2.text), { d: r2.d, s7: r2.s7 });
    await ctx.close();
  } catch (e) {
    fail++; console.log("FAIL exception", e && e.stack || e);
  } finally {
    await browser.close();
  }
  console.log(`\nstoreprep: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
