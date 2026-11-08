// Smart check-in + auto check-out (js/autoci.js). Mocked Supabase + mocked geolocation. usage: node ac-pw.js <port>
const { chromium } = require("playwright");
const H = require("./ds-helpers.js");
const SP = require("./env.js").OUT;
const { wait } = H;
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const BAR = { parma: [60.15124, 15.18797], pitch: [60.14997, 15.18679], lobby: [60.15098, 15.18663], grek: [60.15205, 15.18059] };
const FAR = [60.14390, 15.17600];   // a street ~700 m from the centre bars

async function setup(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, o);
  const srv = { mine: o.checkin === false ? null : { bar_id: "n3472634175", bar_name: "Pitchers", lat: BAR.pitch[0], lng: BAR.pitch[1] }, calls: [] };
  const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  await page.route(/rest\/v1\/rpc\/(check_in|check_out|live_checkins)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "live_checkins") return J(r, srv.mine ? [Object.assign({ name: "Anton", is_mine: true, is_friend: false, created_at: new Date(Date.now() - 90 * 60e3).toISOString() }, srv.mine)] : []);
    srv.calls.push({ fn, body });
    if (fn === "check_in") { srv.mine = { bar_id: body.p_bar_id, bar_name: body.p_bar_name, lat: body.p_lat, lng: body.p_lng }; return J(r, { ok: true, bar_name: body.p_bar_name, wait_seconds: 0 }); }
    const was = srv.mine; srv.mine = null;
    return J(r, { ok: !!was, bar_id: was && was.bar_id, bar_name: was && was.bar_name });
  });
  await ctx.setGeolocation({ latitude: FAR[0], longitude: FAR[1], accuracy: 10 });
  if (o.extra) await ctx.addInitScript(o.extra);
  await H.boot(page);
  await page.waitForFunction(() => window.AUTOCI && window.AUTOCI.state().watching, null, { timeout: 15000 }).catch(() => {});
  await H.closeSheet(page); await wait(page, 300);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page, srv };
}
// one GPS reading: move the clock on, move the phone, let the module read it
async function read(t, ll, acc, advMin, dm = [0, 0]) {
  await t.page.evaluate((m) => window.AUTOCI._skew(m * 60e3), advMin);
  await t.ctx.setGeolocation({ latitude: ll[0] + dm[0] / 111320, longitude: ll[1] + dm[1] / 55600, accuracy: acc });
  await wait(t.page, 500);
  await t.page.evaluate(() => window.AUTOCI._tick());
  await wait(t.page, 2200);
}
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent.replace(/\s+/g, " ").trim()).join(" | "));
const calls = (srv, fn) => srv.calls.filter((c) => c.fn === fn);
const shot = (page, n) => page.screenshot({ path: SP + "ac-shots/ac-" + n + ".png" });

