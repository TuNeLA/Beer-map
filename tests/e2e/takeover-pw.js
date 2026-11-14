// takeover-pw.js — lane takeover, I-105 (owner 14 Nov 2026: "the pop-up at 10 looked weird"). The full-screen card at
// drink 5 / 10 / 15 (docs/js/fx.js takeover, docs/takeover.css, docs/js/app-beer.js beerDone):
//   1 one text: no tap toast behind the card; the ↩ Ångra button comes when the card closes and then lives its 10 s
//   2 fit: every name, line and gag of the 5 / 10 / 15 pools fits at 360 / 390 / 430 px (title max 2 lines, no cut word)
//   3 tap guard: a close tap in the first 600 ms does nothing
//   4 entrance: emoji 60 ms, title 120 ms, line / buttons / hint 220-340 ms, transform + opacity only; reduced motion = 150 ms fade
//   5 store builds (OLNU_STORE): no foam, no squash, no card, no level pop, no edge glow; the plain toast and the count stay
// Mocked Supabase. Usage: node takeover-pw.js <port>     (TK_SHOTS=<dir> also saves takeover-5/10/15.png at 390x844)
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SHOTS = process.env.TK_SHOTS ? process.env.TK_SHOTS.replace(/\/?$/, "/") : "";
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 600)); };

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: o.w || 390, height: o.h || 844 }, { reduced: !!o.reduced, postN: o.n || 7 });
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  const errs = [], calls = []; page.on("pageerror", (e) => errs.push(e.message));
  const n = o.n || 7;
  await page.route(/rest\/v1\/rpc\/post_beer_v2/, (r) => { calls.push("post_beer_v2"); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accepted: true, beer_count: n, drinks: n,
    lat: 60.1511, lng: 15.1876, precise: true, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() }) }); });
  await page.route(/rest\/v1\/rpc\/undo_beer/, (r) => { calls.push("undo_beer"); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ undone: true, beer_count: n - 1 }) }); });
  await boot(page);
  await page.waitForFunction(() => window.FX && window.FX.takeover && window.LEVELS_SV && document.getElementById("btn-beer"), null, { timeout: 15000 }).catch(() => console.log("no FX"));
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await wait(page, 300);
  return { ctx, page, errs, calls };
}
// what is on screen now (runs in the page)
const state = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const tk = document.querySelector(".takeover"), u = document.querySelector(".undo-fab"), m = document.getElementById("pn-mine");
  return { tk: !!tk, out: !!(tk && tk.classList.contains("fx-tk-out")), title: tk ? tk.querySelector(".to-title").textContent : "",
    toasts: [...document.querySelectorAll("#toasts .toast")].filter(vis).map((t) => t.textContent.trim().slice(0, 90)),
    // every other text pop-up on screen: the "Öl #N registrerad" chip and anything that announces itself (role status / alert).
    // Not .dl-cap: the "Dagens order" greeting on the map is there before the tap.
    more: [...document.querySelectorAll(".pn-beerok, body > [role=status], body > [role=alert]")].filter((e) => e !== tk && !(tk && tk.contains(e)) && !e.classList.contains("dl-cap") && vis(e) && e.textContent.trim()).map((e) => (e.className || e.id) + ": " + e.textContent.trim().slice(0, 60)),
    undo: !!(u && vis(u)), mine: !!(m && !m.hidden && vis(m)),
    fest: [".jc-cv", ".beer-wrap.jc-pop", ".fx-amb", ".fx-pop", ".foam-splash", ".takeover", ".pm-burst"].filter((s) => document.querySelector(s)) };
};
const clickCard = (page) => page.evaluate(() => { const t = document.querySelector(".takeover"); if (t) t.click(); return !!t; });
// a real ÖL! tap; n = my count before it (the mocked night has 6: set 4 to cross 5)
const tapBeer = (page, n) => page.evaluate((n) => { if (n != null) window.PN.s.meState = { beer_count: n, other_count: 0 }; document.getElementById("btn-beer").click(); }, n == null ? null : n);
async function untilCard(page, ms) { const end = Date.now() + (ms || 6000); while (Date.now() < end) { if (await page.evaluate(() => !!document.querySelector(".takeover"))) return true; await wait(page, 40); } return false; }

