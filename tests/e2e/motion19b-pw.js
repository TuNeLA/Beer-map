// motion19b-pw.js — lane motion19b (owner GO 20 Nov 2026, audit motion19.md fixes 5, 7, 9, 10, 12-15 + the end-of-night card).
//   5  tap areas: hot-streak pills (p1/p2) take taps in a 44 px box; toast button is 44 px; the bottom dock hit boxes do not overlap
//   7  takeover: 100 ms dim (--m-2, D1), then the card; a 2nd tap in the first 400 ms is ignored; exit 200 ms; store = no card
//   6  "Hemma" card (nightlog.js homeCard): one card, 450 ms in, no confetti, "Godnatt" closes, "Min kväll" opens the log, store = no count
//   9  tab marker slides with --e-spring; 10 switch knob + ambient shrink use transform (not left / width / height); badge settles once
// Mocked Supabase. Usage: node motion19b-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { reduced: !!o.reduced });
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => window.FX && window.FX.takeover && window.NIGHTLOG && document.getElementById("btn-beer"), null, { timeout: 15000 }).catch(() => console.log("no FX/NIGHTLOG"));
  await wait(page, 300);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch();
  try {
    let { ctx, page, errs } = await open(browser);

    // ---- 5 · tap areas ----
    const t5 = await page.evaluate(() => {
      const host = document.createElement("div"); host.className = "leaflet-marker-icon"; host.style.cssText = "position:fixed;left:150px;top:300px;pointer-events:auto";
      host.innerHTML = '<div class="pill p1 pf p-bar" style="position:absolute;left:0;top:0">3</div><div class="pill p0 p-bar" style="position:absolute;left:0;top:200px">2</div>';
      document.body.appendChild(host);
      const out = {}; host.querySelectorAll(".pill").forEach((p, i) => { const a = getComputedStyle(p, "::after"); out["p" + i] = { pe: a.pointerEvents, w: parseFloat(a.width), h: parseFloat(a.height) }; });
      host.remove();
      const tb = document.createElement("div"); tb.className = "toast"; tb.innerHTML = '<span>x</span><button class="btn btn-small" type="button">Y</button>'; document.getElementById("toasts").appendChild(tb);
      out.toastBtn = tb.querySelector("button").getBoundingClientRect().height; tb.remove();
      return out;
    });
    ok("5 hot pill (p1) ::after takes taps and is 44 px", t5.p0.pe === "auto" && t5.p0.w >= 44 && t5.p0.h >= 44, t5);
    ok("5 calm pill ::after is 44 px", t5.p1.pe === "auto" && t5.p1.w >= 44 && t5.p1.h >= 44, t5);
    ok("5 toast button is 44 px", t5.toastBtn >= 44, t5);
    const dock = await page.evaluate(() => {
      const ids = [...document.querySelectorAll(".dock button, .dock .side-btn, #btn-beer, #btn-stop, #btn-other, #prec-exact, #prec-area")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; });
      const bad = [];
      ids.forEach((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!top || !(e === top || e.contains(top) || top.contains(e))) bad.push((e.id || e.className) + " covered by " + (top && (top.id || top.className))); });
      const boxes = ids.map((e) => { const r = e.getBoundingClientRect(); return { n: e.id || e.className, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      const lap = []; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j];
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w > 1 && h > 1 && !document.getElementById(a.n)?.contains(document.getElementById(b.n)) && !document.getElementById(b.n)?.contains(document.getElementById(a.n))) lap.push(a.n + "/" + b.n); }
      return { n: ids.length, bad, lap };
    });
    ok("5 dock: every button's centre hits itself (elementFromPoint), no two boxes overlap", dock.n >= 3 && dock.bad.length === 0 && dock.lap.length === 0, dock);

    // ---- 9 + 10 · tokens in the CSS ----
    const c = await page.evaluate(() => {
      const probe = document.createElement("i"); probe.style.transitionTimingFunction = "var(--e-spring)"; document.body.appendChild(probe);
      const spring = getComputedStyle(probe).transitionTimingFunction; probe.remove();
      const m = document.createElement("i"); m.className = "pn-seg-mark"; document.body.appendChild(m);
      const mk = getComputedStyle(m); const seg = { f: mk.transitionTimingFunction, d: mk.transitionDuration, p: mk.transitionProperty }; m.remove();
      const sw = document.createElement("button"); sw.className = "switch"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-checked", "true"); document.body.appendChild(sw);
      const sa = getComputedStyle(sw, "::after"); const knob = { p: sa.transitionProperty, tf: sa.transform }; sw.remove();
      const amb = document.createElement("div"); amb.className = "fx-amb amb-hot amb-calm"; amb.innerHTML = '<i class="a-l"></i><i class="a-b"></i><i class="a-t"></i><i class="a-r"></i>'; document.body.appendChild(amb);
      const ambP = [".a-l", ".a-b", ".a-t", ".a-r"].map((s) => getComputedStyle(amb.querySelector(s)).transitionProperty); amb.remove();
      const cm = document.createElement("div"); cm.className = "cer-card-m"; document.body.appendChild(cm);
      const badge = { n: getComputedStyle(cm).animationName, c: getComputedStyle(cm).animationIterationCount }; cm.remove();
      return { spring, seg, knob, ambP, badge };
    });
    ok("9 tab marker slides with --e-spring at 200 ms (transform + width)", c.seg.f.split("), ")[0].replace(/[ ,)]/g, "") === c.spring.split("), ")[0].replace(/[ ,)]/g, "") && /0\.2s/.test(c.seg.d) && /transform/.test(c.seg.p), c);
    ok("10 switch knob moves by transform, not left", /transform/.test(c.knob.p) && !/left/.test(c.knob.p), c.knob);
    ok("10 ambient calm shrink uses transform only (no width / height)", c.ambP.every((p) => p === "transform"), c.ambP);
    ok("10 rank / medal badge settles once (no repeated shine)", c.badge.n === "cerSettle" && c.badge.c === "1", c.badge);
    await ctx.close();

    // ---- 7 · takeover ----
    ({ ctx, page, errs } = await open(browser));
    const t7 = await page.evaluate(async () => {
      const W = (ms) => new Promise((r) => setTimeout(r, ms)), lv = window.LEVELS_SV.find((l) => l.at === 10), r = {};
      window.FX.takeover(2, { title: lv.names[0], sub: lv.lines[0], icon: lv.emoji, hint: "x", noAmbient: true });
      const tk = document.querySelector(".takeover"), a = tk.getAnimations()[0];
      r.dim = a && a.effect.getTiming().duration; r.coreDelay = Math.round(tk.querySelector(".to-core").getAnimations()[0].effect.getTiming().delay);
      await W(150); tk.click(); await W(80); r.at230 = document.body.contains(tk) && !tk.classList.contains("fx-tk-out");
      await W(300); tk.click(); r.out = tk.classList.contains("fx-tk-out"); r.exit = getComputedStyle(tk).transitionDuration;
      await W(300); r.gone = !document.body.contains(tk);
      return r;
    });
    // D1 (motiontok, 24 Nov): the dim is the token --m-2 (100 ms, was a raw 80 ms)
    ok("7 backdrop dim 100 ms (--m-2), card starts after it", t7.dim === 100 && t7.coreDelay === 100, t7);
    ok("7 a tap at ~230 ms is ignored, a tap after 400 ms closes it", t7.at230 === true && t7.out === true, t7);
    ok("7 exit is 200 ms and the card is removed", /0\.2s/.test(t7.exit) && t7.gone, t7);
    await ctx.close();

    // ---- 6 · the Hemma card ----
    ({ ctx, page, errs } = await open(browser));
    const h1 = await page.evaluate(async () => {
      const W = (ms) => new Promise((r) => setTimeout(r, ms));
      const r = { has: typeof window.NIGHTLOG.homeCard === "function" }; if (!r.has) return r;
      const t = document.createElement("div"); t.className = "toast"; t.innerHTML = "<span>Välkommen hem</span>"; document.getElementById("toasts").appendChild(t);
      window.NIGHTLOG.onStopped("home");
      for (let i = 0; i < 100 && !document.querySelector(".hm-box"); i++) await W(20);
      const a0 = document.querySelector(".hm-box") && document.querySelector(".hm-box").getAnimations()[0]; r.dur = a0 ? a0.effect.getTiming().duration : null; await W(900);
      const card = document.querySelector(".hm-card"), box = card && card.querySelector(".hm-box");
      r.cards = document.querySelectorAll(".hm-card").length; r.title = box && box.querySelector(".hm-title").textContent; r.line = box && box.querySelector(".hm-line").textContent;
      r.toastGone = !document.body.contains(t);
      r.confetti = document.querySelectorAll(".hm-card canvas, .hm-card .pm-p, .hm-card [class*=confetti]").length;
      r.btn = box && [...box.querySelectorAll("button")].map((b) => ({ t: b.textContent, h: Math.round(b.getBoundingClientRect().height) }));
      r.total = box && !!box.querySelector(".hm-total");
      window.NIGHTLOG.homeCard(); r.again = document.querySelectorAll(".hm-card").length;   // a 2nd ending inside 90 s adds no 2nd card
      const ok = box && box.querySelector(".hm-ok"); if (ok) ok.click(); await W(350); r.closed = !document.querySelector(".hm-card");
      return r;
    });
    ok("6 NIGHTLOG.homeCard exists", h1.has, h1);
    ok("6 'Jag är hemma' shows ONE card with a title and a line, and the plain toast is gone", h1.cards === 1 && !!h1.title && !!h1.line && h1.toastGone === true, h1);
    ok("6 card comes in over 450 ms, no confetti, buttons 44 px", h1.dur === 450 && h1.confetti === 0 && h1.btn && h1.btn.every((b) => b.h >= 44), h1);
    ok("6 a 2nd ending adds no 2nd card; 'Godnatt' closes it", h1.again === 1 && h1.closed === true, h1);
    ok("6 no page errors", errs.length === 0, errs);
    await ctx.close();

    // Min kväll link: needs the night total, so mock my_night_log with 4 drinks
    ({ ctx, page, errs } = await open(browser));
    await page.route(/rest\/v1\/rpc\/my_night_log/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ night: new Date().toISOString(), evening: new Date().toISOString().slice(0, 10), tonight: true, stats: { drinks: 4, bars: 1, per_hour: 1.5, kinds: { ol: 4 } }, items: [], nights: [] }) }));
    const h2 = await page.evaluate(async () => {
      const W = (ms) => new Promise((r) => setTimeout(r, ms)); window.NIGHTLOG.homeCard(); await W(1200);
      const box = document.querySelector(".hm-box"); const r = { total: box && box.querySelector(".hm-total b") && box.querySelector(".hm-total b").textContent, link: !!(box && box.querySelector(".hm-link")) };
      if (r.link) box.querySelector(".hm-link").click(); await W(900); r.sheet = !!document.querySelector("#sheet:not([hidden]) .nl"); r.cardGone = !document.querySelector(".hm-card");
      return r;
    });
    ok("6 the night total shows as information (4) and 'Min kväll' opens the log", h2.total === "4" && h2.link && h2.sheet && h2.cardGone, h2);
    await ctx.close();

    // store build: the card shows, but no count
    ({ ctx, page, errs } = await open(browser, { store: true }));
    await page.route(/rest\/v1\/rpc\/my_night_log/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stats: { drinks: 4 }, items: [], nights: [] }) }));
    const h3 = await page.evaluate(async () => { const W = (ms) => new Promise((r) => setTimeout(r, ms)); window.NIGHTLOG.homeCard(); await W(1200);
      return { store: window.FX.store(), card: !!document.querySelector(".hm-card"), total: !!document.querySelector(".hm-total"), link: !!document.querySelector(".hm-link") }; });
    ok("6 store build: the card shows with no count and no log link", h3.store && h3.card && !h3.total && !h3.link, h3);
    await ctx.close();

    // reduced motion: still
    ({ ctx, page, errs } = await open(browser, { reduced: true }));
    const h4 = await page.evaluate(async () => { const W = (ms) => new Promise((r) => setTimeout(r, ms)); window.NIGHTLOG.homeCard(); await W(900);
      const c = document.querySelector(".hm-card"); return { card: !!c, anims: c ? c.getAnimations({ subtree: true }).length : -1 }; });
    ok("6 reduced motion: the card is still", h4.card && h4.anims === 0, h4);
    await ctx.close();
  } finally { await browser.close(); }
  console.log("motion19b: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
