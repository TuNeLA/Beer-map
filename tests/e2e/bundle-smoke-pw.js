// left T-25: smoke test of the BUNDLED site (scripts/bundle.mjs output, the GitHub Pages "bundled" build) against the plain docs/.
// usage: node bundle-smoke-pw.js <bundled port> <plain port>     (scripts/bundle-check.sh builds + serves both and runs this)
//        BUNDLE_PATH=test/ node bundle-smoke-pw.js …               (a site in a sub-folder, e.g. the beta /test/ build)
// Mocked Supabase (ds-helpers). Checks: few requests; same window modules as the plain site after start and after the lazy
// files; same computed styles on the main screen; no page errors / bundle part errors; a part error still reaches window
// "error"; the service worker precaches the bundle and the app starts offline from it; a bundle that fails to load →
// unbundle.js loads the single files and the app still works.
const { chromium } = require("playwright");
const { ctxFor, mock, wait } = require("./ds-helpers.js");
const CHROME = require("./env.js").CHROME;
const BP = process.argv[2], PP = process.argv[3];
if (!BP || !PP) { console.log("FAIL usage: node bundle-smoke-pw.js <bundled port> <plain port>"); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 700))); c ? pass++ : fail++; };
const URL_ = (p) => "http://127.0.0.1:" + p + "/" + (process.env.BUNDLE_PATH || "");   // BUNDLE_PATH=test/ : the beta staging build

// window globals the app's modules publish (UPPER_CASE names), after start and after the lazy files (OLNU_LAZY)
const MODS = () => Object.keys(window).filter((k) => /^[A-Z][A-Z0-9_]{1,}$/.test(k) && window[k] != null).sort();
// computed styles of the main screen (no map, ticker text, toasts: those move or change by time)
const STYLES = () => {
  const P = ["color", "background-color", "font-family", "font-size", "font-weight", "line-height", "border-top-left-radius", "padding-top", "padding-left",
    "margin-top", "display", "position", "z-index", "opacity", "box-shadow", "border-top-width", "text-transform", "letter-spacing", "gap", "backdrop-filter"];
  const skip = (e) => e.closest("#map, .ticker, #toasts, .leaflet-pane, .mapboxgl-map, #pn-splash, #olnu-beta");
  const out = {};
  document.querySelectorAll("body *").forEach((e) => {
    if (skip(e) || (e.getAnimations && e.getAnimations().length)) return;   // a running animation changes opacity / transform by time
    const k = e.tagName + "#" + (e.id || "") + "." + [...e.classList].sort().join(".");
    if (out[k]) return;
    const cs = getComputedStyle(e);
    out[k] = P.map((p) => cs.getPropertyValue(p)).join("|");
  });
  return out;
};