// 2 · every pool string, measured in the page. Returns { n, bad[] }.
const fitAll = async () => {
  const W = (ms) => new Promise((r) => setTimeout(r, ms)), vw = innerWidth, vh = innerHeight, bad = [];
  const t = (k, d) => { try { const x = window.PN && PN.t ? PN.t(k) : ""; return x && x !== k ? x : d; } catch (e) { return d; } };
  let taxi = ""; try { taxi = (window.PN && PN.mods && PN.mods("medevacExtraHTML")) || ""; } catch (e) {}
  if (!taxi) taxi = '<div class="taxi-row"><a class="to-taxi" href="tel:024013900">Ludvikataxi 0240-139 00</a><a class="to-taxi taxi-uber" href="https://m.uber.com/">Uber</a></div>';
  const gags = Array.isArray(window.FX_GAGS_SV) ? window.FX_GAGS_SV : [], cases = [];
  let g = 0;
  [5, 10, 15].forEach((at) => {
    const lv = window.LEVELS_SV.find((l) => l.at === at), level = at === 5 ? 1 : 2, vs = window.FX.variants[level], N = Math.max(lv.names.length, lv.lines.length);
    for (let i = 0; i < N; i++) cases.push({ at, level, title: lv.names[i % lv.names.length], sub: lv.lines[i % lv.lines.length], icon: lv.emoji, color: lv.color, variant: vs[i % vs.length], gag: gags.length ? gags[g++ % gags.length] : "", extra: level === 2 ? taxi : "" });
    if (at === 5) lv.names.forEach((nm, i) => cases.push({ at, level, title: nm, sub: lv.lines[i], icon: lv.emoji, color: lv.color, variant: "burn", gag: gags[g++ % (gags.length || 1)] || "" }));   // burn = letters are spans
  });
  for (; g < gags.length; g++) cases.push({ at: 10, level: 2, title: "Kartläsarläget", sub: window.LEVELS_SV.find((l) => l.at === 10).lines[0], icon: "+", variant: window.FX.variants[2][g % 4], gag: gags[g], extra: taxi });
  // the texts without the Swedish level pools (English, old content)
  cases.push({ at: 5, level: 1, title: t("hotTitle", "VATTENBÄRAREN"), sub: t("hotSub", "Nr 5 ikväll. Ett glas vatten nu."), variant: "wall" });
  cases.push({ at: 10, level: 2, title: t("medTitle", "SJUKVÅRDARE TILL PLATS 3"), sub: t("medSub", "Nr 10. Förstärkning på väg."), variant: "lightbar", extra: taxi });
  cases.push({ at: 10, level: 2, title: "LEGEND MODE", sub: "No. 10 tonight. The squad salutes you.", variant: "stripes", extra: taxi });
  cases.push({ at: 0, level: 2, title: "Vattenbärarförstärkningskompaniet", sub: "x", variant: "beacons", long: true });   // a word no screen can hold: wrap, never cut
  for (const c of cases) {
    document.querySelectorAll(".takeover").forEach((x) => x.remove());
    window.FX.takeover(c.level, { title: c.title, sub: c.sub, icon: c.icon, color: c.color, gag: c.gag || false, hint: "Tryck för att stänga", extraHTML: c.extra || "", noAmbient: true, variant: c.variant });
    await W(30);
    const tk = document.querySelector(".takeover"); if (!tk) { bad.push({ c: c.title, why: "no card" }); continue; }
    tk.getAnimations({ subtree: true }).forEach((a) => { try { a.finish(); } catch (e) {} });   // the end state (endless effects throw: fine)
    const q = (s) => tk.querySelector(s), core = q(".to-core"), ti = q(".to-title"), cr = core.getBoundingClientRect(), why = [];
    const lh = parseFloat(getComputedStyle(ti).lineHeight) || parseFloat(getComputedStyle(ti).fontSize), lines = Math.round(ti.offsetHeight / lh), fs = parseFloat(getComputedStyle(ti).fontSize);
    if (ti.scrollWidth > ti.clientWidth + 1) why.push("title wider than its box " + ti.scrollWidth + ">" + ti.clientWidth);
    if (lines > 2 && !c.long) why.push("title " + lines + " lines");
    if (fs < 24 && !c.long) why.push("title font " + fs);
    if (ti.classList.contains("to-brk") && !c.long) why.push("title word is cut");
    if (cr.left < -0.5 || cr.right > vw + 0.5 || cr.top < 0 || cr.bottom > vh) why.push("card off screen " + [cr.left, cr.right, cr.top, cr.bottom].map(Math.round));
    [".to-icon", ".to-title", ".to-sub", ".to-gag", ".to-extra", ".to-hint"].forEach((s) => {
      const e = q(s); if (!e) return; const r = e.getBoundingClientRect();
      if (r.left < -0.5 || r.right > vw + 0.5) why.push(s + " off screen " + Math.round(r.left) + ".." + Math.round(r.right));
      if (c.level === 2 && (r.left < cr.left - 0.5 || r.right > cr.right + 0.5)) why.push(s + " outside the card");
      if (e.scrollWidth > e.clientWidth + 1) why.push(s + " text wider than its box");
    });
    tk.querySelectorAll(".to-taxi").forEach((b) => { const r = b.getBoundingClientRect(); if (r.height < 44 || r.right > cr.right + 0.5 || r.left < cr.left - 0.5) why.push("taxi button " + Math.round(r.height) + " px / outside"); });
    if (why.length) bad.push({ at: c.at, v: c.variant, title: c.title, fs, why: why.join("; ") });
  }
  document.querySelectorAll(".takeover").forEach((x) => x.remove());
  return { n: cases.length, bad };
};

