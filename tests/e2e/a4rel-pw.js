// lane a4rel (12 Nov): I-25 idle-only reload, I-24 moments push-link race. Usage: node a4rel-pw.js <port>
// (I-19 push dedupe + text: tests/unit/pushdev.test.mjs, no browser.)
const { ctxFor, boot, wait, GID } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 500))); c ? pass++ : fail++; };
const soon = (m) => new Date(Date.now() + m * 60e3).toISOString();
const ME = "aaaaaaaaaaaa", OS = "bbbbbbbbbbbb";
const ROUND = { id: 103, kind: "bord", q: "", phase: "open", opts: [], bar_name: "Pitchers", mission: 3, n_who: 3, group_id: GID, group_name: "Ludvika Lager", me: ME, asked: true,
  names: { [ME]: "Anton", [OS]: "Oskar" }, n_picks: 0, picks: null, answer: null, mine: null, closes_at: soon(50), reveal_at: null, agent_me: false, host_me: false, agent_k: null, done_at: null, done_by: null, night: soon(400) };

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* I-25: controllerchange while a sheet is open -> no reload, a button; idle -> reload at once; the button reloads */
    try {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { empty: true });
      await boot(page); await wait(page, 2500);
      const fire = () => page.evaluate(() => { window.__mark = 1; const s = navigator.serviceWorker; s.dispatchEvent(new Event("controllerchange")); s.dispatchEvent(new Event("controllerchange")); });
      await page.evaluate(() => { document.getElementById("sheet").hidden = false; });
      await fire(); await wait(page, 1500);
      let r = await page.evaluate(() => ({ mark: window.__mark, btn: (document.getElementById("pn-newver") || {}).textContent || "" }));
      ok("I-25 sheet open: no reload, the button 'Ny version – tryck för att ladda om' shows", r.mark === 1 && /Ny version – tryck för att ladda om/.test(r.btn), r);
      await page.evaluate(() => { document.getElementById("sheet").hidden = true; });
      await wait(page, 6500);
      r = await page.evaluate(() => ({ mark: window.__mark }));
      ok("I-25 sheet closed later: still no timer reload (the user decides)", r.mark === 1, r);
      const nav = page.waitForNavigation({ timeout: 8000 }).then(() => true, () => false);
      await page.evaluate(() => document.getElementById("pn-newver").click());
      ok("I-25 the button reloads the page", await nav);
      await boot(page); await wait(page, 2000);
      const nav2 = page.waitForNavigation({ timeout: 8000 }).then(() => true, () => false);
      await fire();
      ok("I-25 idle: reloads at once", await nav2);
      await ctx.close();
    } catch (e) { ok("I-25 section ran without error", false, String(e)); }
    /* I-24: a poll in flight, then the push link message: the card opens after that poll */
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { empty: true });
      let delay = 0;
      await page.route(/rest\/v1\/rpc\/(after_flags_get|moments_poll|party_group|moments_report)\b/, async (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1];
        if (fn === "after_flags_get") return J(r, { v: 1, flags: { moments: true, push_ev: false } });
        if (fn === "moments_poll") { if (delay) await new Promise((f) => setTimeout(f, delay)); return J(r, { v: 1, on: true, opened: 0, rounds: [ROUND] }); }
        if (fn === "moments_report") return J(r, { v: 1, rounds: [] });
        return J(r, { v: 1, room: null });
      });
      await boot(page); await wait(page, 4000);
      delay = 1500;
      await page.evaluate(() => { window.MOMENTS.poll(); setTimeout(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "olnu-open", url: "/?mom=103" } })), 100); });
      await page.waitForFunction(() => document.querySelector('.mo[data-mo="103"]'), null, { timeout: 7000 }).catch(() => {});
      const r = await page.evaluate(() => ({ card: !!document.querySelector('.mo[data-mo="103"]') }));
      ok("I-24 push link while a poll is in flight opens the card", r.card, r);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
