// 🏠 Hem-läge (bd03, flag bold_hemlage). Mocked Supabase (ds-helpers). node bold-hem-pw.js <port> [shotsDir]
// Fake clock: Saturday 2026-11-08 01:40 Stockholm. Checks: the Ikväll menu row, verified taxi only (else a map search),
// the sober-friend row + Skjuts?, offline, back button, Hemfärd → Hem-läge, the once-a-night suggestion and its "never" rules,
// driving mode, tap targets, no horizontal scroll at 320 px, and flag OFF = the old Hemfärd sheet.
process.argv[2] = process.argv[2] || "8961";
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const pw = require("playwright");
const SHOTS = process.argv[3] || require("./env.js").OUT + "bold-shots/";
require("fs").mkdirSync(SHOTS, { recursive: true });
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const G = "11111111-2222-3333-4444-555555555555";
const T0 = new Date("2026-11-08T00:40:00Z");   // 01:40 in Stockholm (CET)
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const calls = [];
async function routes(page, flagOn) {
  await page.route(/rest\/v1\/rpc\/(bold_flags_get|my_groups|drivers_for|pickup_poll|ride_ask)$/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; calls.push(fn);
    switch (fn) {
      case "bold_flags_get": return J(r, { bold_hemlage: !!flagOn, bold_krog: false, bold_skal_v2: false, bold_replay: false, bold_bump: false });
      case "my_groups": return J(r, [{ id: G, name: "Ludvika Lager", code: "ABC234", member_count: 5, active_count: 3 }]);
      case "drivers_for": return J(r, { v: 1, drivers: [{ name: "Lisa", k: "k1", is_me: false }, { name: "Anton", k: "k0", is_me: true }] });
      case "pickup_poll": return J(r, { v: 1, driving: false, incoming: [], mine: null });
      case "ride_ask": return J(r, { v: 1, id: 5, kind: "skjuts", live: true, answers: [] });
    }
  });
}
async function start(browser, vp, flagOn) {
  const { ctx, page } = await ctxFor(browser, vp);
  await ctx.clock.install({ time: T0 });
  await routes(page, flagOn);
  await boot(page);
  await page.waitForFunction(() => window.BOLD && window.BOLD_HEM, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.BOLD.refresh()); await wait(page, 800);
  return { ctx, page };
}
const shot = (page, n) => page.screenshot({ path: SHOTS + "hem-" + n + ".png" });
const ovInfo = (page) => page.evaluate(() => {
  const o = document.getElementById("bh-ov"); if (!o) return null;
  const a = o.querySelector(".bh-taxi");
  return { title: o.querySelector(".bh-t").textContent, taxiHref: a && a.getAttribute("href"), taxiText: a && a.textContent,
    drv: [...o.querySelectorAll(".bh-drv")].map((x) => x.textContent), pri: o.querySelector(".bh-pri") && o.querySelector(".bh-pri").textContent,
    priDisabled: !!(o.querySelector(".bh-pri") && o.querySelector(".bh-pri").disabled), has112: !!o.querySelector('a.bh-112[href="tel:112"]'),
    btns: [...o.querySelectorAll(".bh-b, .bh-ask, .bh-112, .bh-x")].map((b) => ({ c: b.className, h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) })),
    hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
});
(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    /* ---------- flag ON ---------- */
    let { ctx, page } = await start(browser, { width: 390, height: 844 }, true);
    ok(await page.evaluate(() => window.BOLD.on("bold_hemlage")), "flag read from bold_flags_get");
    // 1. Ikväll chip menu → Hem-läge row (after 23:00)
    await page.evaluate(() => { const c = document.getElementById("pn-ikv2"); if (c) c.click(); }); await wait(page, 400);
    const row = await page.evaluate(() => { const r = [...document.querySelectorAll("#pn-ikm .pn-ikm-row")].find((x) => /Hem-läge/.test(x.textContent)); if (r) r.click(); return !!r; });
    ok(row, "Ikväll menu has a Hem-läge row");
    await wait(page, 1200);
    let i = await ovInfo(page);
    ok(i && i.title === "Hem nu?", "Hem-läge opens from the menu", i && i.title);
    // 2. Ludvika is verified (B2: taxidalarna.se) → its number (or the map search before the first fix), never another number
    ok(i && (i.taxiHref === "tel:+4624013900" || /google\.com\/maps\/search\/taxi/.test(i.taxiHref || "")), "Ludvika → Ludvikataxi or map search, no other number", i && i.taxiHref);
    // 3. sober friend row (Lisa, not me) + Skjuts?
    ok(i && i.drv.length === 1 && /Lisa kör ikväll/.test(i.drv[0]), "sober-friend row shows Lisa only", i && i.drv);
    ok(i && i.has112, "Ring 112 is a tel:112 link");
    // 4. targets + layout
    const small = (i ? i.btns : []).filter((b) => (/bh-b/.test(b.c) && b.h < 56) || (/bh-ask|bh-x|bh-112/.test(b.c) && b.h < 44));
    ok(i && !small.length, "tap targets: rows ≥ 56, buttons ≥ 44", small);
    const prim = await page.evaluate(() => { const b = document.querySelector("#bh-ov .bh-pri"); return b ? Math.round(b.getBoundingClientRect().top) : -1; });
    ok(prim > 844 / 3, "main button in the lower two thirds (thumb zone)", prim);
    await shot(page, "1-open");
    await page.evaluate(() => { const b = document.querySelector("#bh-ov .bh-ask"); if (b) b.click(); }); await wait(page, 1500);
    ok(calls.includes("ride_ask"), "Skjuts? sends ride_ask");
    // a sheet is open (e.g. the Skjuts? answer sheet) → Hem-läge waits for it to close and then stays open
    await page.evaluate(() => { window.BOLD_HEM.close(); window.BOLD.api().openSheet("Test", (b) => { b.textContent = "x"; }); }); await wait(page, 700);
    await page.evaluate(() => window.BOLD_HEM.open({})); await wait(page, 1500);
    ok(!!(await page.$("#bh-ov")) && !(await page.evaluate(() => window.BOLD.api().sheetOpen())), "opens over an open sheet and stays open");
    // 5. verified towns → tel: links
    for (const [lat, lng, tel, n] of [[60.1511, 15.1876, "tel:+4624013900", "Ludvika"], [60.4858, 15.4371, "tel:+4624313100", "Borlänge"], [59.3293, 18.0686, "tel:+468150000", "Stockholm"]]) {
      await page.evaluate(([a, b]) => { window.BOLD_HEM.close(); window.BOLD.api().setLastLoc(a, b); window.BOLD_HEM.open({}); }, [lat, lng]); await wait(page, 600);
      i = await ovInfo(page); ok(i && i.taxiHref === tel, "verified taxi for " + n, i && i.taxiHref);
    }
    await shot(page, "2-stockholm");
    // 5b. a town with no verified number (Östersund) → map search, never a number (B2)
    await page.evaluate(() => { window.BOLD_HEM.close(); window.BOLD.api().setLastLoc(63.1792, 14.6357); window.BOLD_HEM.open({}); }); await wait(page, 600);
    i = await ovInfo(page);
    ok(i && /google\.com\/maps\/search\/taxi/.test(i.taxiHref || "") && /Hitta taxi/.test(i.taxiText || ""), "no verified town → map search", i && i.taxiHref);
    await page.evaluate(() => { window.BOLD_HEM.close(); window.BOLD.api().setLastLoc(59.3293, 18.0686); window.BOLD_HEM.open({}); }); await wait(page, 600);
    // 6. offline → Följ mig hem grey, taxi + 112 still there
    await ctx.setOffline(true); await wait(page, 500);
    i = await ovInfo(page);
    ok(i && i.priDisabled && /Ingen täckning/.test(i.pri) && i.taxiHref && i.has112, "offline: Följ mig hem grey, taxi + 112 work", i && i.pri);
    await shot(page, "3-offline");
    await ctx.setOffline(false); await wait(page, 300);
    // 7. back button closes it, ✕ closes it
    await page.goBack().catch(() => {}); await wait(page, 600);
    ok(!(await page.$("#bh-ov")), "back button closes Hem-läge");
    await page.evaluate(() => window.BOLD_HEM.open({})); await wait(page, 400);
    await page.click("#bh-ov .bh-x"); await wait(page, 500);
    ok(!(await page.$("#bh-ov")), "✕ closes Hem-läge");
    // 8. Hemfärd (oppet.js) opens Hem-läge when the flag is on
    await page.evaluate(() => window.OPPET.hudClick("aio-close")); await wait(page, 800);
    ok(!!(await page.$("#bh-ov")), "Hemfärd → Hem-läge");
    await page.evaluate(() => window.BOLD_HEM.close()); await wait(page, 400);
    // 9. suggestion once per night (01:40, out tonight: seeded check-in)
    await page.evaluate(() => { localStorage.removeItem("olnu.bhSug"); window.BOLD.api().setLastLoc(60.14997, 15.18679); window.BOLD_HEM._suggest(); }); await wait(page, 600);
    ok(!!(await page.$(".bh-sug")), "suggestion card shows at 01:40", await page.evaluate(() => window.BOLD_HEM._state()));
    await shot(page, "4-suggest");
    await page.click(".bh-sug .bh-sug-no"); await wait(page, 400);
    await page.evaluate(() => window.BOLD_HEM._suggest()); await wait(page, 400);
    ok(!(await page.$(".bh-sug:not(.bh-out)")), "Inte nu = not again tonight");
    // 10. never in the home zone / when driving / when Ikväll = Hemma
    await page.evaluate(() => { localStorage.removeItem("olnu.bhSug"); localStorage.setItem("olnu.home", JSON.stringify({ lat: 60.14997, lng: 15.18679, r: 300, at: Date.now() })); });
    ok((await page.evaluate(() => window.BOLD_HEM._state().blocked)) === "home", "blocked in the home zone");
    await page.evaluate(() => { localStorage.removeItem("olnu.home"); window.SKJUTS.driving = () => true; });
    ok((await page.evaluate(() => window.BOLD_HEM._state().blocked)) === "driving", "blocked when Jag kör is on");
    await page.evaluate(() => window.BOLD_HEM.open({})); await wait(page, 500);
    i = await ovInfo(page);
    ok(i && i.title === "Kör försiktigt" && !i.taxiHref && i.has112, "driving mode: no taxi, 112 stays", i);
    await shot(page, "5-driving");
    await ctx.close();
    /* ---------- 320 px, no horizontal scroll ---------- */
    ({ ctx, page } = await start(browser, { width: 320, height: 640 }, true));
    await page.evaluate(() => window.BOLD_HEM.open({})); await wait(page, 800);
    i = await ovInfo(page);
    const ovw = await page.evaluate(() => { const o = document.querySelector("#bh-ov .bh-box"); return o ? o.scrollWidth - o.clientWidth : -1; });
    ok(i && !i.hscroll && ovw <= 0, "320 px: no horizontal scroll", { h: i && i.hscroll, ovw });
    await shot(page, "6-320");
    await ctx.close();
    /* ---------- flag OFF = old behaviour ---------- */
    ({ ctx, page } = await start(browser, { width: 390, height: 844 }, false));
    ok((await page.evaluate(() => window.BOLD_HEM.open({}))) === false, "flag off: open() returns false");
    await page.evaluate(() => window.OPPET.hudClick("aio-close"));
    await page.waitForFunction(() => { const t = document.getElementById("sheet-title"); return t && /Hemfärd/.test(t.textContent); }, null, { timeout: 5000 }).catch(() => {});
    const title = await page.evaluate(() => { const t = document.getElementById("sheet-title"); return t ? t.textContent : ""; });
    ok(/Hemfärd/.test(title) && !(await page.$("#bh-ov")), "flag off: the old Hemfärd sheet", title);
    await page.evaluate(() => { const s = document.getElementById("sheet-close"); if (s) s.click(); }); await wait(page, 400);
    await page.evaluate(() => { const c = document.getElementById("pn-ikv2"); if (c) c.click(); }); await wait(page, 400);
    ok(!(await page.evaluate(() => [...document.querySelectorAll("#pn-ikm .pn-ikm-row")].some((x) => /Hem-läge/.test(x.textContent)))), "flag off: no Hem-läge row");
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e.message); }
  await browser.close();
  console.log(`bold-hem: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
