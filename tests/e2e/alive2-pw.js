// alive2-pw.js — lane alive2 (owner 13 Nov 2026, I-77 "the app must feel alive"): docs/js/alive2.js + docs/alive2.css, the top 5
// "alive" effects behind window.PN_ALIVE2 flags. Date mocked to Fri 13 Nov 2026 20:00 Stockholm, 390 px, mocked Supabase (port B).
//   each effect appears on its trigger (friend ÖL! ripple, holiday ÖL! pulse + badge bob, Skåltimmen glow, my ÖL! foam, weekend
//   dusk), pauses on movestart / html.map-moving / a hidden tab, is still under reduced motion, the 12-element budget holds, a store
//   build (OLNU_STORE) has no drink effect, Sat noon / a Tuesday evening have no holiday / dusk, no page errors.
// Usage: node alive2-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const { OUT } = require("./env.js");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 400)); };
const D13 = new Date("2026-11-13T20:00:00+01:00"), D14 = new Date("2026-11-14T12:00:00+01:00"), TUE = new Date("2026-11-17T20:00:00+01:00");

async function open(browser, date, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { reduced: !!o.reduced });
  await ctx.clock.setFixedTime(date);
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => window.ALIVE2 && window.AFTER && document.querySelector(".beer-wrap"), null, { timeout: 15000 }).catch(() => console.log("no ALIVE2"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" });
  await page.evaluate(() => { window.__map.closePopup(); ALIVE2.refresh(); });
  await wait(page, 500);
  return { ctx, page, errs };
}
// running / paused animations of the alive2 nodes (sel = one selector)
const anim = (page, sel) => page.evaluate((s) => {
  const roots = [...document.querySelectorAll(s)];
  const a = document.getAnimations().filter((x) => x.effect && x.effect.target && roots.some((r) => r === x.effect.target || r.contains(x.effect.target)));
  return { n: roots.length, run: a.filter((x) => x.playState === "running").length, paused: a.filter((x) => x.playState === "paused").length,
    names: [...new Set(a.map((x) => x.animationName))], inf: a.some((x) => x.effect.getTiming().iterations === Infinity) };
}, sel);
const centre = (page) => page.evaluate(() => { const c = __map.getCenter(); return [c.lat, c.lng]; });
const friendPoll = (page, n = 1) => page.evaluate((n) => {
  const c = __map.getCenter(), now = Date.now(), add = [];
  for (let i = 0; i < n; i++) add.push({ id: 990000 + Math.floor(Math.random() * 9000) + i, lat: c.lat + i * 0.0004, lng: c.lng + i * 0.0004, beer_count: 1, precise: true,
    created_at: new Date(now - 40e3).toISOString(), is_mine: false, friend_name: "Testvän", skal_count: 0 });
  ALIVE2.onPoll((PN.s.beers || []).concat(add));
  return add.length;
}, n);
const skalOn = (page) => page.evaluate(() => { window.SKAL = window.SKAL || {}; const end = new Date(Date.now() + 30 * 60e3).toISOString(); SKAL.data = () => [{ group_id: "g1", ends_at: end }]; ALIVE2.refresh(); });

(async () => {
  const b = await chromium.launch();
  try {
    /* ---------- 1. web, Fri 13 Nov 20:00 ---------- */
    {
      const { ctx, page, errs } = await open(b, D13);
      const st = await page.evaluate(() => ({ s: ALIVE2._state(), hook: PN.hookNames().includes("ALIVE2"), css: [...document.styleSheets].some((x) => /alive2\.css/.test(x.href || "")) }));
      ok("web: every PN_ALIVE2 flag is ON, not a store build, the module is a PN hook, alive2.css loaded",
        Object.values(st.s.flags).every((v) => v === true) && Object.keys(st.s.flags).length === 6 && !st.s.store && st.hook && st.css, st);
      // 2. holiday ÖL! pulse + bob
      const hr = await anim(page, "#a2-holring"), hb = await anim(page, "#af-hol-e[data-a2bob]");
      const geo = await page.evaluate(() => { const r = document.getElementById("a2-holring").getBoundingClientRect(), q = document.getElementById("btn-beer").getBoundingClientRect();
        const cx = q.left + q.width / 2, cy = q.top + q.height / 2, e = document.elementFromPoint(cx, cy);
        return { dc: Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy), dw: (r.width - q.width) / q.width, hit: !!(e && e.closest("#btn-beer")), col: getComputedStyle(document.getElementById("a2-holring")).boxShadow.slice(0, 60) }; });
      ok("Fredag 13: the purple ÖL! pulse runs (a2-hol, endless) on the ÖL! ring", hr.n === 1 && hr.run >= 1 && hr.names.includes("a2-hol") && hr.inf, hr);
      ok("Fredag 13: the pulse sits exactly on the ÖL! ring and does not take the tap", geo.dc < 1.5 && geo.dw > -0.01 && geo.dw < 0.08 && geo.hit, geo);
      ok("Fredag 13: the cat scene bobs again (a2-bob, endless) and its own loops still run", hb.n === 1 && hb.names.includes("a2-bob") && hb.inf && hb.run >= 3, hb);
      await page.screenshot({ path: OUT + "ui-testshots/alive2-f13-390.png" });
      // 5. weekend dusk (Fri 20:00, dark in Ludvika)
      const du = await anim(page, "#a2-dusk");
      ok("Fri 20:00: the weekend dusk light drifts (2 layers, endless)", du.n === 1 && du.run === 2 && du.inf, du);
      // 3. Skåltimmen glow
      const s0 = await anim(page, "#a2-skal");
      await skalOn(page); await wait(page, 200);
      const s1 = await anim(page, "#a2-skal");
      ok("Skåltimmen: no glow before, a slow glow while my group's hour runs", s0.n === 0 && s1.n === 1 && s1.run === 1 && s1.names.includes("a2-breathe"), { s0, s1 });
      // 1. friend ÖL! ripple
      await friendPoll(page, 1); await wait(page, 250);
      const r1 = await anim(page, ".a2-ripple");
      ok("friend ÖL!: a new friend pin in view sends a ripple (2 rings)", r1.n === 1 && r1.run === 2 && r1.names.includes("a2-rip"), r1);
      await page.screenshot({ path: OUT + "ui-testshots/alive2-ripple-390.png" });
      await wait(page, 2900);
      const r2 = await anim(page, ".a2-ripple");
      ok("friend ÖL!: the ripple is gone after it ran (one-shot)", r2.n === 0, r2);
      const again = await page.evaluate(() => { ALIVE2.onPoll(PN.s.beers.slice()); return document.querySelectorAll(".a2-ripple").length; });
      ok("friend ÖL!: an old / known pin gives no ripple", again === 0, again);
      // 4. my ÖL! foam
      const c = await centre(page);
      await page.evaluate((c) => ALIVE2.onBeerAccepted({ lat: c[0], lng: c[1] }, { ghost: true }), c);
      const fg = await anim(page, ".a2-foam");
      await page.evaluate((c) => ALIVE2.onBeerAccepted({ lat: c[0], lng: c[1] }, { ghost: false, total: 1 }), c); await wait(page, 150);
      const f1 = await anim(page, ".a2-foam");
      ok("my ÖL!: a foam ring + bubbles at my pin; none in ghost mode", fg.n === 0 && f1.n === 1 && f1.run >= 3 && f1.names.includes("a2-foam"), { fg, f1 });
      await wait(page, 2200);
      ok("my ÖL!: the foam is gone after 2 s", (await anim(page, ".a2-foam")).n === 0);
      // pause on movestart / html.map-moving, run again after moveend
      await page.evaluate(() => __map.fire("movestart"));
      const pm = await anim(page, ".a2-fx,#af-hol-e[data-a2bob]");
      await page.evaluate(() => __map.fire("moveend")); await wait(page, 700);
      const pr = await anim(page, ".a2-fx,#af-hol-e[data-a2bob]");
      await page.evaluate(() => { document.documentElement.classList.add("map-moving"); document.dispatchEvent(new CustomEvent("pn:mapmove", { detail: { moving: true } })); });
      const pc = await anim(page, "#a2-holring,#a2-dusk,#a2-skal");
      await page.evaluate(() => { document.documentElement.classList.remove("map-moving"); document.dispatchEvent(new CustomEvent("pn:mapmove", { detail: { moving: false } })); });
      const pd = await anim(page, "#a2-holring,#a2-dusk,#a2-skal");
      ok("movestart: every alive2 animation is paused; moveend: they run again", pm.run === 0 && pm.paused >= 5 && pr.run >= 5 && pr.paused === 0, { pm, pr });
      ok("html.map-moving / pn:mapmove: the loops are paused, and run again after", pc.run === 0 && pc.paused >= 4 && pd.run >= 4, { pc, pd });
      // hidden tab: paused, no new effect starts
      const hid = await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
        const c = __map.getCenter(), r = ALIVE2.ripple(c.lat, c.lng), f = ALIVE2.foam(c.lat, c.lng);
        const run = document.getAnimations().filter((a) => a.playState === "running" && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(".a2-fx")).length;
        const cls = document.documentElement.classList.contains("a2-hidden");
        delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));
        return { r, f, run, cls, after: document.documentElement.classList.contains("a2-hidden") };
      });
      ok("hidden tab: loops paused, no new ripple / foam; visible again = running", !hid.r && !hid.f && hid.run === 0 && hid.cls && !hid.after, hid);
      // budget: max 12 animated elements, max 3 ripples
      const bud = await page.evaluate(() => { const c = __map.getCenter(); let n = 0; for (let i = 0; i < 10; i++) if (ALIVE2.ripple(c.lat + i * 1e-4, c.lng)) n++;
        ALIVE2.foam(c.lat, c.lng); const u = ALIVE2._budget();
        return { made: n, ripples: document.querySelectorAll(".a2-ripple").length, used: u.used, max: u.max, nodes: document.getAnimations().filter((a) => a.playState === "running" && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(".a2-fx:not(#af-hol-e)")).length }; });
      ok("budget: 10 ripple calls = max 3 ripples, the effects use <= 12 animated elements", bud.ripples <= 3 && bud.used <= 12 && bud.max === 12 && bud.nodes <= 12, bud);
      // still endless after 8 s (no 3-cycle stop on our loops)
      await wait(page, 8000);
      const late = await anim(page, "#a2-holring,#a2-dusk,#a2-skal,#af-hol-e[data-a2bob]");
      ok("after 8 s (3 cycles of the pulse): the loops still run", late.run >= 5, late);
      ok("web: no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    /* ---------- 2. reduced motion: still ---------- */
    {
      const { ctx, page, errs } = await open(b, D13, { reduced: true });
      await skalOn(page); await friendPoll(page, 1); await wait(page, 200);
      const c = await centre(page);
      const foam = await page.evaluate((c) => ALIVE2.foam(c[0], c[1]), c);
      const a = await anim(page, ".a2-fx,#af-hol-e");
      const st = await page.evaluate(() => ({ ring: !!document.querySelector("#a2-holring.a2-still"), dusk: !!document.querySelector("#a2-dusk.a2-still"), skal: !!document.querySelector("#a2-skal.a2-still"),
        rip: !!document.querySelector(".a2-ripple.a2-still"), bobAnim: getComputedStyle(document.getElementById("af-hol-e")).animationName }));
      ok("reduced motion: no running animation at all (pulse, bob, dusk, Skåltimmen, ripple)", a.run === 0, a);
      ok("reduced motion: still forms instead (static ring, glow, dusk, ripple mark); no foam", st.ring && st.dusk && st.skal && st.rip && foam === false && st.bobAnim === "none", { st, foam });
      await page.screenshot({ path: OUT + "ui-testshots/alive2-reduced-390.png" });
      ok("reduced: no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    /* ---------- 3. store build: no drink effects ---------- */
    {
      const { ctx, page, errs } = await open(b, D13, { store: true });
      await skalOn(page); await friendPoll(page, 2); await wait(page, 300);
      const c = await centre(page);
      const st = await page.evaluate((c) => { window.PN_ALIVE2.myFoam = true; return { s: ALIVE2._state(), foam: ALIVE2.foam(c[0], c[1]), rip: ALIVE2.ripple(c[0], c[1]),
        ring: !!document.getElementById("a2-holring"), skal: !!document.getElementById("a2-skal"), ripples: document.querySelectorAll(".a2-ripple,.a2-foam").length,
        dusk: !!document.getElementById("a2-dusk"), bob: !!document.querySelector("#af-hol-e[data-a2bob]") }; }, c);
      const f = st.s.flags;
      ok("store: the drink flags are OFF (friendRipple, holPulse, skalGlow, myFoam), the others ON", st.s.store && !f.friendRipple && !f.holPulse && !f.skalGlow && f.holBob && f.weekendDusk, st.s);
      ok("store: no ÖL! pulse, no Skåltimmen glow, no ripple, no foam (even when a page sets a flag true)", !st.ring && !st.skal && st.ripples === 0 && !st.foam && !st.rip, st);
      ok("store: the non-drink effects stay (badge bob, weekend dusk)", st.dusk && st.bob, st);
      ok("store: no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    /* ---------- 4. Sat noon + a Tuesday evening: no holiday, no dusk ---------- */
    for (const [nm, d] of [["Sat 14 Nov 12:00", D14], ["Tue 17 Nov 20:00", TUE]]) {
      const { ctx, page, errs } = await open(b, d);
      const st = await page.evaluate(() => ({ ring: !!document.getElementById("a2-holring"), dusk: !!document.getElementById("a2-dusk"), bob: !!document.querySelector("[data-a2bob]"), hol: document.body.classList.contains("af-hol") }));
      ok(nm + ": no holiday pulse / bob (no holiday), no weekend dusk", !st.ring && !st.dusk && !st.bob && !st.hol, st);
      ok(nm + ": no page errors", errs.length === 0, errs);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL crash", e.message); }
  await b.close();
  console.log(`\nalive2: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
