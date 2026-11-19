// lane ciwork (E10 = I-111): the "press play" self-test in the TEST build (testenv/testbar.js, only in pintsnow-beta /test/).
// The page here is built like the /test/ build (pintsnow-beta beta/transform.py --mode staging): testenv.js first, test.js
// (window.PN_TEST), testbar.js before the app, testbar.css. Supabase is mocked (ds-helpers), so "staging" = the served config.
//   usage: node selftest-pw.js <port>
// Checks: 1. the panel has "Kör självtest"; one tap runs the walk and every row is OK (beer saved, 5 sheets open + close,
// no page errors, no failed calls); 2. a page error during the walk makes the list FAIL and names it; 3. a build that is
// not on staging stops at row 1 and never sends a beer; 4. the live app (docs/) has no self-test or test panel.
const { ctxFor, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const PORT = process.argv[2] || 8793, BASE = `http://127.0.0.1:${PORT}/`;
const ROOT = path.join(__dirname, "..", ".."), TE = path.join(ROOT, "testenv");
const OUT = require("./env.js").OUT;
const STAGING = "vdtmzsxajpvzwwbhnfmr", LIVE = "wcdskpcevbhouvbytkhv";
let pass = 0, fail = 0;
const ok = (c, n, i) => { console.log(c ? "PASS" : "FAIL", n, c || i === undefined ? "" : JSON.stringify(i).slice(0, 600)); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });

async function testPage(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  const errs = [], beers = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("request", (q) => { const m = q.url().match(/rpc\/(post_beer\w*)/); if (m) beers.push(m[1]); });
  // the test build's own storage: copy the seeded keys to the pnt1: prefix (testenv.js swaps localStorage), then testenv.js + test.js
  await ctx.addInitScript(() => { try { const ks = []; for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i));
    ks.forEach((k) => { if (k.indexOf("pnt") !== 0 && !localStorage.getItem("pnt1:" + k)) localStorage.setItem("pnt1:" + k, localStorage.getItem(k)); }); } catch (e) {} });
  await ctx.addInitScript({ content: fs.readFileSync(path.join(TE, "testenv.js"), "utf8") });
  await ctx.addInitScript((ref) => { window.PN_BETA = "e2e"; window.PN_TEST = { ref, sha: "e2e" }; }, o.ref || STAGING);
  if (o.init) await ctx.addInitScript(o.init);
  await page.route(/rest\/v1\/rpc\/zz_test_\w+/, (r) => J(r, { ok: true, groups: [], mates: [], flags: {} }));
  await page.route(/\/js\/testbar\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(path.join(TE, "testbar.js"), "utf8") }));
  await page.route(/\/testbar\.css(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: fs.readFileSync(path.join(TE, "testbar.css"), "utf8") }));
  await page.route((u) => u.href === BASE || u.href === BASE + "index.html", async (r) => {
    const res = await r.fetch(); let s = await res.text();
    s = s.replace(/(<script\b[^>]*\bsrc="\.\/(?:js\/app-core|app)\.js)/, '<script defer src="./js/testbar.js"></script>\n$1').replace("</head>", '<link rel="stylesheet" href="./testbar.css">\n</head>');
    const hd = { ...res.headers(), "content-type": "text/html; charset=utf-8" }; delete hd["content-length"]; delete hd["content-encoding"];
    return r.fulfill({ status: res.status(), body: s, headers: hd });
  });
  await page.goto(BASE);
  await page.waitForFunction(() => window.PNTESTBAR && document.querySelector(".tb") && window.PN && window.PN.s && window.PN.s.firstLoadDone === true, null, { timeout: 30000 }).catch(() => {});
  await wait(page, 4500);   // past the app's 4 s calm window (calm.js): a sheet asked for before it opens late
  return { ctx, page, errs, beers };
}
const play = async (page) => {
  const b = await page.evaluate(() => { const x = [...document.querySelectorAll(".tb .tb-b")].find((e) => /Kör självtest/.test(e.textContent)); if (x) x.click(); return !!x; });
  if (!b) return null;
  await page.waitForFunction(() => document.querySelector(".tb[data-st]"), null, { timeout: 150000 }).catch(() => {});
  return page.evaluate(() => ({ st: document.querySelector(".tb").getAttribute("data-st"), sum: (document.querySelector(".tb-st-sum") || {}).textContent,
    rows: [...document.querySelectorAll(".tb-st li")].map((li) => [li.className === "tb-st-ok", li.textContent]) }));
};

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* 1. one tap: every row OK */
    {
      const { ctx, page, errs, beers } = await testPage(browser);
      const r = await play(page);
      ok(!!r, "E10 the test panel has a 'Kör självtest' button", r);
      if (r) {
        ok(r.st === "pass" && r.rows.length === 11 && r.rows.every((x) => x[0]), "E10 one tap: 11 rows, all OK (staging, app, account, ÖL!, 5 sheets, page errors, server calls)", r);
        ok(beers.length === 1, "E10 the walk sent exactly one beer (post_beer*)", beers);
        ok(r.rows.filter((x) => /^✅ Öppnar /.test(x[1])).length === 5, "E10 the 5 main sheets opened and closed", r.rows.map((x) => x[1]));
        ok(/\d+ av \d+ OK · \d+ s/.test(r.sum || ""), "E10 the summary line says 'N av N OK · T s'", r.sum);
        ok(await page.evaluate(() => !document.getElementById("sheet") || document.getElementById("sheet").hidden), "E10 no sheet is left open after the walk");
        await page.evaluate(() => window.PNTESTBAR.open()); await wait(page, 400);
        await page.screenshot({ path: OUT + "selftest-pass-390.png" }).catch(() => {});
      }
      ok(!errs.length, "E10 no page error in the run", errs);
      await ctx.close();
    }
    /* 2. a page error during the walk = a red row that names it */
    {
      const { ctx, page } = await testPage(browser, { init: () => document.addEventListener("click", (e) => {
        if (e.target && e.target.closest && e.target.closest("#btn-groups")) setTimeout(() => { throw new Error("selftest-probe-error"); }, 0); }, true) });
      const r = await play(page);
      const row = r && r.rows.find((x) => /Inga sidfel/.test(x[1]));
      ok(!!(r && r.st === "fail" && row && !row[0] && /selftest-probe-error/.test(row[1])), "E10 a page error during the walk: 'Inga sidfel' is red and names the error", r);
      ok(!!(r && /^❌/.test(r.sum || "")), "E10 the summary is red when a row fails", r && r.sum);
      await ctx.close();
    }
    /* 3. not on staging: stop at row 1, no beer */
    {
      const { ctx, page, beers } = await testPage(browser, { ref: LIVE });
      const r = await play(page);
      ok(!!(r && r.rows[0] && !r.rows[0][0] && /INTE staging/.test(r.rows[0][1]) && !r.rows.some((x) => /ÖL!/.test(x[1]))), "E10 not staging: row 1 is red, the walk stops (no ÖL! row)", r);
      ok(beers.length === 0, "E10 not staging: no beer is sent", beers);
      await ctx.close();
    }
    /* 4. the live app has no self-test */
    {
      const hits = [];
      (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p); else if (/\.(html|js|css|json)$/.test(f.name) && /testbar|testenv\.js|Kör självtest|PNTESTBAR/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(ROOT, p)); } })(path.join(ROOT, "docs"));
      ok(hits.length === 0, "E10 docs/ (the live app) has no test panel and no self-test", hits);
    }
  } catch (e) { console.log("ERROR", e && e.stack || e); fail++; }
  await browser.close();
  console.log(`SUMMARY selftest ${pass} PASS ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
