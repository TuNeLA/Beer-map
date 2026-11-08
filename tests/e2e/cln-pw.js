// cln checks: node cln-pw.js <port>. 1) VITALS sends only when PNLOG usage log is on. 2) Nytt dates from game_launch_dates.
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const PORT = process.argv[2]; let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, x === undefined ? "" : JSON.stringify(x)); } };
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  // 1. vitals
  const cases = [["on", null, null, true], ["off", null, null, false], ["none", null, null, false], ["optin", null, null, false],
    ["optin", "1", null, true], ["on", null, "0", false]];
  for (const [mode, cons, ev, want] of cases) {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript((a) => { localStorage.setItem("olnu.logMode", a[0]); if (a[1]) localStorage.setItem("olnu.logCons", a[1]); if (a[2]) localStorage.setItem("olnu.logEv", a[2]); }, [mode, cons, ev]);
    let n = 0; await page.route(/rpc\/report_vitals/, (r) => { n++; r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
    await page.route(/rpc\/pnlog_ingest/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode }) }));
    await boot(page, { clean: true }); await page.waitForFunction(() => window.VITALS && window.PNLOG, null, { timeout: 60000 }).catch(() => {}); await wait(page, 3000);
    const st = await page.evaluate(() => { window.VITALS._send(); return window.PNLOG && window.PNLOG.state(); });
    await wait(page, 4000);
    ok((n > 0) === want, `vitals mode=${mode} cons=${cons} ev=${ev} → ${want ? "sent" : "not sent"}`, { n, full: st && st.full });
    await ctx.close();
  }
  // 2. Nytt badges
  const today = new Date().toISOString().slice(0, 10);
  for (const [name, answer, cache, wantKort, wantVem] of [
    ["fallback (server empty)", [], null, Date.now() - Date.parse("2026-11-07") < 14 * 864e5, Date.now() - Date.parse("2026-11-07") < 14 * 864e5],
    ["server dates win", { v: 1, games: { kort: today, vem: "2020-01-01" } }, null, true, false],
    ["cache used, no ask", null, { at: Date.now(), games: { kort: "2020-01-01", vem: today } }, false, true]]) {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    if (cache) await ctx.addInitScript((c) => localStorage.setItem("olnu.spLaunch", JSON.stringify(c)), cache);
    let asked = 0; await page.route(/rpc\/game_launch_dates/, (r) => { asked++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }); });
    await boot(page, { clean: true }); await wait(page, 1000);
    await page.waitForFunction(() => window.SPEL && window.VITALS, null, { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => window.SPEL.open(null)); await page.waitForSelector(".sp-card[data-g]", { timeout: 60000 }).catch(() => {}); await wait(page, 5000);
    const tags = await page.evaluate(() => [...document.querySelectorAll(".sp-card[data-g]")].filter((c) => [...c.querySelectorAll(".sp-tag")].some((t) => t.textContent === "Nytt")).map((c) => c.getAttribute("data-g")));
    ok(tags.includes("kort") === wantKort && tags.includes("vem") === wantVem, "nytt: " + name, { tags, asked });
    if (cache) ok(asked === 0, "nytt: fresh cache = no server call", asked); else ok(asked === 1, "nytt: one server call", asked);
    if (answer && answer.games) ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem("olnu.spLaunch") || "null")), "nytt: answer cached");
    await ctx.close();
  }

  // 3. rpc_bundle + not_member + medals throttle
  const apiHook = () => { let v; Object.defineProperty(window, "VITALS", { configurable: true, get() { return v; }, set(x) { const i = x.init; x.init = function (api) { window.__api = api; return i.apply(this, arguments); }; v = x; } }); };
  const BN = ["game_poll", "gang_poll", "skal_poll", "film_poll", "ceremony_poll", "walk_poll", "my_invites", "helg_state", "my_status", "my_inbox", "my_dms", "pickup_poll", "safety_state"];
  for (const live of [true, false]) {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript(apiHook);
    const cnt = {}; let bundles = 0, bnames = [];
    page.on("request", (q) => { const m = q.url().match(/rpc\/(\w+)/); if (m) cnt[m[1]] = (cnt[m[1]] || 0) + 1; });
    if (live) await page.route(/rpc\/rpc_bundle2/, (r) => { bundles++; const b = JSON.parse(r.request().postData() || "{}"); bnames = bnames.concat((b.p_calls || []).map((c) => c.n)); const o = {}; (b.p_calls || []).forEach((c) => { o[c.k] = c.n === "gang_poll" ? { e: { message: "slow_down", code: "P0001" } } : { d: /^(my_rallies|bar_status|medevac_checks|group_etas|beer_reactions|home_status|friend_totals|ghost_points2)$/.test(c.n) ? [] : { v: 1, n: c.n } }; }); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) }); });
    else await page.route(/rpc\/rpc_bundle2/, (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function public.rpc_bundle2" }) }));   // old server
    await boot(page, { clean: true }); await wait(page, 4000);
    const res = await page.evaluate(async () => { const A = window.__api; const a = await Promise.all([A.rpc("game_poll"), A.rpc("gang_poll"), A.rpc("my_dms", {}), A.rpc("my_groups", {})]); return { a: a.map((r) => ({ d: r.data, e: r.error && r.error.message })), st: A.bundleStats && A.bundleStats() }; });
    const alone = BN.filter((n) => cnt[n]).map((n) => n + ":" + cnt[n]);
    if (live) {
      ok(bundles >= 1 && res.a[0].d && res.a[0].d.n === "game_poll" && res.a[1].e === "slow_down" && res.a[2].d.n === "my_dms", "bundle: one request, each caller its own answer / error", { bundles, a: res.a.slice(0, 3), st: res.st });
      ok(bnames.length >= 2, "bundle: start-up polls went in the bundle", { bnames });
      ok(cnt.my_groups >= 1, "bundle: other RPCs still go alone", cnt.my_groups);
    } else {
      ok(res.a[0].d !== undefined && !res.a[0].e && (cnt.game_poll || 0) >= 1, "bundle: no rpc_bundle on the server = every call alone", { alone, st: res.st });
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript(apiHook);
    let n = 0; await page.route(/rpc\/group_keep_history/, (r) => { n++; r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "not_member" }) }); });
    await boot(page, { clean: true }); await wait(page, 1500);
    const r = await page.evaluate(async () => { const A = window.__api, g = "99999999-2222-3333-4444-555555555555"; const a = await A.rpc("group_keep_history", { p_group_id: g }); const b = await A.rpc("group_keep_history", { p_group_id: g }); return [a.error && a.error.message, b.error && b.error.message, b.error && b.error.quiet]; });
    ok(n === 1 && r[0] === "not_member" && r[1] === "not_member" && r[2] === true, "not_member: asked once, then answered without network", { n, r });
    await ctx.close();
  }
  for (const [name, at, want] of [["medals: fresh award time = no call at open", Date.now() - 60000, 0], ["medals: old award time = one call", Date.now() - 7 * 3600e3, 1]]) {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript((t) => { localStorage.setItem("olnu.medalsAt", String(t)); localStorage.setItem("olnu.medalsSeeded", "1"); }, at);
    let n = 0; await page.route(/rpc\/award_medals/, (r) => { n++; r.fulfill({ status: 200, contentType: "application/json", body: "[]" }); });
    await boot(page); await wait(page, 6000);
    const first = n, ci = await page.evaluate(() => localStorage.getItem("olnu.medalsCi"));
    if (want) ok(n >= 1 && n <= 2, name, n);
    else {   // the mock has my check-in: the first sight of a check-in on this phone awards once; a reload does not
      ok(n <= 1 && (n === 0 || !!ci), name + " (max 1: new check-in key)", { n, ci });
      n = 0; await page.reload(); await wait(page, 8000);
      ok(n === 0, "medals: reload with the same check-in = no call", n);
    }
    await ctx.close();
  }
  console.log(`cln: ${pass} pass, ${fail} fail`);
  await browser.close();
})();
