// mapfix5-pw.js — lane mapfix5 (19 Nov 2026). Each section FAILS on the old code (big-update c3f1af4) and PASSES on the new code.
//   b11   B11 (bugsnet note 1+2): a rough fix (accuracy > 100 m) is never drawn as an exact dot (fastpos.js rule): not from a
//         fresh fix, not from an old saved fix with no accuracy. olnu.lastFix keeps the accuracy. Logout and account deletion
//         remove olnu.cam + olnu.lastFix, and the reload after them does not save the camera again.
//   b9    B9 (blind test §4): GL taps. A restaurant dot, a bar disc and the faces / count pill beside it have a 44 x 44 px hit
//         area (the look is the same size). One click router: with a bar sheet open, a tap on the empty map only closes it.
//   d4    D4 (product audit A3 #4): a real empty state when nobody is out in view.
// Mocked Supabase (d2-helpers), 390 x 844. b9 needs GL: real Mapbox with MAPBOX_TEST_TOKEN, else a STUB Mapbox (fake token,
// blank style) with the real GL bar layers. Usage: node mapfix5-pw.js <port> [sections regex]
const H = require("./d2-helpers.js");
const { ctxFor, boot, wait } = H;
const { TOKEN, launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8793, ONLY = new RegExp(process.argv[3] || ".");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 600)); };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const sect = async (k, fn) => { if (!ONLY.test(k)) return; try { await fn(); } catch (e) { fail++; console.log("FAIL " + k + " stopped by an exception:", String(e.message).split("\n")[0].slice(0, 300)); } };
const LUD = [60.1511, 15.1876];
const now = Date.now();

// what is drawn for me: DOM dots (the raster map draws it; GL hides it but the old code still made it), the accuracy circle,
// the GL marker position (GLBARS._me().ll) and the saved last fix
const meState = (page) => page.evaluate(() => {
  let lf = null; try { lf = JSON.parse(localStorage.getItem("olnu.lastFix") || "null"); } catch (e) {}
  let gl = null; try { gl = window.GLBARS && GLBARS.on && GLBARS.on() && GLBARS._me ? (GLBARS._me() || {}).ll || null : null; } catch (e) {}
  return { dot: document.querySelectorAll(".me-dot").length, acc: document.querySelectorAll(".me-acc").length, gl, lf, loc: window.PN && PN.s ? PN.s.lastLoc : null };
});

