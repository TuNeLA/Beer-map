// 🔔 NOTISKOLL Playwright test (mocked server, 412x915). Usage: node notif-pw.js <port>
// A) ⚙️ settings: 8 kind switches, nattro, max per kväll → set_push_prefs. B) blocked permission → help text.
// C) ?focus=<friend pin>&act=skal → skål + toast, act removed from URL. D) &act=coming → notify-group {event:"coming"}.
// E) push tap while open: ?helg=1 → helgstreak sheet; ?focus&act=coming via routeOpen.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8855, BASE = `http://127.0.0.1:${PORT}/`;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 300))); c ? pass++ : fail++; };
const PREFS = { v: 1, off: [], quiet_from: null, quiet_to: null, cap: 0, cap_default: 15, cats: ["ute", "chat", "dm", "plan", "kaos", "bar", "kul", "vanner"], tonight: 3 };
async function extra(page, log) {
  await page.addInitScript(TOASTLOG);
  await page.route(/rest\/v1\/rpc\/(my_push_prefs|set_push_prefs|skal|skal_v2|helg_status|my_helg)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    log.push([fn, body]);
    if (fn === "my_push_prefs") return J(r, PREFS);
    if (fn === "set_push_prefs") return J(r, { ...PREFS, off: body.p_off, quiet_from: body.p_quiet_from, quiet_to: body.p_quiet_to, cap: body.p_cap });
    if (fn === "skal" || fn === "skal_v2") return J(r, { skal_count: 5, already: false });
    return r.fallback();
  });
  await page.route(/functions\/v1\/notify-group/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} log.push(["fn", b]); return J(r, b.event === "coming" ? { sent: 1, failed: 0 } : {}); });
}
const toasts = (page) => page.evaluate(() => (window.__toasts || []).join(" | "));
const TOASTLOG = () => { const go = () => { const b = document.getElementById("toasts"); if (!b) return setTimeout(go, 200);
  window.__toasts = []; new MutationObserver((m) => m.forEach((x) => x.addedNodes.forEach((n) => n.textContent && window.__toasts.push(n.textContent)))).observe(b, { childList: true }); };
  document.addEventListener("DOMContentLoaded", go); };
