// timers-pw.js — lane timers (PLAN B10 + A9). 390 px, mocked Supabase. Usage: node timers-pw.js <port>
//   A9: the sheet close slides the REAL #sheet (no clone in a shadow root, no copy of the page CSS); the body is cleared when
//       the slide ends; a sheet opened during the slide shows at once with its own body; reduced motion = instant.
//   B10: PN.idle (js/smooth.js) = "the map is out of sight" (a sheet that covers >= half the screen, or a hidden page).
//       Timer loops of the map / HUD sleep then (no callbacks), repeating CSS animations under the scrim pause, and all of it
//       comes back at once when the map is visible again. With the map visible nothing changes.
// Timer callbacks are counted per source file (the file that first asked for the interval; js/smooth.js PN.idle.every is
// skipped so the caller counts).
const { ctxFor, boot, wait, clickJS } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const CHROME = require("./env.js").CHROME;
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };

function instrument() {
  const C = window.__tc = { on: false, by: {} }, who = new WeakMap();
  const src = () => {
    const s = (new Error().stack || "").split("\n"); let first = "";
    for (let i = 1; i < s.length; i++) {
      const m = /https?:\/\/[^/]+\/(?:test\/)?(?:js\/)?([\w.-]+\.js)/.exec(s[i]); if (!m) continue;
      if (!first) first = m[1];
      if (m[1] !== "smooth.js") return m[1];
    }
    return first || "?";
  };
  const oI = window.setInterval;
  window.setInterval = function (fn, ms) {
    if (typeof fn !== "function") return oI.apply(window, arguments);
    let w = who.get(fn); if (!w) { w = src(); who.set(fn, w); }
    return oI.call(window, function () { if (C.on) C.by[w] = (C.by[w] || 0) + 1; return fn.apply(this, arguments); }, ms);
  };
  window.__tcHide = function (on) {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => on });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (on ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  // endless CSS animations that run outside the sheet and the toasts (a capped 3-loop glow ends by itself: not counted)
  window.__loops = function () {
    let n = 0;
    for (const a of document.getAnimations()) {
      try { if (a.animationName && a.playState === "running" && a.effect.getTiming().iterations === Infinity && !a.effect.target.closest("#sheet, #toasts")) n++; } catch (e) {}
    }
    return n;
  };
}
async function count(page, ms) {
  await page.evaluate(() => { window.__tc.by = {}; window.__tc.on = true; });
  await wait(page, ms);
  return page.evaluate(() => { window.__tc.on = false; return window.__tc.by; });
}
const sum = (by, files) => files.reduce((s, f) => s + (by[f] || 0), 0);
// loops of the map / HUD that must sleep under a full sheet, and (with the hidden-only ones) in a hidden page
const MAPLOOPS = ["lask.js", "ride.js", "pnikv.js", "pnvis.js", "mypins.js", "app-ticker.js", "gw.js", "alive2.js", "pnds.js"];
const HIDLOOPS = MAPLOOPS.concat(["knas.js", "pnui.js", "unlocks.js"]);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript(instrument);
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await boot(page);
    await page.waitForFunction(() => document.getElementById("btn-more"), null, { timeout: 15000 });

    // ---- B10: the map visible = loops run as before
    const vis = await count(page, 3200);
    const loops0 = await page.evaluate(() => window.__loops());
    ok("B10 map visible: the map loops still run (lask/ride/pnikv tick each second)", (vis["lask.js"] || 0) >= 2 && (vis["ride.js"] || 0) >= 2 && (vis["pnikv.js"] || 0) >= 2, vis);
    ok("B10 map visible: repeating animations run (pill glow, clinks …)", loops0 > 0, { loops0 });
    ok("B10 PN.idle exists and says: not idle", await page.evaluate(() => !!(window.PN && PN.idle && PN.idle.every) && !PN.idle.now() && !document.documentElement.classList.contains("pn-covered")));

    // ---- B10: the helper itself (flip calls, sleep, wake at once)
    const h = await page.evaluate(async () => {
      if (!window.PN || !PN.idle) return { missing: true };   // old code: no helper
      const tick = () => new Promise((r) => setTimeout(r, 0)), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let n = 0; const hd = PN.idle.every(() => n++, 150);
      await sleep(400); const run = n;
      PN.idle.cover("timers-test", true); await tick(); const atCover = n - run;
      await sleep(500); const inCover = n - run - atCover;
      const c0 = n; PN.idle.cover("timers-test", false); const atWake = n - c0;   // runs at once, in the same task
      await sleep(400); const after = n - c0 - atWake; hd.stop(); const s0 = n; await sleep(400);
      return { run, atCover, inCover, atWake, after, stopped: n - s0 };
    });
    ok("B10 PN.idle.every: runs every ms when visible, once at cover, never while covered, at once at wake, stop() stops", h.run >= 2 && h.atCover === 1 && h.inCover === 0 && h.atWake === 1 && h.after >= 2 && h.stopped === 0, h);

    // ---- B10: a full sheet covers the map
    await clickJS(page, "#btn-more"); await wait(page, 1500);
    const cov = await page.evaluate(() => { const s = document.getElementById("sheet"); return { open: !s.hidden, h: s.offsetHeight, vh: innerHeight, covered: (PN.idle && PN.idle.covered()), cls: document.documentElement.classList.contains("pn-covered"), loops: window.__loops(), held: (PN.idle && PN.idle._held()) }; });
    ok("B10 full sheet (⋯ Mer, " + cov.h + "/" + cov.vh + " px): PN.idle.covered + html.pn-covered", cov.open && cov.covered && cov.cls, cov);
    ok("B10 full sheet: repeating animations under the scrim are paused (" + loops0 + " endless → " + cov.loops + "; " + cov.held + " held)", cov.loops === 0 && cov.held >= loops0, { loops0, cov });
    const sh = await count(page, 6200);
    ok("B10 full sheet: the map loops make no timer callbacks in 6 s", sum(sh, MAPLOOPS) === 0, sh);
    // close: everything comes back at once
    // (clinks and sparks come and go on their own: compare the SAME animations that were paused, where they still exist)
    const back = await page.evaluate(async () => {
      const was = document.getAnimations().filter((a) => a.animationName && a.playState === "paused");
      document.getElementById("sheet-close").click();
      await new Promise((r) => setTimeout(r, 0));
      const live = was.filter((a) => a.effect && a.effect.target && a.effect.target.isConnected);
      return { covered: (PN.idle && PN.idle.covered()), cls: document.documentElement.classList.contains("pn-covered"), loops: window.__loops(), held: (PN.idle && PN.idle._held()),
        paused: was.length, live: live.length, playing: live.filter((a) => a.playState === "running").length };
    });
    ok("B10 sheet closed: not covered and the paused animations play again at once (" + back.playing + "/" + back.live + ")", !back.covered && !back.cls && back.held === 0 && back.loops > 0 && back.live > 0 && back.playing === back.live, { loops0, back });
    const wake = await count(page, 2300);
    ok("B10 sheet closed: the map loops run again", (wake["lask.js"] || 0) >= 1 && (wake["ride.js"] || 0) >= 1, wake);
    // a small sheet (under half of the screen) does not count as covered
    await wait(page, 500);
    const small = await page.evaluate(async () => {
      PN.openSheet("Liten", (b) => { b.textContent = "x"; }, { now: true });
      await new Promise((r) => setTimeout(r, 120));
      const s = document.getElementById("sheet"), out = { h: s.offsetHeight, vh: innerHeight, covered: (PN.idle && PN.idle.covered()), loops: window.__loops() };
      PN.closeSheet ? PN.closeSheet() : document.getElementById("sheet-close").click();
      return out;
    });
    ok("B10 small sheet (" + small.h + " px): not covered, loops keep running", small.h < small.vh / 2 && !small.covered && small.loops > 0, small);

    // ---- B10: a hidden page
    await wait(page, 600);
    await page.evaluate(() => window.__tcHide(true));
    const hid = await count(page, 6200);
    ok("B10 hidden page: PN.idle.hidden and no timer callbacks from the map / HUD loops in 6 s", sum(hid, HIDLOOPS) === 0 && await page.evaluate(() => (PN.idle && PN.idle.hidden())), hid);
    await page.evaluate(() => window.__tcHide(false));
    const shown = await count(page, 2300);
    ok("B10 visible again: the loops run again", (shown["lask.js"] || 0) >= 1 && (shown["knas.js"] || 0) >= 1 && !await page.evaluate(() => (PN.idle && PN.idle.now())), shown);

    // ---- A9: close slides the real sheet, no clone
    await clickJS(page, "#btn-more"); await wait(page, 1500);
    const a9 = await page.evaluate(async () => {
      const s = document.getElementById("sheet"), b = document.getElementById("sheet-body"), kids0 = b.children.length;
      document.getElementById("sheet-close").click();
      const anim = s.getAnimations().filter((a) => !a.animationName && a.playState === "running");
      const kf = anim[0] && anim[0].effect.getKeyframes();
      const now = { hidden: s.hidden, ghost: !!document.querySelector(".sm-ghost-host"), shown: getComputedStyle(s).display !== "none", pe: getComputedStyle(s).pointerEvents,
        anim: anim.length, slide: !!(kf && /translateY/.test(kf[kf.length - 1].transform) && +kf[kf.length - 1].opacity === 0), kids: b.children.length, kids0 };
      // mid-slide (the first frame can come late on a busy runner: wait for the animation clock, max 600 ms)
      const t0 = performance.now();
      while (anim[0] && (anim[0].currentTime || 0) < 60 && anim[0].playState === "running" && performance.now() - t0 < 600) await new Promise((r) => requestAnimationFrame(r));
      const m = getComputedStyle(s).transform.match(/matrix\(([^)]+)\)/);
      now.mid = +getComputedStyle(s).opacity; now.dy = m ? +m[1].split(",")[5] : 0;
      await new Promise((r) => setTimeout(r, 650));
      now.end = { display: getComputedStyle(s).display, inline: s.style.display, kids: b.children.length, anims: s.getAnimations().filter((a) => !a.animationName).length };
      return now;
    });
    ok("A9 close: #sheet.hidden at once, no clone (.sm-ghost-host)", a9.hidden && !a9.ghost, a9);
    // motion19a (fix 2): the sliding sheet takes touches now (a drag brings it back); a tap on it clicks nothing (the click is
    // eaten: motion19a-pw.js "a plain tap on the closing sheet"). So pointer-events is "auto" during the slide, not "none".
    ok("A9 close: the real sheet slides down + fades (WAAPI on #sheet), no taps while it slides", a9.shown && a9.anim === 1 && a9.slide && /^(none|auto)$/.test(a9.pe) && a9.mid > 0 && a9.mid < 1 && a9.dy > 0, a9);
    ok("A9 close: the old content stays for the slide, then the body is empty and the sheet is display:none", a9.kids === a9.kids0 && a9.kids0 > 0 && a9.end.display === "none" && a9.end.inline === "" && a9.end.kids === 0 && a9.end.anims === 0, a9);
    // a sheet that opens during the slide shows at once and keeps its body
    await clickJS(page, "#btn-more"); await wait(page, 1500);
    const re = await page.evaluate(async () => {
      const s = document.getElementById("sheet");
      document.getElementById("sheet-close").click();
      await new Promise((r) => setTimeout(r, 60));
      PN.openSheet("Ny", (b) => { b.textContent = "ny text"; }, { now: true });
      await new Promise((r) => setTimeout(r, 0));
      const at = { hidden: s.hidden, out: s.getAnimations().filter((a) => !a.animationName).length, inline: s.style.display, pe: s.style.pointerEvents };
      await new Promise((r) => setTimeout(r, 500));
      at.body = document.getElementById("sheet-body").textContent; at.op = getComputedStyle(s).opacity; at.title = document.getElementById("sheet-title").textContent;
      document.getElementById("sheet-close").click();
      return at;
    });
    // motion19a (fix 2): the close slide is gone; the sheet turns around from where it was = ONE open animation (was: 0, a jump)
    ok("A9 a sheet opened during the slide: shown at once, slide gone, its body kept", !re.hidden && re.out <= 1 && re.inline === "" && re.pe === "" && re.body === "ny text" && re.title === "Ny" && +re.op === 1, re);
    ok("no page error", errs.length === 0, errs);
    await ctx.close();

    // ---- A9: reduced motion = instant close, as before
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { reduced: true });
      await boot(page);
      await clickJS(page, "#btn-more"); await wait(page, 1500);
      const r = await page.evaluate(() => {
        const s = document.getElementById("sheet"); document.getElementById("sheet-close").click();
        return { display: getComputedStyle(s).display, kids: document.getElementById("sheet-body").children.length, anims: s.getAnimations().length };
      });
      ok("A9 reduced motion: the close is instant (display none, body empty, no animation)", r.display === "none" && r.kids === 0 && r.anims === 0, r);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack || e); }
  await browser.close();
  console.log(`\ntimers: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
