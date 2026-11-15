// dbeer-shots.js — lane d-beer (I-114, proposals 02 + 04): before / after pictures at 390x844 @2x (+ the where-sheet at 360x640).
// Same mocked state for both runs. Usage: node dbeer-shots.js <port> <out dir> <before|after>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const OUT = (process.argv[3] || "./out").replace(/\/?$/, "/"), TAG = process.argv[4] || "after";
require("fs").mkdirSync(OUT, { recursive: true });
const J = (r, body) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function open(browser, o = {}, vp = { width: 390, height: 844 }) {
  const { ctx, page } = await ctxFor(browser, vp, o);
  // a picture of one exact moment: __freezeAt(ms) stops the page's timers and animations at that time (the shot takes ~0.5 s)
  await ctx.addInitScript(() => {
    const st = window.setTimeout, si = window.setInterval; let q = [];
    window.setTimeout = (fn, ms, ...a) => st(function run() { if (window.__frozen) { q.push(run); return; } if (typeof fn === "function") fn(...a); }, ms);
    window.setInterval = (fn, ms, ...a) => si(() => { if (!window.__frozen) fn(...a); }, ms);
    window.__freezeAt = (ms) => st(() => { window.__frozen = true; document.getAnimations().forEach((x) => { try { x.pause(); } catch (e) {} }); }, ms);
    // ms after the first node that matches sel is in the page (the count burst starts when the position is known, not at the click)
    window.__freezeAfter = (sel, ms) => { const mo = new MutationObserver(() => { if (document.querySelector(sel)) { mo.disconnect(); window.__freezeAt(ms); } }); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] }); };
  });
  await ctx.setGeolocation(o.geo || { latitude: 60.15124, longitude: 15.18797 });   // at La Parma
  const n = o.n || 7;
  await page.route(/rest\/v1\/rpc\/post_beer_v2/, (r) => J(r, { accepted: true, beer_count: n, drinks: n, lat: 60.15124, lng: 15.18797, precise: true,
    expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() }));
  await boot(page);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await wait(page, 600);
  return { ctx, page };
}
const shot = async (page, name) => { await page.screenshot({ path: OUT + name + "-" + TAG + ".png" }); console.log("shot", name + "-" + TAG); };
// the cooldown as it looks with `left` ms to go (the app's own tick paints it)
const cooldownAt = (page, leftMs) => page.evaluate((leftMs) => {
  const m = JSON.parse(localStorage.getItem("olnu.night") || "{}"); m.lastTap = Date.now() - (window.U.COOLDOWN_MS - leftMs) + 400;
  localStorage.setItem("olnu.night", JSON.stringify(m)); window.PN.tickCooldown();
}, leftMs);

(async () => {
  const browser = await chromium.launch();
  try {
    // ÖL! at rest, the wait at 9:59 and at 0:30
    let { ctx, page } = await open(browser);
    await shot(page, "1-ol-rest");
    await cooldownAt(page, 599000); await wait(page, 300); await shot(page, "2-wait-959");
    await cooldownAt(page, 30000); await wait(page, 300); await shot(page, "3-wait-030");
    await ctx.close();
    // after a tap (checked in at Pitchers: no where-sheet), 6 → 7: the number at 0.6 s, the button as "Ångra" at 1 s, 5 s, 9.5 s,
    // then the timer. One page per picture (the page is frozen at that moment).
    // The burst picture: 0.5 s after the number came. The "Ångra" pictures: 1 s, 5 s and 9.5 s after the tap (after: the state came
    // 0.6 s after the tap, so 0.4 s, 4.4 s and 8.9 s into its 10 s).
    for (const [ms, name, sel] of [[500, "4-after-tap-burst", ".pm-burst"], [400, "5-undo-1s", "#btn-beer.undo"], [2500, "5-after-tap-2s5"], [4400, "5-undo-5s", "#btn-beer.undo"], [8900, "5-undo-9s5", "#btn-beer.undo"], [11500, "5-undo-then-timer"]]) {
      if (TAG === "before" && sel === "#btn-beer.undo") continue;   // the old code has no such state
      ({ ctx, page } = await open(browser, { geo: { latitude: 60.14997, longitude: 15.18679 } }));
      await page.evaluate(([ms, sel]) => { if (sel) window.__freezeAfter(sel, ms); else window.__freezeAt(ms); document.getElementById("btn-beer").click(); }, [ms, sel || ""]);
      await page.waitForFunction(() => window.__frozen, null, { timeout: 20000 });
      await shot(page, name);
      await ctx.close();
    }
    // "Var dricker du?" at two sizes (no check-in)
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      ({ ctx, page } = await open(browser, { checkin: false }, vp));
      await page.evaluate(() => document.getElementById("btn-beer").click());
      await page.waitForFunction(() => { const s = document.getElementById("sheet"); return s && !s.hidden && document.querySelector("#sheet-body .btn"); }, null, { timeout: 8000 }).catch(() => console.log("no where sheet"));
      await wait(page, 900); await shot(page, "6-where-" + vp.width + "x" + vp.height);
      await ctx.close();
    }
  } catch (e) { console.log("ERR", e.message); }
  await browser.close();
})();