async function openSettings(page) {
  await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 900);
  await page.evaluate(() => { const t = [...document.querySelectorAll(".pf-tabs button, .tabs button")].find((b) => /Inställningar/.test(b.textContent)); if (t) t.click(); });
  await wait(page, 1200);
  await page.evaluate(() => { const b = document.querySelector("#sheet-body .set-r-notis"); if (b) b.click(); }); await wait(page, 600);   // d1settings hub (setfix): page Notiser & ljud
}
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  const vp = { width: 412, height: 915 };
  try {
    { // A) settings
      const log = []; const { ctx, page } = await ctxFor(browser, vp); await extra(page, log);
      await boot(page); await openSettings(page);
      await page.waitForSelector(".push-prefs:not([hidden])", { timeout: 6000 }).catch(() => {});
      // pnds: the notification types fold behind "Välj notiser" (owner #5 shorter Inställningar): open it first
      await page.waitForSelector(".pn-fold-row", { timeout: 6000 }).catch(() => {});
      await page.evaluate(() => { const r = document.querySelector(".pn-fold-row"); if (r && r.getAttribute("aria-expanded") !== "true") r.click(); }); await page.waitForTimeout(400);
      const n = await page.evaluate(() => document.querySelectorAll(".push-prefs .switch[data-kind]").length);
      ok("⚙️ shows 8 kind switches", n === 8, n);
      ok("all on by default", await page.evaluate(() => [...document.querySelectorAll(".push-prefs .switch")].every((s) => s.getAttribute("aria-checked") === "true")));
      ok("tonight count shown", await page.evaluate(() => /Ikväll: 3 st/.test(document.querySelector(".push-prefs").textContent)));
      await page.evaluate(() => document.querySelector('.push-prefs .switch[data-kind="kaos"]').closest(".toggle-row").click()); await wait(page, 500);
      let last = log.filter((x) => x[0] === "set_push_prefs").pop();
      ok("turn KAOS off → set_push_prefs p_off ['kaos']", last && JSON.stringify(last[1].p_off) === '["kaos"]' && last[1].p_quiet_from === null, last);
      await page.selectOption('.push-prefs select[data-pref="quiet"]', "1-10"); await wait(page, 500);
      last = log.filter((x) => x[0] === "set_push_prefs").pop();
      ok("nattro 01–10 → p_quiet_from 1, p_quiet_to 10", last && last[1].p_quiet_from === 1 && last[1].p_quiet_to === 10 && JSON.stringify(last[1].p_off) === '["kaos"]', last);
      await page.selectOption('.push-prefs select[data-pref="cap"]', "5"); await wait(page, 500);
      last = log.filter((x) => x[0] === "set_push_prefs").pop();
      ok("max per kväll 5 → p_cap 5", last && last[1].p_cap === 5, last);
      ok("no horizontal scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.evaluate(() => document.querySelector(".push-prefs").scrollIntoView({ block: "start" })); await wait(page, 300);
      await page.screenshot({ path: SP + "ui-testshots/notif-ds-settings.png" }); console.log("shot notif-settings.png");
      await ctx.close();
    }
    { // B) blocked permission help
      const log = []; const { ctx, page } = await ctxFor(browser, vp);
      await ctx.addInitScript(() => { try { Object.defineProperty(Notification, "permission", { get: () => "denied" }); } catch (e) {} });
      await extra(page, log); await boot(page); await openSettings(page);
      ok("blocked → iPhone/Android help shown", await page.evaluate(() => /Inställningar → Notiser → PintsNow/.test(document.getElementById("sheet-body").textContent)));
      await ctx.close();
    }
    { // C) cold start ?focus=1000&act=skal (1000 = Oskar's pin in the mock)
      const log = []; const { ctx, page } = await ctxFor(browser, vp); await extra(page, log);
      const seen = []; page.on("console", () => {}); 
      await page.goto(BASE + "?focus=1000&act=skal");
      await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => {});
      await wait(page, 3500);
      const sk = log.find((x) => x[0] === "skal" || x[0] === "skal_v2");
      ok("act=skal → skål RPC for pin 1000", sk && (String(sk[1].p_beer_id) === "1000" || String(sk[1].p_pin) === "1000"), log.map((x) => x[0]));
      const tt = await toasts(page); seen.push(tt);
      ok("toast '🍻 Skål med Oskar!'", /Skål med Oskar/.test(tt), tt);
      ok("act removed from the URL", !/act=/.test(await page.evaluate(() => location.search)), await page.evaluate(() => location.search));
      await ctx.close();
    }
    { // D) cold start &act=coming
      const log = []; const { ctx, page } = await ctxFor(browser, vp); await extra(page, log);
      await page.goto(BASE + "?focus=1000&act=coming");
      await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => {});
      await wait(page, 3500);
      const c = log.find((x) => x[0] === "fn" && x[1].event === "coming");
      ok("act=coming → notify-group {event:'coming', beer_id:1000}", c && String(c[1].beer_id) === "1000", log.filter((x) => x[0] === "fn"));
      const tt = await toasts(page);
      ok("toast 'Oskar vet att du kommer'", /Oskar vet att du kommer/.test(tt), tt);
      await page.screenshot({ path: SP + "ui-testshots/notif-ds-coming.png" });
      // E) routeOpen while open
      log.length = 0;
      await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "olnu-open", url: location.origin + "/?focus=1000&act=skal" } })));
      await wait(page, 3500);
      ok("open app + push tap '🍻 Skåla' → skål RPC", log.some((x) => x[0] === "skal" || x[0] === "skal_v2"), log.map((x) => x[0]));
      await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "olnu-open", url: location.origin + "/?helg=1" } })));
      await wait(page, 2000);
      ok("open app + helg push → a sheet opens", await page.evaluate(() => !document.getElementById("sheet").hidden), await page.evaluate(() => document.getElementById("sheet-title") && document.getElementById("sheet-title").textContent));
      await ctx.close();
    }
  } catch (e) { console.log("FAIL exception", e.message); fail++; }
  await browser.close();
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
