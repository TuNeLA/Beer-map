// timers-probe.js (lane timers, B10) — MEASURE ONLY, no pass/fail. Counts timer callbacks (setTimeout, setInterval,
// requestAnimationFrame) per minute and the running infinite animations, by source file, in 3 states:
// map visible, a full sheet open, page hidden. Mocked backend. Usage: node timers-probe.js <port> [seconds per state]
const { ctxFor, boot, wait, clickJS } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SECS = Number(process.argv[3] || 30);

function instrument() {
  const C = window.__tc = { on: false, by: {}, n: { T: 0, I: 0, R: 0 } };
  // the file that first asked for the timer; js/smooth.js (PN.idle.every) is skipped so the caller counts; an interval is
  // known by its function (PN.idle.every makes a new interval for the same function when the map comes back)
  const who = new WeakMap();
  const src = () => {
    const s = (new Error().stack || "").split("\n"); let first = "";
    for (let i = 1; i < s.length; i++) {
      const m = /https?:\/\/[^/]+\/(?:test\/)?([\w./-]+\.js)(?:\?[^:]*)?:(\d+)/.exec(s[i]); if (!m) continue;
      if (!first) first = m[1] + ":" + m[2];
      if (!/smooth\.js$/.test(m[1])) return m[1] + ":" + m[2];
    }
    return first || "?";
  };
  const hit = (k, where) => { if (!C.on) return; C.n[k]++; const key = k + " " + where; C.by[key] = (C.by[key] || 0) + 1; };
  const oT = window.setTimeout, oI = window.setInterval, oR = window.requestAnimationFrame;
  window.setTimeout = function (fn, ms) {
    if (typeof fn !== "function") return oT.apply(window, arguments);
    const w = src(), a = [].slice.call(arguments, 2);
    return oT.call(window, function () { hit("T", w); return fn.apply(this, a); }, ms);
  };
  window.setInterval = function (fn, ms) {
    if (typeof fn !== "function") return oI.apply(window, arguments);
    let w0 = who.get(fn); if (!w0) { w0 = src(); who.set(fn, w0); }
    const w = w0 + "@" + ms, a = [].slice.call(arguments, 2);
    return oI.call(window, function () { hit("I", w); return fn.apply(this, a); }, ms);
  };
  window.requestAnimationFrame = function (fn) {
    const w = src();
    return oR.call(window, function (t) { hit("R", w); return fn(t); });
  };
  window.__tcHide = function (on) {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => on });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (on ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event(on ? "pagehide" : "pageshow"));
  };
  window.__tcAnims = function () {
    const out = {};
    for (const a of document.getAnimations()) {
      let t; try { t = a.effect.getComputedTiming(); } catch (e) { continue; }
      if (a.playState !== "running" || t.iterations !== Infinity) continue;
      const el = a.effect.target, nm = a.animationName || "waapi";
      const k = nm + " <" + (el && el.id ? "#" + el.id : el && el.className && el.className.baseVal === undefined ? "." + String(el.className).split(" ")[0] : el ? el.tagName : "?") + ">";
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  };
}

async function measure(page, label) {
  await page.evaluate(() => { const C = window.__tc; C.by = {}; C.n = { T: 0, I: 0, R: 0 }; C.on = true; });
  await wait(page, SECS * 1000);
  const r = await page.evaluate(() => { const C = window.__tc; C.on = false; return { n: C.n, by: C.by, anims: window.__tcAnims(), sheet: (() => { const s = document.getElementById("sheet"); if (!s || s.hidden) return null; const q = s.getBoundingClientRect(); return { top: Math.round(q.top), h: Math.round(q.height), vh: innerHeight }; })() }; });
  const f = 60 / SECS, pm = (x) => Math.round(x * f);
  console.log("\n== " + label + " (per minute; measured " + SECS + " s) ==");
  console.log("setTimeout " + pm(r.n.T) + " · setInterval " + pm(r.n.I) + " · rAF " + pm(r.n.R) + " · total " + pm(r.n.T + r.n.I + r.n.R) +
    " · infinite animations running " + Object.values(r.anims).reduce((a, b) => a + b, 0) + (r.sheet ? " · sheet " + JSON.stringify(r.sheet) : ""));
  const top = Object.entries(r.by).sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [k, v] of top) console.log("  " + String(pm(v)).padStart(6) + "  " + k);
  console.log("  anims: " + JSON.stringify(r.anims));
  return r;
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await ctx.addInitScript(instrument);
  await boot(page);
  // steady state: the start-up retry loops (season*.js wait max 60 s for the GL map; the stub map never comes) are over
  await page.waitForFunction(() => performance.now() > 66000, null, { timeout: 90000, polling: 1000 });
  await measure(page, "A map visible");
  // a full sheet: ⋯ Mer (or the first sheet we can open), measured as it is
  const which = process.env.PROBE_SHEET || "#btn-more";
  await clickJS(page, which); await wait(page, 2500);
  await measure(page, "B sheet open (" + which + ")");
  await page.evaluate(() => { const x = document.getElementById("sheet-close"); if (x) x.click(); });
  await wait(page, 1500);
  await page.evaluate(() => window.__tcHide(true));
  await wait(page, 500);
  await measure(page, "C page hidden (emulated visibilitychange)");
  await page.evaluate(() => window.__tcHide(false));
  await ctx.close(); await browser.close();
})();