async function boot(browser, port, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
  const reqs = [];
  page.on("request", (q) => { if (q.url().startsWith(URL_(port))) reqs.push(q.url()); });
  if (o.before) await o.before(ctx, page);
  await page.goto(URL_(port));
  await page.waitForFunction(() => document.querySelectorAll(".pill").length > 0, null, { timeout: 45000 }).catch(() => {});
  await wait(page, 1500);
  return { ctx, page, errs, reqs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  // ---------- B1: the bundled index.html ----------
  const html = await (await fetch(URL_(BP) + "index.html")).text();
  const localJs = [...html.matchAll(/<script defer src="\.\/([^"?]+)(\?v=[0-9a-f]{10})?"/g)];
  const localCss = [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"?]+)(\?v=[0-9a-f]{10})?"/g)];
  ok("B1 bundled index: ≤ 6 local start scripts (config.js, unbundle.js, the bundles)", localJs.length > 0 && localJs.length <= 6, localJs.map((m) => m[1]));
  ok("B1 bundled index: 1 local stylesheet", localCss.length === 1, localCss.map((m) => m[1]));
  ok("B1 config.js stays its own file (server address: test server + beta staging build rewrite it)", localJs.some((m) => m[1] === "config.js"));
  const unstamped = [...html.matchAll(/(?:src|href)="\.\/([^"?]+\.(?:js|css))(\?v=[0-9a-f]{10})?"/g)].filter((m) => !m[2]).map((m) => m[1]);
  ok("B1 every local js / css in index.html has ?v=<hash>", unstamped.length === 0, unstamped);

  // ---------- B2 / B3: same modules, same styles, no errors ----------
  const P = await boot(browser, PP), B = await boot(browser, BP);
  const pm = await P.page.evaluate(MODS), bm = await B.page.evaluate(MODS);
  const miss = pm.filter((k) => !bm.includes(k)), extra = bm.filter((k) => !pm.includes(k) && !/^(OLNU_BUNDLE_ERR|OLNU_UNBUNDLED)$/.test(k));
  ok("B2 the bundled app has every module of the plain app after start (" + pm.length + ")", miss.length === 0, { miss, extra });
  ok("B2 bundled start: no page errors, no part errors", B.errs.length === 0 && (await B.page.evaluate(() => (window.OLNU_BUNDLE_ERR || []).length)) === 0, { errs: B.errs, parts: await B.page.evaluate(() => window.OLNU_BUNDLE_ERR) });
  ok("B2 plain start: no page errors (reference)", P.errs.length === 0, P.errs);
  ok("B2 requests to the site at start: bundled < ¼ of plain", B.reqs.length * 4 < P.reqs.length, { plain: P.reqs.length, bundled: B.reqs.length });
  const ps = await P.page.evaluate(STYLES), bs = await B.page.evaluate(STYLES);
  const diff = Object.keys(ps).filter((k) => k in bs && ps[k] !== bs[k]).map((k) => ({ k, plain: ps[k], bundled: bs[k] }));
  ok("B2 same computed styles on the main screen (" + Object.keys(ps).length + " element kinds)", diff.length === 0, diff.slice(0, 5));
  const lazyOk = (page) => page.evaluate(() => Promise.race([window.OLNU_LAZY_NOW ? window.OLNU_LAZY_NOW() : window.OLNU_LAZY, new Promise((r) => setTimeout(r, 25000))]));
  await Promise.all([lazyOk(P.page), lazyOk(B.page)]); await wait(B.page, 1000);
  const LZ = () => ({ mods: Object.keys(window).filter((k) => /^[A-Z][A-Z0-9_]{1,}$/.test(k) && window[k] != null).sort(),
    lazy: [...document.querySelectorAll('script[type="text/x-lazy"]:not([data-demand])')].map((n) => n.getAttribute("src"))
      .filter((u) => !document.querySelector('script[src="' + u + '"]:not([type="text/x-lazy"])')),
    known: ["PARTY_CONTENT", "PARTY_UI", "SPEL_CARDS", "SPEL_UI"].filter((k) => !window[k]) });
  const pl = await P.page.evaluate(LZ), bl = await B.page.evaluate(LZ);
  const miss2 = pl.mods.filter((k) => !bl.mods.includes(k));
  ok("B3 after the lazy files: every x-lazy file ran, the same modules as plain (" + pl.mods.length + "; party, spel, gang content …)",
    miss2.length === 0 && !bl.lazy.length && !bl.known.length && !pl.known.length, { miss2, notLoaded: bl.lazy, missingKnown: bl.known, plainMissing: pl.known });
  // an error inside one part: the rest runs, window "error" still sees it (pnlog crash log)
  const be = await B.page.evaluate(() => new Promise((res) => {
    let seen = null; window.addEventListener("error", (e) => { if (/bundle-smoke/.test(String(e.message || ""))) seen = e.message; });
    if (typeof window.__olnuBE !== "function") return res({ helper: false });
    window.__olnuBE("js/x-test.js", new Error("bundle-smoke boom"));
    setTimeout(() => res({ helper: true, seen, list: window.OLNU_BUNDLE_ERR }), 300);
  }));
  ok("B2 a part that throws: logged in OLNU_BUNDLE_ERR and re-thrown to window \"error\"", be.helper && !!be.seen && (be.list || []).includes("js/x-test.js"), be);
  await P.ctx.close(); await B.ctx.close();

  // ---------- B4: a bundle that does not load → unbundle.js loads the single files ----------
  {
    const U = await boot(browser, BP, { before: async (ctx, page) => { await page.route(/\/js\/app\.bundle-?\d*\.js/, (r) => /bundle(-3)?\.js/.test(r.request().url()) ? r.abort() : r.fallback()); } });
    await wait(U.page, 3000);
    const s = await U.page.evaluate(() => ({ unb: window.OLNU_UNBUNDLED || 0, mods: ["SAFETY", "SOCIAL", "ZONES", "PNDS", "X8", "GPAGE"].filter((k) => !window[k]), pills: document.querySelectorAll(".pill").length }));
    ok("B4 the main bundle fails to load: reload once, then the single files (data-parts) → the app works", s.unb >= 1 && s.mods.length === 0 && s.pills > 0, s);
    await U.ctx.close();
  }

  // ---------- B5: service worker: precache from the bundled index, start offline ----------
  {
    const ctx = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 390, height: 844 }, locale: "sv-SE" });
    const page = await ctx.newPage();
    await mock(page);
    const errs = []; page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
    await page.goto(URL_(BP));
    const sw = await page.evaluate(() => new Promise((res) => {
      const t0 = Date.now();
      (function chk() {
        caches.keys().then((ks) => {
          const v = ks.find((k) => /^olnu-[0-9a-z-]+$/.test(k) && !/^olnu-(cdn|data|tiles|pending|beta)$/.test(k));
          if (!v) { if (Date.now() - t0 > 40000) return res({ keys: ks }); return setTimeout(chk, 500); }
          return caches.open(v).then((c) => c.keys()).then((rs) => {
            const u = rs.map((r) => r.url.replace(location.origin, ""));
            if (!u.some((x) => /app\.bundle-?\d*\.js/.test(x)) && Date.now() - t0 < 40000) return setTimeout(chk, 500);
            Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 15000))]).then((reg) => res({ v, n: u.length, bundle: u.filter((x) => /bundle/.test(x)), active: !!(reg && reg.active) }));
          });
        });
      })();
    }));
    ok("B5 the service worker installs and precaches the bundles (one cache, ~20 files)", sw.active && sw.bundle && sw.bundle.length >= 2 && sw.n < 80, sw);
    await wait(page, 1500);
    await ctx.setOffline(true);
    await page.reload().catch(() => {});
    await wait(page, 6000);
    const off = await page.evaluate(() => ({ mods: ["SAFETY", "SOCIAL", "ZONES", "PNDS", "X8"].filter((k) => !window[k]), bundled: !!document.querySelector('script[src*="app.bundle"]') }));
    ok("B5 offline restart from the service worker cache: the bundled app runs", off.mods.length === 0 && off.bundled, off);
    await ctx.close();
  }
  await browser.close();
  console.log("bundle-smoke:", pass, "PASS", fail, "FAIL");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", String(e && e.stack || e).slice(0, 500)); process.exit(1); });
