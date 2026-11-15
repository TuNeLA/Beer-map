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
    /* I-25 (12 Nov) is replaced by I-107 (14 Nov, lane start1): a new version never reloads the page in use and there is no
       "Ny version" button on the map. The new flow is tested in start1-pw.js (U1-U10). Here: a controllerchange in use = no reload. */
    try {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { empty: true });
      await boot(page); await wait(page, 2500);
      let navs = 0; page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs++; });
      await page.evaluate(() => { window.__mark = 1; navigator.serviceWorker.dispatchEvent(new Event("controllerchange")); });
      await wait(page, 3000);
      const r = await page.evaluate(() => ({ mark: window.__mark, btn: !!document.getElementById("pn-newver") }));
      ok("I-107 controllerchange while the app is in use: no reload, no 'Ny version' button", r.mark === 1 && navs === 0 && !r.btn, { r, navs });
      await ctx.close();
    } catch (e) { ok("I-107 section ran without error", false, String(e)); }
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