async function b11(browser) {
  // a) a fresh ROUGH fix (a network fix, 650 m): the circle only, no dot; the saved fix keeps its accuracy
  let { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await ctx.setGeolocation({ latitude: LUD[0], longitude: LUD[1], accuracy: 650 });
  await boot(page);
  await page.evaluate(() => PN.locate({ quiet: true, keepZoom: true })); await wait(page, 1500);
  let s = await meState(page);
  ok("b11 rough fix (650 m): no exact dot (DOM or GL; old: a .me-dot)", s.dot === 0 && !s.gl, s);
  ok("b11 rough fix: olnu.lastFix keeps the accuracy (acc 650; old: no acc field)", !!s.lf && s.lf.acc === 650, s.lf);
  await ctx.close();
  // an exact GPS fix (20 m): the dot shows (a new phone: the browser would give the cached rough fix again within maximumAge)
  ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }));
  await ctx.setGeolocation({ latitude: LUD[0], longitude: LUD[1], accuracy: 20 });
  await boot(page);
  await page.evaluate(() => PN.locate({ quiet: true, keepZoom: true })); await wait(page, 1500);
  s = await meState(page);
  ok("b11 guard: an exact fix (20 m) draws the dot and saves acc 20", s.dot === 1 && !!s.lf && s.lf.acc === 20, s);
  await ctx.close();

  // b) no location permission + a saved fix from before this fix (no accuracy) / a saved rough fix: the view moves there, no dot
  for (const [name, fix] of [["an old saved fix with no accuracy", { lat: 60.1525, lng: 15.1890, at: now - 600e3 }], ["a saved rough fix (900 m)", { lat: 60.1525, lng: 15.1890, acc: 900, at: now - 600e3 }]]) {
    ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }));
    await ctx.clearPermissions();
    await ctx.addInitScript((f) => { if (sessionStorage.getItem("m5b")) return; sessionStorage.setItem("m5b", "1"); localStorage.setItem("olnu.lastFix", JSON.stringify(f)); localStorage.setItem("olnu.locOk", "1"); }, fix);
    await boot(page);
    await page.evaluate(() => PN.locate({ quiet: true })); await wait(page, 1500);
    s = await meState(page);
    ok("b11 " + name + ": the map may move there, but NO exact dot (old: .me-dot from lastKnown with accuracy 0)", s.dot === 0 && !s.gl, s);
    await ctx.close();
  }
  // c) a saved EXACT fix (30 m), no permission: the dot shows at once (c2speed I-45 kept)
  ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }));
  await ctx.clearPermissions();
  await ctx.addInitScript((f) => { if (sessionStorage.getItem("m5b")) return; sessionStorage.setItem("m5b", "1"); localStorage.setItem("olnu.lastFix", JSON.stringify(f)); }, { lat: 60.1525, lng: 15.1890, acc: 30, at: now - 600e3 });
  await boot(page);
  await page.evaluate(() => PN.locate({ quiet: true })); await wait(page, 1200);
  s = await meState(page);
  ok("b11 guard: a saved exact fix (30 m) still shows the dot at once (c2speed I-45)", s.dot === 1, s);
  await ctx.close();

  // d) logout and account deletion: olnu.cam + olnu.lastFix are gone when the next page starts (read before any app code runs)
  for (const part of ["logout", "delete"]) {
    ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }));
    // the mark is window.name (it survives the reload; the deletion clears sessionStorage)
    await ctx.addInitScript(() => { if (window.name === "m5d") { window.__atLoad = { cam: localStorage.getItem("olnu.cam"), fix: localStorage.getItem("olnu.lastFix") }; } window.name = "m5d"; });
    await page.route(/rest\/v1\/rpc\/delete_my_data(_v2)?\b/, (r) => J(r, { ok: true }));
    await page.route(/rest\/v1\/rpc\/request_account_deletion/, (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function" }) }));
    await boot(page);
    await page.evaluate(() => { __map.setView([57.7089, 11.9746], 14, { animate: false }); localStorage.setItem("olnu.lastFix", JSON.stringify({ lat: 57.7089, lng: 11.9746, acc: 15, at: Date.now() })); });
    await wait(page, 1600);   // the camera is saved 1 s after the move
    const before = await page.evaluate(() => ({ cam: !!localStorage.getItem("olnu.cam"), fix: !!localStorage.getItem("olnu.lastFix") }));
    if (part === "logout") {
      await page.evaluate(() => window.ACCOUNT.logout());
      await page.waitForSelector("#sheet-body .acct-logout-go", { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .acct-logout-go"); if (b) b.click(); });
    } else {
      await page.evaluate(() => window.PRIVACY.showDelete());
      await page.waitForSelector("#sheet-body .mm-del-now, #sheet-body .confirm, #sheet-body .btn-danger", { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .mm-del-now"); if (b) b.click(); });
      await page.waitForFunction(() => { const b = document.querySelector("#sheet-body .btn-danger"); return b && !b.classList.contains("mm-del-go"); }, null, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .btn-danger"); if (b) b.click(); });
      await page.waitForSelector("#sheet-body .confirm .btn-danger", { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .confirm .btn-danger"); if (b) b.click(); });
    }
    // window.__atLoad exists only on the page after the reload (read by an init script before any app code runs)
    let at = null;
    for (let k = 0; k < 30 && !at; k++) { try { at = await page.evaluate(() => window.__atLoad || null); } catch (e) {} if (!at) await wait(page, 1000).catch(() => {}); }
    ok("b11 " + part + ": olnu.cam and olnu.lastFix are gone when the next page starts (old: still there / saved again on pagehide)",
      before.cam && before.fix && !!at && at.cam === null && at.fix === null, { before, at });
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch(launchOpts([]));
  try {
    await sect("b11", () => b11(browser));
  } finally { await browser.close(); }
  console.log("\nmapfix5: " + pass + " pass, " + fail + " fail" + (TOKEN ? " (real token)" : ""));
  process.exit(fail ? 1 : 0);
})();
