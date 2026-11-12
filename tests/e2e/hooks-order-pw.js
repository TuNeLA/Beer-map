// A2: module hook order. Usage: node hooks-order-pw.js <port>
// The real app (mocked Supabase): PN.hookNames() = the frozen 85-name list (fixture), PN.hookList() = window[name] in that
// order, and the first 85 names stay in the same place when a module registers itself late.
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { ctxFor, boot } = require("./ds-helpers.js");
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 600))); c ? pass++ : fail++; };
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, "../unit/fixtures/hook-order-base.json"), "utf8"));
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  const r = await page.evaluate(() => {
    var names = PN.hookNames(), list = PN.hookList();
    return { names: names, same: list.every(function (m, i) { return m === window[names[i]]; }), len: list.length, set: list.filter(Boolean).length, dialekt: !!window.DIALEKT };
  });
  ok("PN.hookNames starts with the 85 frozen names", JSON.stringify(r.names.slice(0, BASE.length)) === JSON.stringify(BASE), r.names.length);
  ok("hookList = window[name] in order", r.same && r.len === r.names.length);
  ok("most modules are set (" + r.set + ")", r.set > 60, r.set);
  ok("no page errors", errs.length === 0, errs);
  await ctx.close(); await browser.close();
  console.log(`hooks-order: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
