// juice tests (js/juice.js): ÖL! sound engine + "Ljud" switch, haptics Android-only, foam burst capped / off with reduced motion,
// no long task on press, CC0 voice clips, Röst / Vibration switches. usage: node juice-pw.js <port>
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const { wait } = H;
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const SPY = () => {
  window.__vib = [];
  try { Object.defineProperty(Navigator.prototype, "vibrate", { configurable: true, value: function (p) { window.__vib.push(JSON.stringify(p)); return true; } }); } catch (e) {}
  window.__lt = [];
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push({ s: e.startTime, d: e.duration }))).observe({ type: "longtask", buffered: true }); } catch (e) {}
};
async function setup(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, o);
  await page.route(/rest\/v1\/rpc\/(post_beer_v2|post_beer|live_checkins)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "live_checkins") return J(r, [{ name: "Anton", is_mine: true, is_friend: false, bar_id: "n3472634175", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679, created_at: new Date(Date.now() - 90 * 60e3).toISOString() }]);
    if (o.postErr) return J(r, { code: "P0001", message: "juice_test_error" }, 400);
    return J(r, { accepted: true, beer_count: 1, lat: body.p_lat || 60.15, lng: body.p_lng || 15.18, precise: false, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0 });
  });
  await ctx.addInitScript(SPY);
  await H.boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page };
}
const S = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.FX && window.FX.juice ? window.FX.juice.stats : null)));
const tapBeer = async (page) => { await page.evaluate(() => { const b = document.getElementById("btn-beer"); b.disabled = false; b.classList.remove("cooldown"); }); await page.click("#btn-beer", { timeout: 5000 }).catch((e) => console.log("click: " + e.message.split("\n")[0])); };

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}),
    args: ["--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required"] });

  // ---------- 1. Android: ÖL! press = tap sound + double-tap haptic + squash + capped foam burst; accepted = fizz + clink + haptic ----------
  {
    const { ctx, page } = await setup(browser, {});
    const api = await page.evaluate(() => ({ j: !!(window.FX && window.FX.juice), beer: window.FX && String(window.FX.sound.beer).indexOf("fizz") >= 0, hook: window.PN && PN.hookNames().indexOf("FX") >= 0 }));
    ok(api.j && api.beer && api.hook, "FX.juice loaded, FX.sound.beer uses the juice engine, FX registered for the settingsSheet hook (" + JSON.stringify(api) + ")");
    await page.evaluate(() => { const w = document.querySelector(".beer-wrap"); window.__pop = 0; new MutationObserver(() => { if (w.classList.contains("jc-pop")) window.__pop++; }).observe(w, { attributes: true, attributeFilter: ["class"] });
      window.__cv = 0; new MutationObserver(() => { if (document.querySelector(".jc-cv")) window.__cv++; }).observe(document.body, { childList: true }); });
    await tapBeer(page); await wait(page, 120);
    let s = await S(page); const v1 = await page.evaluate(() => window.__vib.slice());
    ok(s && s.presses === 1 && s.played.tap === 1, "ÖL! tap plays the 'tap' sound at once, before the server answers (" + JSON.stringify(s && s.played) + ")");
    ok(v1.indexOf("[14,45,20]") >= 0, "Android: navigator.vibrate called with the ÖL! double-tap pattern [14,45,20] (" + v1.join(" ") + ")");
    ok(v1.indexOf("20") < 0, "the old single 20 ms buzz is gone (no 2nd vibrate call cancels the pattern)");
    ok(s && s.particles > 0 && s.particles <= 40, "foam burst: " + (s && s.particles) + " particles (1..40)");
    const vis = await page.evaluate(() => ({ pop: window.__pop, cv: window.__cv }));
    ok(vis.pop > 0 && vis.cv > 0, "squash-and-stretch class on .beer-wrap + burst canvas shown (" + JSON.stringify(vis) + ")");
    await wait(page, 1600);
    s = await S(page); const v2 = await page.evaluate(() => window.__vib.slice());
    ok(s.played.fizz >= 1 && s.played.clink >= 1, "accepted beer: fizz + clink (" + JSON.stringify(s.played) + ")");
    ok(v2.indexOf("[10,30,10,60,28]") >= 0, "accepted beer: clink haptic [10,30,10,60,28] (" + v2.join(" ") + ")");
    const gone = await page.evaluate(() => !document.querySelector(".jc-cv"));
    ok(gone && s.frames > 0, "burst canvas removed after 600 ms (" + s.frames + " frames)");
    const avg = s.sumFrameMs / Math.max(1, s.frames);
    ok(avg <= 4, "particle frame work avg " + avg.toFixed(2) + " ms ≤ 4 ms (max " + s.maxFrameMs.toFixed(2) + " ms)");
    // voice: CC0 clips decode through Web Audio
    await page.waitForFunction(() => window.FX.juice.clipState() === "ready" || window.FX.juice.clipState() === "fail", null, { timeout: 15000 }).catch(() => {});
    const vo = await page.evaluate(() => { const st = window.FX.juice.clipState(); window.FX.juice.stats.voice.clip = 0; const r = window.FX.juice.say(0); return { st, r, n: window.FX.juice.stats.voice.clip, lines: window.FX.juice.lines.length }; });
    ok(vo.st === "ready" && vo.r && vo.n === 1, "voice: " + vo.lines + " Swedish clips loaded, one plays through Web Audio (" + JSON.stringify(vo) + ")");
    const bad = await page.evaluate(() => window.FX.juice.lines.filter((l) => /drick (mer|en till)|ta en till|ska ha en öl|bäste kompis/i.test(l[1])).length);
    ok(bad === 0, "no voice line says 'drink more'");
    // no long task on press: 3 direct presses, long tasks in each 700 ms window
    const lt = await page.evaluate(async () => {
      const b = document.getElementById("btn-beer"), out = []; let maxSync = 0;
      for (let i = 0; i < 3; i++) {
        const t = performance.now(); window.FX.juice.press(b); maxSync = Math.max(maxSync, performance.now() - t);
        await new Promise((r) => setTimeout(r, 700));
        window.__lt.filter((e) => e.s >= t - 5 && e.s < t + 700 && e.d > 50).forEach((e) => out.push(Math.round(e.d)));
      }
      return { out, maxSync: +maxSync.toFixed(1), n: window.FX.juice.stats.particles };
    });
    ok(lt.out.length === 0 && lt.maxSync < 50, "no long task > 50 ms on press (long tasks " + JSON.stringify(lt.out) + ", press() " + lt.maxSync + " ms)");
    // "Ljud" off: nothing plays (press, beer, skål, voice)
    const mu = await page.evaluate(() => {
      const J = window.FX.juice, before = JSON.stringify(J.stats.played), sk = J.stats.skipped, vc = J.stats.voice.clip;
      window.FX.setMuted(true);
      J.press(document.getElementById("btn-beer")); window.FX.sound.beer(); window.FX.sound.clink(); window.FX.sound.hot(); const said = J.say(0);
      const r = { same: before === JSON.stringify(J.stats.played), skipped: J.stats.skipped - sk, said, voice: J.stats.voice.clip - vc };
      window.FX.setMuted(false); return r;
    });
    ok(mu.same && mu.skipped >= 4 && !mu.said && mu.voice === 0, "Ljud off: no sound and no voice at all (" + JSON.stringify(mu) + ")");
    const on = await page.evaluate(() => { const J = window.FX.juice, n = J.stats.played.skal || 0; window.FX.sound.clink(); return (J.stats.played.skal || 0) - n; });
    ok(on === 1, "Ljud on again: skål clink plays");
    // Röst + Vibration switches
    const sw = await page.evaluate(() => {
      localStorage.setItem("olnu.voice", "0"); const said = window.FX.juice.say(0);
      localStorage.setItem("olnu.vib", "0"); const n = window.__vib.length; window.FX.vibrate(20); const hp = window.FX.juice.haptic("press"); const after = window.__vib.length - n;
      localStorage.removeItem("olnu.voice"); localStorage.removeItem("olnu.vib");
      const body = document.createElement("div"), row = document.createElement("div"), b = document.createElement("button");
      row.className = "toggle-row"; b.className = "switch"; b.setAttribute("aria-label", PN.t("soundLabel")); row.appendChild(b); body.appendChild(row);
      const tail = document.createElement("div"); tail.className = "toggle-row"; body.appendChild(tail);
      window.FX.settingsSheet(body);
      const rows = [...body.children].map((x) => x.classList.contains("jc-row") ? x.textContent : x === row ? "LJUD" : "other");
      return { said, after, hp, rows };
    });
    ok(!sw.said && sw.after === 0 && !sw.hp, "Röst off = no voice; Vibration off = no vibrate at all (" + JSON.stringify(sw) + ")");
    ok(JSON.stringify(sw.rows) === JSON.stringify(["LJUD", "Röst som säger skål", "Vibration", "other"]), "settings: Röst + Vibration rows right under Ljud (" + sw.rows.join(" | ") + ")");
    await ctx.close();
  }

  // ---------- 2. iPhone UA: never navigator.vibrate from juice (fx.js switch overlay gives the tick) ----------
  {
    const { ctx, page } = await setup(browser, { ua: "ios" });
    await tapBeer(page); await wait(page, 1600);
    const r = await page.evaluate(() => ({ vib: window.__vib.slice(), hap: window.FX.juice.stats.haptics.length, tap: window.FX.juice.stats.played.tap || 0, ov: !!document.querySelector("#btn-beer [data-haptic]") }));
    ok(r.vib.indexOf("[14,45,20]") < 0 && r.vib.indexOf("[10,30,10,60,28]") < 0 && r.hap === 0, "iOS UA: juice never calls navigator.vibrate (" + JSON.stringify(r.vib) + ")");
    ok(r.tap === 1 && r.ov, "iOS UA: tap sound still plays, ÖL! keeps the haptic switch overlay");
    await ctx.close();
  }

  // ---------- 3. reduced motion: no particles, no squash; sound + haptic stay ----------
  {
    const { ctx, page } = await setup(browser, { reduced: true });
    await page.evaluate(() => { window.__cv = 0; new MutationObserver(() => { if (document.querySelector(".jc-cv")) window.__cv++; }).observe(document.body, { childList: true }); });
    await tapBeer(page); await wait(page, 200);
    const r = await page.evaluate(() => ({ p: window.FX.juice.stats.particles, cv: window.__cv, pop: document.querySelector(".beer-wrap").classList.contains("jc-pop"), tap: window.FX.juice.stats.played.tap || 0, vib: window.__vib.slice() }));
    ok(r.p === 0 && r.cv === 0 && !r.pop, "reduced motion: no particles, no canvas, no squash (" + JSON.stringify(r) + ")");
    ok(r.tap === 1 && r.vib.indexOf("[14,45,20]") >= 0, "reduced motion: sound + haptic still on");
    await ctx.close();
  }

  // ---------- 4. server error: soft error sound + one long buzz ----------
  {
    const { ctx, page } = await setup(browser, { postErr: true });
    await tapBeer(page); await wait(page, 2000);
    const r = await page.evaluate(() => ({ err: window.FX.juice.stats.played.error || 0, vib: window.__vib.slice() }));
    ok(r.err === 1 && r.vib.indexOf("[160]") >= 0, "ÖL! error: 'error' sound + long buzz [160] (" + JSON.stringify(r) + ")");
    await ctx.close();
  }

  await browser.close();
  console.log("juice: " + pass + " PASS, " + fail + " FAIL");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash " + (e && e.stack || e)); process.exit(1); });
