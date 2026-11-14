// mycount-pw.js — I-102 (owner 14 Nov 2026: "hard to see how many beers you've drunk", picked B + D): docs/js/mycount.js +
// docs/mycount.css. B = #pn-mine rail button under ⋯ (count > 0 only, tap = Min kväll). D = the count burst on my accepted ÖL!
// (not for outbox beers, not when 5/10/15 takeovers play, calm at 8+, no particles under reduced motion, OFF in store builds).
// 390 px, mocked Supabase (port B). Usage: node mycount-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 400)); };

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { reduced: !!o.reduced });
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => window.MYCOUNT && document.getElementById("btn-more"), null, { timeout: 15000 }).catch(() => console.log("no MYCOUNT"));
  await wait(page, 400);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch();
  try {
    // B: the rail button
    let { ctx, page, errs } = await open(browser);
    const b = await page.evaluate(() => {
      const r = (e) => { const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height }; };
      MYCOUNT.set(0); const m = document.getElementById("pn-mine"); const hid0 = !m || m.hidden;
      MYCOUNT.set(3); const x = document.getElementById("pn-mine"), more = document.getElementById("btn-more");
      const out = { hid0, vis: !x.hidden && getComputedStyle(x).display !== "none", n: x.querySelector(".pm-n").textContent, aria: x.getAttribute("aria-label"), me: r(x), more: r(more) };
      MYCOUNT.set(12); out.w12 = r(x); out.n12 = x.querySelector(".pm-n").textContent;
      MYCOUNT.set(150); out.n150 = x.querySelector(".pm-n").textContent;
      let opened = 0; const keep = window.NIGHTLOG; window.NIGHTLOG = { open: function () { opened++; } };
      x.click(); out.opened = opened; window.NIGHTLOG = keep;
      return out;
    });
    ok("B hidden at 0", b.hid0, b);
    ok("B shows 3", b.vis && b.n === "3" && /3/.test(b.aria), b);
    ok("B sits under ⋯ Mer, right aligned, no overlap", b.me.t >= b.more.b && Math.abs(b.me.r - b.more.r) < 2, b);
    ok("B is a 44 px target", b.me.h >= 44 && b.me.w >= 44, b);
    ok("B grows left for 12, stays on screen", b.n12 === "12" && b.w12.l > 0 && b.w12.r <= 390, b);
    ok("B caps at 99+", b.n150 === "99+", b);
    ok("B tap opens Min kväll", b.opened === 1, b);

    // D: the burst
    const d = await page.evaluate(() => {
      MYCOUNT.set(3); MYCOUNT.onBeerAccepted({}, { total: 4 });
      const h = document.querySelector(".pm-burst");
      return { host: !!h, aria: h && h.getAttribute("aria-hidden"), parts: document.querySelectorAll(".pm-burst .pm-p").length, edge: !!document.querySelector(".pm-burst .pm-edge"),
        num: h && h.querySelector(".pm-new").textContent, old: h && h.querySelector(".pm-old") && h.querySelector(".pm-old").textContent,
        pe: h && getComputedStyle(h).pointerEvents, hold: MYCOUNT._state().hold };
    });
    ok("D burst shows the new number, old rolls away", d.host && d.num === "4" && d.old === "3", d);
    ok("D burst has the edge flash + 22 bits, aria-hidden, no taps", d.edge && d.parts === 22 && d.aria === "true" && d.pe === "none", d);
    ok("D holds the button until the number lands", d.hold === true, d);
    await page.evaluate(() => MYCOUNT.set(4));
    await wait(page, 2000);
    const d2 = await page.evaluate(() => ({ left: document.querySelectorAll(".pm-burst").length, st: MYCOUNT._state() }));
    ok("D cleans up and lands on the button", d2.left === 0 && d2.st.hold === false && d2.st.shown === d2.st.want, d2);
    const d3 = await page.evaluate(() => {
      const c = () => document.querySelectorAll(".pm-burst").length;
      MYCOUNT.set(4); MYCOUNT.onBeerAccepted({}, { total: 5 }); const t5 = c();
      MYCOUNT.onBeerAccepted({}, { total: 5, queued: true }); const q = c();
      MYCOUNT.set(8); MYCOUNT.onBeerAccepted({}, { total: 9 }); const calm = document.querySelector(".pm-burst.pm-calm"); const cp = document.querySelectorAll(".pm-burst .pm-p").length;
      return { t5, q, calm: !!calm, cp };
    });
    ok("D skips the 5 takeover and outbox beers", d3.t5 === 0 && d3.q === 0, d3);
    ok("D is calm at 8+ (no bits)", d3.calm && d3.cp === 0, d3);
    await wait(page, 2000);
    // I-104: the count + burst at the TAP; the server answer only confirms (no 2nd burst); no answer → back quietly
    const e1 = await page.evaluate(() => {
      document.querySelectorAll(".pm-burst").forEach((x) => x.remove());
      MYCOUNT.set(2); MYCOUNT.early(3);
      const at = document.querySelectorAll(".pm-burst").length;
      MYCOUNT.onBeerAccepted({}, { total: 3 }); const after = document.querySelectorAll(".pm-burst").length;
      MYCOUNT.settle(); return { at, after, st: MYCOUNT._state() };
    });
    ok("I-104 early burst at the tap, the answer adds no 2nd burst", e1.at === 1 && e1.after === 1 && e1.st.want === 3, e1);
    await wait(page, 2000);
    const e2 = await page.evaluate(() => {
      MYCOUNT.set(3); MYCOUNT.early(4); const b = document.querySelectorAll(".pm-burst").length;
      MYCOUNT.settle();   // refused / outbox / error
      const m = document.getElementById("pn-mine");
      return { b, left: document.querySelectorAll(".pm-burst").length, n: m.querySelector(".pm-n").textContent, st: MYCOUNT._state() };
    });
    ok("I-104 no answer → burst gone, count back", e2.b === 1 && e2.left === 0 && e2.n === "3" && e2.st.hold === false, e2);
    ok("I-104 FASTPOS loaded", await page.evaluate(() => !!(window.FASTPOS && FASTPOS.forTap)));
    await wait(page, 3200);
    ok("no page errors", errs.length === 0, errs);
    await ctx.close();

    // reduced motion: no bits, no fly
    ({ ctx, page, errs } = await open(browser, { reduced: true }));
    const r = await page.evaluate(() => { MYCOUNT.set(1); MYCOUNT.onBeerAccepted({}, { total: 2 }); return { host: !!document.querySelector(".pm-burst.pm-rm"), parts: document.querySelectorAll(".pm-p").length }; });
    ok("reduced motion: fade only, no bits", r.host && r.parts === 0, r);
    await ctx.close();

    // store build: B stays, D is off
    ({ ctx, page, errs } = await open(browser, { store: true }));
    const s = await page.evaluate(() => { MYCOUNT.set(2); const v = !document.getElementById("pn-mine").hidden; MYCOUNT.onBeerAccepted({}, { total: 3 }); return { v, store: !!window.OLNU_STORE, burst: document.querySelectorAll(".pm-burst").length }; });
    ok("store: count button yes, burst no", s.store && s.v && s.burst === 0, s);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL crash", e.message); }
  await browser.close();
  console.log("mycount: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