(async () => {
  const browser = await chromium.launch();
  try {
    let ctx, page, errs, calls;
    // ---------- 2 · fit at 360 / 390 / 430 ----------
    for (const [w, h] of [[360, 780], [390, 844], [430, 932]]) {
      ({ ctx, page, errs } = await open(browser, { w, h }));
      const f = await page.evaluate(fitAll);
      ok("2 fit @" + w + ": all " + f.n + " cards (every 5/10/15 name, line and gag) fit, title max 2 lines, no cut word", f.n > 30 && f.bad.length === 0, { bad: f.bad.length, first: f.bad.slice(0, 4) });
      ok("2 fit @" + w + ": no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    // ---------- 1 + 3 · real tap at 10: one text, tap guard, Ångra after the card ----------
    ({ ctx, page, errs, calls } = await open(browser, { n: 10 }));
    await tapBeer(page);
    ok("10: the card shows after the tap", await untilCard(page));
    await clickCard(page);   // a quick 2nd tap, < 600 ms after the card came
    await wait(page, 150);
    let s = await page.evaluate(state);
    ok("3 a tap in the first 600 ms does not close the card", s.tk && !s.out, s);
    await wait(page, 250);
    s = await page.evaluate(state);
    ok("1 one text: no tap toast and no other pop-up behind the card", s.tk && s.toasts.length === 0 && s.more.length === 0, s);
    ok("1 the Ångra button waits for the card", s.tk && !s.undo, s);
    if (SHOTS) { await wait(page, 500); await page.screenshot({ path: SHOTS + "takeover-10.png" }); }
    await wait(page, 500);
    await clickCard(page);
    await wait(page, 500);
    s = await page.evaluate(state);
    ok("3 a tap after 600 ms closes the card", !s.tk, s);
    ok("1 Ångra shows when the card is closed, still no 2nd text", s.undo && s.toasts.length === 0 && s.more.length === 0, s);
    await page.evaluate(() => { const u = document.querySelector(".undo-fab"); if (u) u.click(); });
    await wait(page, 600);
    ok("1 Ångra works (undo_beer sent)", calls.includes("undo_beer"), calls);
    ok("10: no page errors", errs.length === 0, errs);
    await ctx.close();

    // ---------- 1 · 15, card left alone: Ångra lives its 10 s from the close, not from the tap ----------
    ({ ctx, page, errs } = await open(browser, { n: 15 }));
    await tapBeer(page);
    ok("15: the card shows after the tap", await untilCard(page));
    await wait(page, 900);
    s = await page.evaluate(state);
    ok("15: one text, no toast, no other pop-up, no Ångra over the card", s.tk && s.toasts.length === 0 && s.more.length === 0 && !s.undo, s);
    if (SHOTS) await page.screenshot({ path: SHOTS + "takeover-15.png" });
    await page.waitForFunction(() => !document.querySelector(".takeover"), null, { timeout: 12000 }).catch(() => {});
    await wait(page, 5000);
    s = await page.evaluate(state);
    ok("15: Ångra is still there 5 s after the card closed by itself", !s.tk && s.undo, s);
    await ctx.close();

    // ---------- 5 (fire, no card frame): one text + screenshot ----------
    ({ ctx, page, errs } = await open(browser, { n: 5 }));
    await tapBeer(page, 4);
    ok("5: the fire screen shows after the tap", await untilCard(page));
    await wait(page, 900);
    s = await page.evaluate(state);
    ok("5: one text, no toast, no other pop-up, no Ångra over it", s.tk && s.toasts.length === 0 && s.more.length === 0 && !s.undo, s);
    if (SHOTS) await page.screenshot({ path: SHOTS + "takeover-5.png" });
    await ctx.close();

    // ---------- 4 · entrance motion ----------
    ({ ctx, page, errs } = await open(browser));
    const mo = await page.evaluate(() => {
      const lv = window.LEVELS_SV.find((l) => l.at === 10);
      window.FX.takeover(2, { title: lv.names[0], sub: lv.lines[0], icon: lv.emoji, gag: "x", hint: "Tryck för att stänga", noAmbient: true, variant: "lightbar", extraHTML: '<div class="taxi-row"><a class="to-taxi">Taxi</a></div>' });
      const tk = document.querySelector(".takeover"), out = {}, props = {};
      [".to-core", ".to-icon", ".to-title", ".to-sub", ".to-gag", ".to-extra", ".to-hint"].forEach((sel) => {
        const e = tk.querySelector(sel), a = e.getAnimations()[0]; if (!a) { out[sel] = null; return; }
        const tm = a.effect.getTiming(), kf = a.effect.getKeyframes();
        kf.forEach((k) => Object.keys(k).forEach((p) => { if (!/^(offset|computedOffset|easing|composite)$/.test(p)) props[p] = 1; }));
        out[sel] = { name: a.animationName, delay: tm.delay, dur: tm.duration, from: kf[0] && kf[0].transform, o: kf[0] && kf[0].opacity };
      });
      const root = tk.getAnimations()[0];
      return { out, props: Object.keys(props).sort(), root: root && root.effect.getTiming().duration };
    });
    const d = (k) => (mo.out[k] ? mo.out[k].delay : -1), du = (k) => (mo.out[k] ? mo.out[k].dur : -1);
    ok("4 stagger: emoji 60 ms, title 120 ms, line 220, buttons 280, hint 340", d(".to-icon") === 60 && d(".to-title") === 120 && d(".to-sub") === 220 && d(".to-extra") === 280 && d(".to-hint") === 340, mo.out);
    ok("4 times: card / emoji / title 300 ms, line / buttons / hint 200 ms, backdrop 200 ms", du(".to-core") === 300 && du(".to-icon") === 300 && du(".to-title") === 300 && du(".to-sub") === 200 && du(".to-extra") === 200 && du(".to-hint") === 200 && mo.root === 200, mo);
    ok("4 only transform + opacity move", mo.props.length > 0 && mo.props.every((p) => p === "transform" || p === "opacity"), mo.props);
    ok("4 no 2.4x title slam, no spinning emoji", !!mo.out[".to-title"] && /scale\(1\.25\)/.test(mo.out[".to-title"].from) && !!mo.out[".to-icon"] && /scale\(0?\.6\)/.test(mo.out[".to-icon"].from) && !/rotate/.test(mo.out[".to-icon"].from), mo.out);
    await wait(page, 750);
    const o1 = await page.evaluate(() => { const tk = document.querySelector(".takeover"); tk.click(); const cs = getComputedStyle(tk); return { out: tk.classList.contains("fx-tk-out"), tr: cs.transitionDuration, pe: cs.pointerEvents }; });
    await wait(page, 300);
    ok("4 exit: 150 ms fade, no taps while it leaves, then gone", o1.out && /0\.15s/.test(o1.tr) && o1.pe === "none" && !(await page.evaluate(() => !!document.querySelector(".takeover"))), o1);
    ok("4 no page errors", errs.length === 0, errs);
    await ctx.close();

    // reduced motion: one plain 150 ms fade, nothing else moves; the fit still works
    ({ ctx, page, errs } = await open(browser, { reduced: true }));
    const rm = await page.evaluate(() => {
      const lv = window.LEVELS_SV.find((l) => l.at === 10);
      window.FX.takeover(2, { title: "Kartläsarläget", sub: lv.lines[0], icon: lv.emoji, gag: "x", hint: "x", noAmbient: true });
      const tk = document.querySelector(".takeover"), ti = tk.querySelector(".to-title");
      const all = tk.getAnimations({ subtree: true }).map((a) => ({ n: a.animationName, on: a.effect.target === tk, dur: a.effect.getTiming().duration, p: a.effect.getKeyframes().map((k) => Object.keys(k).filter((x) => !/^(offset|computedOffset|easing|composite)$/.test(x)).join()).join("|") }));
      return { still: tk.classList.contains("still"), all, fit: ti.scrollWidth <= ti.clientWidth + 1 };
    });
    ok("4 reduced motion: only a 150 ms opacity fade of the whole card", rm.still && rm.all.length === 1 && rm.all[0].on && rm.all[0].dur === 150 && /^(opacity\|?)+$/.test(rm.all[0].p), rm);
    ok("2 reduced motion: the title still fits", rm.fit, rm);
    await ctx.close();

    // ---------- 5 · store build: no drinking celebration ----------
    ({ ctx, page, errs } = await open(browser, { n: 10, store: true }));
    const seen = {}; let last = null;
    ok("5 store flag on", await page.evaluate(() => window.OLNU_STORE === true));
    last = await page.evaluate(state); last.fest.forEach((k) => { seen[k] = 1; });   // the "hot" edge glow of my own pin (6 beers) must be off too
    await tapBeer(page);
    for (let i = 0; i < 30; i++) { await wait(page, 100); last = await page.evaluate(state); last.fest.forEach((k) => { seen[k] = 1; }); }
    ok("5 store: ÖL! at 10 gives no foam, squash, card, level pop or edge glow", Object.keys(seen).length === 0, Object.keys(seen));
    ok("5 store: the plain toast (one text) and the Ångra button show", last.toasts.length === 1 && last.undo, last);
    ok("5 store: the count button stays", last.mine, last);
    const st = await page.evaluate(async () => {
      const W = (ms) => new Promise((r) => setTimeout(r, ms)), b = document.getElementById("btn-beer"), lv = window.LEVELS_SV.find((l) => l.at === 5);
      const got = () => [".jc-cv", ".beer-wrap.jc-pop", ".fx-amb", ".fx-pop", ".foam-splash", ".takeover"].filter((s) => document.querySelector(s));
      const out = {}; let closed = 0;
      window.FX.juice.press(b); out.press = got();
      window.FX.splash(b, "foam"); out.splash = got();
      window.FX.levelPop({ emoji: "x", intensity: 3 }); out.pop = got();
      window.FX.ambient(2, 20000); out.amb = got();
      out.ret = window.FX.takeover(1, { title: lv.names[0], sub: lv.lines[0], onClose: () => { closed++; } }); out.tk = got();
      await W(60); out.closed = closed; out.store = window.FX.store();
      return out;
    });
    ok("5 store: FX.juice.press / splash / levelPop / ambient / takeover make no celebration nodes", st.store === true && !st.press.length && !st.splash.length && !st.pop.length && !st.amb.length && !st.tk.length && !st.ret, st);
    ok("5 store: a refused card still tells its caller it is over (onClose)", st.closed === 1, st);
    ok("5 store: no page errors", errs.length === 0, errs);
    await ctx.close();

    // the same calls in a normal web build DO show (the store check is not a kill switch)
    ({ ctx, page, errs } = await open(browser));
    const web = await page.evaluate(() => {
      const b = document.getElementById("btn-beer"); window.FX.juice.press(b); window.FX.levelPop({ emoji: "x", intensity: 3 }); window.FX.ambient(2, 20000);
      const out = { store: window.FX.store(), cv: !!document.querySelector(".jc-cv"), sq: !!document.querySelector(".beer-wrap.jc-pop"), pop: !!document.querySelector(".fx-pop"), amb: !!document.querySelector(".fx-amb") };
      window.FX.ambientStop(true); return out;
    });
    ok("web build: foam, squash, level pop and edge glow still run", web.store === false && web.cv && web.sq && web.pop && web.amb, web);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL crash", e.stack || e.message); }
  await browser.close();
  console.log("takeover: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
