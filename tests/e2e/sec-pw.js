// lane sec (X3 finding H-2, 10 Nov 2026): turning on Spöke must also hide what the server already shows —
// the pin (stop_beer) and the check-in (check_out). Before: Spöke only set localStorage, so a check-in made before
// the switch stayed on friends' maps with the name until the morning ("Ingen ser dig" was not true).
// usage: node sec-pw.js <port>      Mocked Supabase (ds-helpers). No browser state is kept.
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const { wait } = H;
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 300))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });

(async () => {
  const browser = await chromium.launch(require("./env.js").CHROME ? { executablePath: require("./env.js").CHROME } : {});
  try {
    const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
    const calls = [];
    await page.route(/rest\/v1\/rpc\/(my_visibility|set_visibility)\b/, (r) => J(r, { v: 1, friends_only: false }));
    await page.route(/rest\/v1\/rpc\/(stop_beer|check_out)\b/, (r) => {
      const fn = (r.request().url().match(/rpc\/(\w+)/) || [])[1]; calls.push(fn);
      return J(r, fn === "check_out" ? { ok: true, bar_id: "x", bar_name: "Krogen" } : null);
    });
    await H.boot(page);
    ok(await page.evaluate(() => !!(window.PNVIS && window.PNVIS.setMode)), "PNVIS.setMode exists");

    calls.length = 0;
    await page.evaluate(() => window.PNVIS.setMode("spoke")); await wait(page, 1500);
    ok(calls.includes("stop_beer"), "Spöke on → stop_beer (the pin leaves the map)", calls);
    ok(calls.includes("check_out"), "Spöke on → check_out (the check-in leaves friends' maps)", calls);
    ok(await page.evaluate(() => localStorage.getItem("olnu.ghostMode")) === "1", "Spöke on → olnu.ghostMode = 1 (unchanged)");

    calls.length = 0;
    await page.evaluate(() => window.PNVIS.setMode("alla")); await wait(page, 1200);
    ok(calls.length === 0, "Alla again → no stop_beer / check_out", calls);
    calls.length = 0;
    await page.evaluate(() => window.PNVIS.setMode("vanner")); await wait(page, 1200);
    ok(calls.length === 0, "Bara vänner → no stop_beer / check_out (friends still see you)", calls);
    await ctx.close();
  } finally { await browser.close(); }
  console.log(`sec-pw: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
