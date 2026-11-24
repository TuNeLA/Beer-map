// dbhealth-pw.js — lane dbhealth (24 Nov 2026, PLAN I-138 + B6; audit/logs1.md of 20 Nov).
// 1. Dead-tap watch sees buttons (pnlog-hooks.js): a button that does nothing → ux.dead with b: 1; a button that shows a toast → no
//    ux.dead; a press effect class on the button alone does not count as a reaction.
// 2. A missing server function (PGRST202) is asked once per page life (app-net.js rpcNet): the 2nd call makes no request.
// 3. group_keep_history: not asked for an event chat (g.ev, no members: not_member on live); a time-out is tried once more.
// 4. not_authenticated on driver_set / ride: the app's "signed out, connecting again" text (reauth), not "try again".
// 5. B6: Min kväll (nightlog.js) does not show a cached count from before the last ÖL!.
// 390 px, mocked Supabase. Usage: node dbhealth-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };
const GID = "11111111-2222-3333-4444-555555555555";

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await ctx.addInitScript(() => { try { localStorage.setItem("olnu.logMode", "on"); localStorage.setItem("olnu.logCons", "1"); } catch (e) {} });
  if (o.routes) await o.routes(page);
  await boot(page);
  return { ctx, page };
}
// a counter of real requests per RPC name (the page's own fetch, before the mock answers)
function countRpc(page) {
  const n = {};
  page.on("request", (q) => { const m = q.url().match(/\/rest\/v1\/rpc\/(\w+)/); if (m) n[m[1]] = (n[m[1]] || 0) + 1; });
  return n;
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    // ---------- 1. dead taps on buttons ----------
    {
      const { ctx, page } = await open(browser);
      await page.evaluate(() => {
        window.__ev = [];
        const P = window.PNLOG, o = P.event;
        P.event = function (n, p) { window.__ev.push([n, p]); return o.apply(P, arguments); };
        const mk = (id, top, fn) => {
          const b = document.createElement("button"); b.type = "button"; b.id = id; b.textContent = id;
          b.style.cssText = "position:fixed;left:20px;top:" + top + "px;width:120px;height:48px;z-index:99999";
          if (fn) b.addEventListener("click", fn);
          document.body.appendChild(b);
        };
        mk("dbh-dead", 140, null);
        mk("dbh-press", 200, function () { const b = this; b.classList.add("pn-press"); setTimeout(() => b.classList.remove("pn-press"), 120); });
        mk("dbh-live", 260, function () { window.PN && window.PN.toast ? window.PN.toast("dbh ok") : (document.getElementById("toasts") || document.body).appendChild(document.createElement("div")); });
      });
      await wait(page, 300);
      // the map, the ticker and timers can change the DOM in any 800 ms window (= "something reacted"): tap 3 times, 1 count is enough
      for (let i = 0; i < 3; i++) { await page.click("#dbh-dead"); await wait(page, 950); }
      for (let i = 0; i < 3; i++) { await page.click("#dbh-press"); await wait(page, 950); }
      for (let i = 0; i < 2; i++) { await page.click("#dbh-live"); await wait(page, 950); }
      await page.evaluate(() => window.PNLOG_HOOKS._sum(false));
      const dead = await page.evaluate(() => window.__ev.filter((e) => e[0] === "ux.dead").map((e) => e[1]));
      const by = (k) => dead.find((d) => d.k === k);
      ok("1a a button that does nothing is a dead tap (ux.dead, b: 1)", !!by("dbh-dead") && by("dbh-dead").b === 1 && by("dbh-dead").n >= 1, dead);
      ok("1b a press effect class alone is not a reaction", !!by("dbh-press"), dead);
      ok("1c a button that shows a toast is not a dead tap", !by("dbh-live"), dead);
      await ctx.close();
    }

    // ---------- 2. a missing function: one request per page life ----------
    {
      let hits = 0;
      const { ctx, page } = await open(browser, { routes: async (p) => {
        await p.route(/rest\/v1\/rpc\/dbh_gone_fn/, (r) => { hits++; r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function public.dbh_gone_fn without parameters in the schema cache" }) }); });
      } });
      const r = await page.evaluate(async () => {
        const a = await window.PN.rpc("dbh_gone_fn", {}); const b = await window.PN.rpc("dbh_gone_fn", {}); const c = await window.PN.rpc("dbh_gone_fn", {});
        return { a: a.error && a.error.code, b: b.error && b.error.code, bOff: !!b.off, c: c.error && c.error.code, miss: window.U.missing(b.error) };
      });
      ok("2a a missing function is asked once (3 calls = 1 request)", hits === 1, { hits, r });
      ok("2b the later calls get the same PGRST202 error at once (the module's missing check still works)", r.a === "PGRST202" && r.b === "PGRST202" && r.c === "PGRST202" && r.bOff && r.miss, r);
      await ctx.close();
    }
    {   // a "does not exist" error from inside a function is NOT a missing function: it keeps going to the server
      let hits = 0;
      const { ctx, page } = await open(browser, { routes: async (p) => {
        await p.route(/rest\/v1\/rpc\/dbh_bug_fn/, (r) => { hits++; r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "42P01", message: "relation \"x\" does not exist" }) }); });
      } });
      await page.evaluate(async () => { await window.PN.rpc("dbh_bug_fn", {}); await window.PN.rpc("dbh_bug_fn", {}); });
      ok("2c an error inside a function (42P01) is not remembered as missing", hits === 2, { hits });
      await ctx.close();
    }

    // ---------- 3. group_keep_history ----------
    {
      let keep = 0, fails = 1;
      const { ctx, page } = await open(browser, { routes: async (p) => {
        await p.route(/rest\/v1\/rpc\/group_keep_history/, (r) => {
          keep++;
          if (fails > 0) { fails--; return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "503", message: "upstream timeout" }) }); }
          r.fulfill({ status: 200, contentType: "application/json", body: "true" });
        });
      } });
      await page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ölkväll", ev: { group_id: gid, title: "Ölkväll", state: "open", can_write: true } }), "33333333-2222-3333-4444-555555555555");
      await wait(page, 1500);
      ok("3a an event chat does not ask group_keep_history (no members: not_member)", keep === 0, { keep });
      await ctx.close();
    }
    {   // its own page: the one failed answer must hit the group chat (not an event chat call of the old code)
      let keep = 0, fails = 1;
      const { ctx, page } = await open(browser, { routes: async (p) => {
        await p.route(/rest\/v1\/rpc\/group_keep_history/, (r) => {
          keep++;
          if (fails > 0) { fails--; return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "503", message: "upstream timeout" }) }); }
          r.fulfill({ status: 200, contentType: "application/json", body: "true" });
        });
      } });
      await page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), GID);
      await wait(page, 6000);
      const row = await page.evaluate(() => { const b = document.querySelector(".chat-keep"); return { has: !!b, hidden: b ? b.hidden : null, on: b ? b.querySelector(".chat-keep-cb").getAttribute("aria-checked") : null }; });
      ok("3b a group chat: a failed read is tried once more and the setting row shows", keep === 2 && row.has && row.hidden === false && row.on === "true", { keep, row });
      await ctx.close();
    }

    // ---------- 4. not_authenticated on an action ----------
    {
      const { ctx, page } = await open(browser, { routes: async (p) => {
        await p.route(/rest\/v1\/rpc\/driver_set/, (r) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "not_authenticated" }) }));
      } });
      // fixB P-01 (24 Nov): driver mode is refused while drinks are logged (the fixture has 6); this check is about the session text
      await page.evaluate(() => { if (window.LASK) window.LASK.drinksTonight = () => 0; document.querySelectorAll("#toasts .toast").forEach((x) => x.remove()); window.SKJUTS.setDriver(true, null); });
      await wait(page, 1200);
      const t = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" | "));
      ok("4 driver_set not_authenticated: the signed-out text, not 'try again'", /utloggad|signed out/i.test(t) && !/Försök igen/.test(t), t);
      await ctx.close();
    }

    // ---------- 5. B6: Min kväll follows the live count ----------
    {
      let nl = 0, drinks = 3;
      const { ctx, page } = await open(browser, { routes: async (p) => {
        await p.route(/rest\/v1\/rpc\/my_night_log/, (r) => {
          nl++;
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, now: new Date().toISOString(), night: new Date(Date.now() + 6 * 3600e3).toISOString(), evening: "", tonight: true, source: "log", items: [], nights: [],
            stats: { drinks, logged: drinks, beers: drinks, others: 0, kinds: {}, first_at: null, last_at: null, per_hour: null, bars: 0, checkins: 0, hours: [] } }) });
        });
      } });
      await wait(page, 500); const nl0 = nl;   // the app may read it once by itself at start
      const r = await page.evaluate(async () => {
        window.MYCOUNT.set(3);
        const a = await window.NIGHTLOG._load(null);
        window.MYCOUNT.set(4);   // an ÖL! was accepted: the app's count moved on
        return { a: a && a.stats.drinks };
      });
      drinks = 4;
      const b = await page.evaluate(async () => { const d = await window.NIGHTLOG._load(null); return d && d.stats.drinks; });
      const c = await page.evaluate(async () => { const d = await window.NIGHTLOG._load(null); return d && d.stats.drinks; });
      ok("5a Min kväll reads again after the count changed (no old 3 next to the new 4)", r.a === 3 && b === 4 && nl - nl0 === 2, { r, b, nl, nl0 });
      ok("5b with the same count the 30 s cache still works (no extra request)", c === 4 && nl - nl0 === 2, { c, nl, nl0 });
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack || e); }
  await browser.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