(async () => {
  require("fs").mkdirSync(SP + "ac-shots", { recursive: true });
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });

  // 1. Grekiska, clear winner: setting off → suggestion; setting on → auto check-in
  {
    const t = await setup(browser, { checkin: false });
    ok(await t.page.evaluate(() => !window.AUTOCI.on()), "default: auto check-in is OFF");
    await read(t, BAR.grek, 10, 1, [3, 2]); await read(t, BAR.grek, 10, 2.5, [-2, 3]);
    ok(!/Grekiska\?/.test(await toasts(t.page)), "grek: nothing before 5 min");
    await read(t, BAR.grek, 9, 2.6, [1, -2]);
    let tx = await toasts(t.page);
    if (process.env.DBG) console.log("DBG", await t.page.evaluate(() => JSON.stringify({ s: window.AUTOCI.state(), ci: localStorage.getItem("olnu.checkin"), sheet: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent })), JSON.stringify(t.srv.calls));
    ok(/Är du på Grekiska\?/.test(tx) && /Checka in/.test(tx), "grek: suggestion 'Är du på Grekiska? ✓ Checka in' after 5 min / 3 readings (" + tx + ")");
    ok(calls(t.srv, "check_in").length === 0, "grek: no check-in without a tap (setting off)");
    await shot(t.page, "1-suggest");
    // settings row (ds08 .pn-swb) in Karta
    await H.clickJS(t.page, "#btn-settings"); await wait(t.page, 1500);
    await H.clickJS(t.page, "#sheet-body [data-pf=s]"); await wait(t.page, 1500);
    const row = await t.page.evaluate(() => { const b = document.querySelector("#sheet-body .ac-row"); if (!b) return null; b.scrollIntoView(); const s = b.closest("section"); return { swb: b.classList.contains("pn-swb"), sec: s && s.getAttribute("data-ds"), icon: !!b.querySelector("svg"), checked: b.getAttribute("aria-checked"), hint: (b.closest(".ds-item") || document).querySelector(".ac-hint") ? 1 : 0 }; });
    ok(row && row.swb && row.icon && row.checked === "false", "settings: one switch row 'Checka in automatiskt' (pn-swb, icon, off) " + JSON.stringify(row));
    ok(row && row.hint === 1, "settings: one-line explanation under the row");
    await wait(t.page, 400); await shot(t.page, "2-settings");
    await H.clickJS(t.page, "#sheet-body .ac-row"); await wait(t.page, 300);
    ok(await t.page.evaluate(() => window.AUTOCI.on() && document.querySelector("#sheet-body .ac-row").getAttribute("aria-checked") === "true"), "settings: tap turns it on");
    await H.closeSheet(t.page); await wait(t.page, 500);
    await read(t, BAR.grek, 8, 1, [0, 2]);
    tx = await toasts(t.page);
    const ci = calls(t.srv, "check_in");
    ok(ci.length === 1 && ci[0].body.p_bar_id === "x-grekiska-grill-bar-ludvika", "grek: auto check-in at Grekiska (setting on) " + JSON.stringify(ci.map((c) => c.body.p_bar_id)));
    ok(/Incheckad på Grekiska \(automatiskt\)/.test(tx) && /Ångra/.test(tx), "grek: toast 'Incheckad på Grekiska (automatiskt)' + Ångra (" + tx + ")");
    ok(await t.page.evaluate(() => (JSON.parse(localStorage.getItem("olnu.checkin") || "{}").id) === "x-grekiska-grill-bar-ludvika"), "grek: the normal check-in is stored (olnu.checkin)");
    await shot(t.page, "3-auto");
    await t.ctx.close();
  }

  // 2. Between La Parma and Lobbybaren: ambiguous → one-tap choice, never a guess (even with the setting on)
  {
    const t = await setup(browser, { checkin: false, extra: () => localStorage.setItem("olnu.autoCi", "1") });
    const mid = [(BAR.parma[0] + BAR.lobby[0]) / 2, (BAR.parma[1] + BAR.lobby[1]) / 2];
    await read(t, mid, 12, 1); await read(t, mid, 12, 2.5, [2, 0]); await read(t, mid, 11, 2.6, [-1, 1]);
    const tx = await toasts(t.page);
    ok(/La Parma eller Lobbybaren\?/.test(tx), "ambiguous: 'La Parma eller Lobbybaren?' (" + tx + ")");
    ok(calls(t.srv, "check_in").length === 0, "ambiguous: no auto check-in");
    const n = await t.page.evaluate(() => document.querySelectorAll("#toasts .ac-pick").length);
    ok(n === 2, "ambiguous: one tap each (2 buttons)");
    await shot(t.page, "4-choice");
    await t.page.evaluate(() => { const b = [...document.querySelectorAll("#toasts .ac-pick")].find((x) => /La Parma/.test(x.textContent)); b.click(); });
    await wait(t.page, 1500);
    const ci = calls(t.srv, "check_in");
    ok(ci.length === 1 && ci[0].body.p_bar_id === "x-la-parma-ludvika", "ambiguous: tap 'La Parma' checks in at La Parma");
    await t.ctx.close();
  }

  // 3. Poor accuracy (40 m) → nothing
  {
    const t = await setup(browser, { checkin: false, extra: () => localStorage.setItem("olnu.autoCi", "1") });
    for (const m of [1, 2.5, 2.5, 2.5]) await read(t, BAR.grek, 40, m);
    const st = await t.page.evaluate(() => window.AUTOCI.state());
    ok(st.readings >= 3 && !st.run, "poor accuracy: readings seen, none counted (readings " + st.readings + ")");
    ok(calls(t.srv, "check_in").length === 0 && !/Grekiska/.test(await toasts(t.page)), "poor accuracy (40 m): no check-in, no question");
    await t.ctx.close();
  }

  // 4. Checked in at Pitchers, walk away: 2 far readings a few minutes apart → quiet check-out + small toast
  {
    const t = await setup(browser, {});
    await read(t, BAR.pitch, 10, 1, [3, 3]);
    ok(calls(t.srv, "check_out").length === 0, "walk away: at the bar → stays checked in");
    await read(t, FAR, 10, 2);
    ok(calls(t.srv, "check_out").length === 0, "walk away: 1 far reading → stays checked in");
    await read(t, FAR, 12, 2.5, [20, 10]);
    const tx = await toasts(t.page);
    ok(calls(t.srv, "check_out").length === 1, "walk away: 2nd far reading → check_out");
    ok(/Utcheckad från Pitchers/.test(tx), "walk away: toast 'Utcheckad från Pitchers' (" + tx + ")");
    ok(await t.page.evaluate(() => !localStorage.getItem("olnu.checkin")), "walk away: local check-in removed");
    await shot(t.page, "5-out");
    await t.ctx.close();
  }

  // 5. Checked in at Pitchers, now clearly at Lobbybaren → "Bytt till Lobbybaren?" (no quiet check-out while it asks)
  {
    const t = await setup(browser, {});
    await read(t, BAR.lobby, 8, 1, [2, -2]); await read(t, BAR.lobby, 8, 2.5, [-2, 1]);
    const tx = await toasts(t.page);
    ok(/Bytt till Lobbybaren\?/.test(tx), "switch: 'Bytt till Lobbybaren?' (" + tx + ")");
    ok(calls(t.srv, "check_out").length === 0, "switch: no quiet check-out while the question is open");
    await shot(t.page, "6-switch");
    await t.page.evaluate(() => document.querySelector("#toasts .ac-yes").click()); await wait(t.page, 1500);
    const ci = calls(t.srv, "check_in");
    ok(ci.length === 1 && ci[0].body.p_bar_id === "x-lobbybaren-ludvika", "switch: tap → checked in at Lobbybaren");
    await t.ctx.close();
  }

  // 6. "Bara område" → suggestion only, never auto (setting on)
  {
    const t = await setup(browser, { checkin: false, extra: () => { localStorage.setItem("olnu.autoCi", "1"); localStorage.setItem("olnu.prec", "area"); } });
    await read(t, BAR.grek, 8, 1); await read(t, BAR.grek, 8, 2.5, [2, 0]); await read(t, BAR.grek, 8, 2.6, [0, 2]);
    const tx = await toasts(t.page);
    ok(calls(t.srv, "check_in").length === 0, "area mode: no auto check-in");
    ok(/Är du på Grekiska\?/.test(tx), "area mode: suggestion only (" + tx + ")");
    await t.ctx.close();
  }

  // 7. Ghost mode + home zone: nothing at all
  {
    const t = await setup(browser, { checkin: false, extra: () => { localStorage.setItem("olnu.autoCi", "1"); localStorage.setItem("olnu.ghostMode", "1"); localStorage.setItem("olnu.home", JSON.stringify({ lat: 60.15205, lng: 15.18059, r: 300, at: 1 })); } });
    await read(t, BAR.grek, 8, 1); await read(t, BAR.grek, 8, 2.5); await read(t, BAR.grek, 8, 2.6);
    ok(calls(t.srv, "check_in").length === 0 && !/Grekiska\?/.test(await toasts(t.page)), "ghost / home zone: no check-in, no question");
    await t.ctx.close();
  }

  // 8. Hidden page → GPS sampling stops (battery); visible again → it starts and reads once. No permanent watchPosition.
  {
    const t = await setup(browser, { checkin: false });
    await t.page.evaluate(() => { const g = navigator.geolocation, gc = g.getCurrentPosition.bind(g), wp = g.watchPosition.bind(g);
      window.__gc = 0; window.__wp = 0; g.getCurrentPosition = (a, b, c) => { window.__gc++; return gc(a, b, c); }; g.watchPosition = (a, b, c) => { window.__wp++; return wp(a, b, c); }; });
    ok(await t.page.evaluate(() => window.AUTOCI.state().watching), "visible: GPS sampling on");
    await t.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    await wait(t.page, 300);
    ok(await t.page.evaluate(() => !window.AUTOCI.state().watching), "hidden: sampling stopped");
    const r0 = await t.page.evaluate(() => window.AUTOCI.state().readings), g0 = await t.page.evaluate(() => window.__gc);
    await t.page.evaluate(() => window.AUTOCI._skew(6 * 60e3));
    await t.page.evaluate(() => window.AUTOCI._tick()); await wait(t.page, 800);
    ok(await t.page.evaluate(([r0, g0]) => window.AUTOCI.state().readings === r0 && window.__gc === g0, [r0, g0]), "hidden: no GPS call, no readings");
    await t.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
    await wait(t.page, 2000);
    ok(await t.page.evaluate((r0) => window.AUTOCI.state().watching && window.AUTOCI.state().readings > r0, r0), "visible again: sampling on + one reading on resume");
    // the app's own GPS call (ÖL!) is not held up by us
    const t0 = Date.now();
    const res = await t.page.evaluate(() => new Promise((r) => navigator.geolocation.getCurrentPosition(() => r("ok"), (e) => r("err" + e.code), { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 })));
    ok(res === "ok" && Date.now() - t0 < 3000, "app GPS call answers at once (" + res + ", " + (Date.now() - t0) + " ms)");
    ok(await t.page.evaluate(() => window.__wp === 0), "no watchPosition started by the module");
    await t.ctx.close();
  }
  await browser.close();
  console.log(fails ? "DONE with " + fails + " FAIL" : "DONE all pass");
  process.exit(fails ? 1 : 0);
})();
