// swfix-pw.js — lane swfix (24 Nov 2026).
//   sw  (A4b part 2): "Chromium takes the new service-worker version late". Real service workers, two stamped builds (A, B)
//       of docs/ on a GitHub-Pages-like server (start1-pw.js does the same). Measures the time from "the app is opened
//       again" to "build B runs under worker B".
//   fx  (B9 + scan): the canvas tap effects never draw with a negative or NaN radius, also when the tap handler was slow
//       (the first animation frame then has a time stamp from BEFORE the effect started), on small and 0-size screens.
// usage: node swfix-pw.js <port> [sw,fx]   (or w1 / w2 / w3: one sw check)   <port> = tests/e2e/serve.py <port> docs (staging config, mocked Supabase).
//   SWFIX_DOCS=<dir> tests another docs/ folder (the old code: W2, W3 and the fx checks must FAIL there).
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { execFileSync, spawn } = require("child_process");
const PORT = process.argv[2] || 8824;
const PARTS = (process.argv[3] || "sw,fx").split(",");
const REPO = path.join(__dirname, "..", ".."), DOCS = path.resolve(process.env.SWFIX_DOCS || path.join(REPO, "docs"));
const wait = (p, ms) => p.waitForTimeout(ms);
let pass = 0, fail = 0;
const ok = (m, c, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 600))); c ? pass++ : fail++; };

/* ---------- sw: two stamped builds + a static server like GitHub Pages ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pn-swfix-"));
// slow: the old worker needs `slow` ms to start (a phone: a cold worker start is 100-1000 ms). Makes the race of W2 the same
// on every run: the page's first requests wake the old worker, the new one asks to take over while the old one still starts.
function build(tag, cfg, slow) {
  const dir = path.join(TMP, tag);
  fs.cpSync(DOCS, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.js"), cfg);
  const ix = path.join(dir, "index.html");
  fs.writeFileSync(ix, fs.readFileSync(ix, "utf8").replace("<head>", '<head>\n<meta name="pn-build" content="' + tag + '">'));
  if (tag !== "A") fs.appendFileSync(path.join(dir, "js", "pn.js"), "\n// build " + tag + "\n");
  if (slow) { const f = path.join(dir, "sw.js"); fs.writeFileSync(f, fs.readFileSync(f, "utf8") + "\n;(function () { var t = Date.now(); while (Date.now() - t < " + slow + ") {} })();\n"); }
  execFileSync("node", [path.join(REPO, "scripts", "stamp.mjs"), dir], { stdio: "pipe" });
  const ver = (fs.readFileSync(path.join(dir, "sw.js"), "utf8").match(/^var VERSION = "([^"]*)";/m) || [])[1];
  return { dir, ver, tag };
}
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", png: "image/png",
  ico: "image/x-icon", svg: "image/svg+xml", woff2: "font/woff2", webmanifest: "application/manifest+json", jpg: "image/jpeg", webp: "image/webp", txt: "text/plain" };
const srv = { root: "", port: 0 };
function startServer() {
  return new Promise((res) => {
    const s = http.createServer((req, rs) => {
      let p; try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { rs.writeHead(400); rs.end(); return; }
      if (p.endsWith("/")) p += "index.html";
      const root = srv.root, f = path.join(root, p);
      if (f.indexOf(root) !== 0) { rs.writeHead(403); rs.end(); return; }
      fs.readFile(f, (err, buf) => {
        if (err) { rs.writeHead(404, { "Content-Type": "text/plain" }); rs.end("404"); return; }
        rs.writeHead(200, { "Content-Type": TYPES[path.extname(f).slice(1)] || "application/octet-stream", "Content-Length": buf.length, "Cache-Control": "max-age=600" });
        rs.end(buf);
      });
    });
    s.listen(0, "127.0.0.1", () => { srv.port = s.address().port; srv.http = s; res(); });
  });
}
const BASE = () => `http://127.0.0.1:${srv.port}/`;
const NOW = Date.now(), iso = (m) => new Date(NOW - m * 60e3).toISOString();
const fakeJwt = () => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return b({ alg: "HS256", typ: "JWT" }) + "." + b({ sub: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", role: "authenticated", exp: Math.floor(NOW / 1000) + 86400, is_anonymous: true }) + ".sig"; };
const SESSION = { access_token: fakeJwt(), token_type: "bearer", expires_in: 86400, expires_at: Math.floor(NOW / 1000) + 86400, refresh_token: "rt-fake",
  user: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: iso(9999) } };
async function swCtx(browser) {
  const ctx = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "sv-SE", isMobile: true, hasTouch: true,
    geolocation: { latitude: 60.1511, longitude: 15.1876 }, permissions: ["geolocation"],
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36" });
  await ctx.addInitScript(({ SESSION }) => {
    try { const o = JSON.parse(sessionStorage.getItem("t.or") || "[]"); o.push(performance.timeOrigin); sessionStorage.setItem("t.or", JSON.stringify(o)); } catch (e) {}
    try { navigator.serviceWorker.addEventListener("controllerchange", () => { window.__cc = (window.__cc || 0) + 1; }); } catch (e) {}
    if (localStorage.getItem("t.seeded")) return;
    localStorage.setItem("t.seeded", "1");
    const S = (k, v) => localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    S("olnu.name", "Anton"); S("olnu.age18", "1"); S("olnu.intro", "1"); S("olnu.newsPn", "1"); S("olnu.notifAsked", "1"); S("olnu.notifAskAt", String(Date.now()));
    S("olnu.guideSeen", String(Date.now())); S("olnu.installSeen", "1"); S("olnu.lang", "sv"); S("olnu.inst1", { n: 2, how: "test" }); S("olnu.flyttAsked", "1");
    S("olnu.pnAha", "1"); S("olnu.pnOb", "1"); S("olnu.terms", "1"); S("olnu.auth", SESSION); S("olnu.uid", SESSION.user.id);
  }, { SESSION });
  const page = await ctx.newPage();
  page.errs = [];
  page.on("pageerror", (e) => page.errs.push(String(e.message).slice(0, 140)));
  await H.mock(page);
  // the worker states, from the browser (stopped / starting / running; installed / activated / redundant)
  const cdp = await ctx.newCDPSession(page); await cdp.send("ServiceWorker.enable");
  page.sw = {};
  cdp.on("ServiceWorker.workerVersionUpdated", (ev) => ev.versions.forEach((v) => { const st = v.status + "/" + v.runningStatus;
    if (process.env.SWFIX_DEBUG && page.sw[v.versionId] !== st) console.log("  sw", (Date.now() % 100000) / 1000, "v" + v.versionId, st); page.sw[v.versionId] = st; }));
  if (process.env.SWFIX_DEBUG) page.on("console", (m) => { if (/upd|swfix/i.test(m.text())) console.log("  con", (Date.now() % 100000) / 1000, m.text().slice(0, 160)); });
  return { ctx, page, cdp };
}
async function until(page, fn, arg, ms) {
  const end = Date.now() + (ms || 60000);
  while (Date.now() < end) {
    let v = false; try { v = await page.evaluate(fn, arg); } catch (e) {}
    if (v) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const firstLoad = (page, ms) => page.waitForFunction(() => window.PN && PN.s && PN.s.firstLoadDone, null, { timeout: ms || 40000 }).then(() => true, () => false);
const cacheReady = (page, v) => until(page, (v) => !!navigator.serviceWorker.controller && caches.has(v).then((h) => h && caches.open(v).then((c) => c.match("./index.html")).then((r) => !!r)), v, 90000);
async function stopWorkers(cdp) { try { await cdp.send("ServiceWorker.stopAllWorkers"); return true; } catch (e) { return false; } }

/* ---------- W1 / W2 run in a Chromium with NO DevTools on the service workers ----------
   Playwright attaches DevTools to every service worker, and Chromium then keeps a worker alive and has other stop rules
   (service_worker_version.cc OnRequestTermination: "won't be terminated if DevTools is attached"). That is not a phone.
   So W1 / W2 start the same Chromium binary by hand and speak raw CDP to the PAGE only. Supabase points to a dead host
   (no network calls; the app shows its offline state, the update flow does not need Supabase). */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = `(function () { const S = (k, v) => localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  S("olnu.name", "Anton"); S("olnu.age18", "1"); S("olnu.intro", "1"); S("olnu.newsPn", "1"); S("olnu.notifAsked", "1"); S("olnu.notifAskAt", String(Date.now()));
  S("olnu.guideSeen", String(Date.now())); S("olnu.installSeen", "1"); S("olnu.lang", "sv"); S("olnu.inst1", { n: 2, how: "test" }); S("olnu.flyttAsked", "1");
  S("olnu.pnAha", "1"); S("olnu.pnOb", "1"); S("olnu.terms", "1"); return 1; })()`;
const IS_B = "(document.querySelector('meta[name=pn-build]') || {}).content === 'B' && navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active && !r.waiting && r.active.state === 'activated'))";
// mode reload: the app is started again (a reload: the old page goes, a new one comes) · mode back: the app comes back after
// 31 min; the old worker had stopped by itself (30 s with no event, like a phone in the background); the resume burst and a
// poll every 4 s go through the worker. Returns { setup, ms (-1 = not in 30 s), loads, errs, state }.
async function rawRun(mode, A, B) {
  srv.root = A.dir;
  const ud = fs.mkdtempSync(path.join(TMP, "ud-"));
  const ch = spawn(require("./env.js").CHROME || chromium.executablePath(), ["--headless=new", "--no-sandbox", "--disable-background-networking", "--no-first-run",
    "--remote-debugging-port=0", "--user-data-dir=" + ud, "--window-size=390,844",
    "--host-resolver-rules=MAP *.invalid ~NOTFOUND, MAP *.arcgisonline.com ~NOTFOUND, MAP *.cartocdn.com ~NOTFOUND, MAP *.openfreemap.org ~NOTFOUND, MAP *.mapbox.com ~NOTFOUND", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  const out = { setup: false, ms: -1, loads: 0, errs: [], state: null };
  try {
    const wsUrl = await Promise.race([new Promise((res) => { let b = ""; ch.stderr.on("data", (d) => { b += d; const m = /DevTools listening on (ws:\S+)/.exec(b); if (m) res(m[1]); }); }), sleep(20000).then(() => null)]);
    if (!wsUrl) { out.state = "no DevTools url"; return out; }
    const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener("open", r));
    let id = 0; const pend = new Map(); let sid = null;
    ws.addEventListener("message", (m) => { const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
      if (d.sessionId === sid && d.method === "Runtime.exceptionThrown") out.errs.push(String((d.params.exceptionDetails.exception || {}).description || d.params.exceptionDetails.text).slice(0, 140));
      if (d.sessionId === sid && d.method === "Page.frameNavigated" && !d.params.frame.parentId) out.loads++; });
    const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
    sid = (await send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
    const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sid); return r.result && r.result.result ? r.result.result.value : undefined; };
    const until = async (expr, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(250); } return false; };
    await send("Page.enable", {}, sid); await send("Runtime.enable", {}, sid);
    await send("Page.navigate", { url: BASE() }, sid); await sleep(3000);
    await ev(SEED);
    await send("Page.navigate", { url: BASE() }, sid); await sleep(4000);
    const ctl = await until("navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active && navigator.serviceWorker.controller))", 60000);
    await send("Page.navigate", { url: BASE() }, sid); await sleep(5000);
    srv.root = B.dir;
    await ev("navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => 1, () => 0)");
    const waiting = await until("navigator.serviceWorker.getRegistration().then((r) => !!(r && r.waiting && !r.installing))", 60000);
    out.setup = ctl && waiting && (await ev("(document.querySelector('meta[name=pn-build]') || {}).content")) === "A";
    await sleep(mode === "back" ? 40000 : 3000);
    out.errs = []; const l0 = out.loads, t0 = Date.now();
    if (mode === "reload") send("Page.reload", {}, sid);
    else await ev(`(function () {
      const hit = () => { fetch("https://swfix-poll.invalid/rpc?" + Math.random()).catch(() => {}); fetch("./manifest.webmanifest?p=" + Math.random()).catch(() => {}); };
      hit(); UPD0._back(31 * 60e3);
      let n = 0; const t = setInterval(() => { hit(); if (++n > 25) { clearInterval(t); setInterval(hit, 4000); } }, 80); return 1; })()`);
    while (Date.now() - t0 < 30000) { if (await ev(IS_B).catch(() => false)) { out.ms = Date.now() - t0; break; } await sleep(250); }
    await sleep(1500);
    out.loads -= l0;
    out.state = await ev("JSON.stringify({ upd: window.UPD0 && UPD0.state(), build: (document.querySelector('meta[name=pn-build]') || {}).content })").catch(() => null);
    ws.close();
  } finally {
    ch.kill("SIGKILL"); await sleep(400);
  }
  return out;
}

async function swPart(browser, cfg) {
  const A = build("A", 'window.OLNU_CONFIG = { SUPABASE_URL: "https://swfix-sb.invalid", SUPABASE_ANON_KEY: "x" };\n', 1500);
  const B = build("B", 'window.OLNU_CONFIG = { SUPABASE_URL: "https://swfix-sb.invalid", SUPABASE_ANON_KEY: "x" };\n', 0);
  console.log("builds:", A.ver, B.ver, "from", DOCS);
  await startServer();
  const wOn = (n) => PARTS.includes("sw") || PARTS.includes(n);   // parts w1, w2, w3 = one check only
  const N = +(process.env.SWFIX_RUNS || 2);
  // W1 the app is started again (reload) while B waits
  if (wOn("w1")) {
    const r = []; for (let i = 0; i < N; i++) r.push(await rawRun("reload", A, B));
    ok("W1 start again (reload) with B waiting, no DevTools: B runs within 6 s every time, at most 2 page loads, no page error (" + N + " runs)",
      r.every((x) => x.setup && x.ms >= 0 && x.ms < 6000 && x.loads <= 2 && x.errs.length === 0), r);
  }
  // W2 back after 31 min: the old worker had stopped; the app's resume calls wake it while B asks to take over.
  // Before: Chromium kept the old worker (its 30 s idle wait, a poll every few seconds = never idle): no switch in 30 s.
  if (wOn("w2")) {
    const r = []; for (let i = 0; i < N; i++) r.push(await rawRun("back", A, B));
    ok("W2 back after 31 min, no DevTools: B runs within 6 s every time with ONE page load, no page error (was: no switch in 30 s) (" + N + " runs)",
      r.every((x) => x.setup && x.ms >= 0 && x.ms < 6000 && x.loads === 1 && x.errs.length === 0), r);
  }
  // W3 a Supabase call does not wake a stopped worker (static route to the network). Only on Chromium 123+ (addRoutes).
  if (wOn("w3")) {
    srv.root = B.dir;
    const { ctx, page, cdp } = await swCtx(browser);
    await page.goto(BASE()); await firstLoad(page); await cacheReady(page, B.ver);
    await page.reload(); await firstLoad(page); await wait(page, 1500);
    const has = +(browser.version().split(".")[0]) >= 123;   // InstallEvent.addRoutes (it is not visible from the page)
    await page.evaluate(() => { for (let i = 0; i < 999; i++) clearInterval(i); });   // the app's own timers (polls) off
    await stopWorkers(cdp); await wait(page, 1500);
    const before = Object.values(page.sw).filter((s) => /^activated\//.test(s));
    await page.evaluate(() => fetch("https://swfix-probe.supabase.co/rest/v1/rpc/swfix_probe", { method: "POST", body: "{}" }).catch(() => {}));
    await page.evaluate(() => fetch("https://api.mapbox.com/swfix-probe").catch(() => {}));
    await wait(page, 1500);
    const after = Object.values(page.sw).filter((s) => /^activated\//.test(s));
    ok("W3 a Supabase / Mapbox call does not wake the stopped worker (it goes straight to the network)", !has || (before.join() === "activated/stopped" && after.join() === "activated/stopped"), { addRoutes: has, before, after });
    await ctx.close();
  }
  try { srv.http.close(); } catch (e) {}
}

/* ---------- fx: canvas effects, random seeds, slow taps, small and 0-size screens ---------- */
// Every arc / ellipse / radial gradient with a negative or NaN radius is noted (also the ones a try/catch hides: there the
// effect just stops), then the real call runs.
const GUARD = () => {
  window.__bad = [];
  const P = CanvasRenderingContext2D.prototype;
  const wrap = (name, idx) => { const f = P[name]; P[name] = function () {
    for (const i of idx) { const v = arguments[i]; if (!(v >= 0)) {
      const at = ((new Error().stack || "").split("\n")[2] || "").replace(/^.*\/js\//, "").replace(/\?v=[^:]*/, "").slice(0, 50);
      if (window.__bad.length < 40) window.__bad.push(name + " r=" + (typeof v === "number" ? Math.round(v * 10) / 10 : v) + " @" + at); break; } }
    return f.apply(this, arguments); }; };
  wrap("arc", [2]); wrap("ellipse", [2, 3]); wrap("createRadialGradient", [2, 5]); wrap("arcTo", [4]);
  // seeded Math.random (mulberry32): each run is one known seed
  window.__seed = (s) => { let a = s >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  // a slow tap: other animations run (map, sky), the tap handler takes `ms`; the effect starts at its end. The first frame of
  // the effect then carries the time stamp of a frame that began BEFORE the effect started (Chromium: about -ms).
  window.__slowTap = (ms, fn) => new Promise((res) => {
    if (!window.__spin) { window.__spin = 1; (function spin() { requestAnimationFrame(spin); })(); }
    setTimeout(() => { const s = performance.now(); while (performance.now() - s < ms) {} try { fn(); } catch (e) { window.__bad.push("throw " + String(e.message).slice(0, 80)); } res(); }, 30);
  });
};

async function fxRun(browser, vp, zero) {
  const { ctx, page } = await H.ctxFor(browser, vp);
  await ctx.addInitScript(GUARD);
  if (zero) await ctx.addInitScript(() => { window.__zero = () => { ["innerWidth", "innerHeight"].forEach((k) => Object.defineProperty(window, k, { configurable: true, get: () => 0 })); }; });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
  await H.boot(page);
  await page.waitForFunction(() => window.PNTapFx && window.FX && FX.juice && window.PNSky, null, { timeout: 20000 }).catch(() => {});
  const tag = vp.width + "x" + vp.height + (zero ? " (0-size window)" : "");
  const on = await page.evaluate(() => PNTapFx.on());
  if (zero) await page.evaluate(() => window.__zero());
  // 1) every tap effect (seasontap.js), 3 seeds, all ids at once after a 250 ms tap
  const tap = await page.evaluate(async () => {
    const ids = PNTapFx.ids(), out = { ids: ids.length, started: 0, alive: 0, frames0: PNTapFx.stats.frames };
    for (const seed of [11, 222, 3333]) {
      window.__seed(seed); PNTapFx._reset();
      await window.__slowTap(250, () => { ids.forEach((id) => { window.__PN_TAPFX = id; const host = document.createElement("div"); document.body.appendChild(host); if (PNTapFx.play(host, false)) out.started++; }); });
      await new Promise((r) => setTimeout(r, 400));
      out.alive += PNTapFx.running();   // an effect that hit a bad radius was stopped by its own try/catch
      await new Promise((r) => setTimeout(r, 2400));
    }
    window.__PN_TAPFX = ""; out.frames = PNTapFx.stats.frames - out.frames0;
    return out;
  });
  const badTap = await page.evaluate(() => window.__bad.splice(0));
  ok("F1 " + tag + ": all " + tap.ids + " tap effects x 3 seeds after a slow tap: no negative / NaN radius, none stopped early", on && tap.started === tap.ids * 3 && tap.alive === tap.started && badTap.length === 0, { on, tap, bad: badTap.slice(0, 6) });
  // 2) the ÖL! press burst (juice.js) after a slow tap, 6 seeds
  await page.evaluate(async () => {
    const b = document.getElementById("btn-beer");
    for (const seed of [1, 2, 3, 4, 5, 6]) { window.__seed(seed); await window.__slowTap(250, () => FX.juice.press(b)); await new Promise((r) => setTimeout(r, 700)); }
  });
  const badJuice = await page.evaluate(() => window.__bad.splice(0));
  const jc = await page.evaluate(() => document.querySelectorAll(".jc-cv").length);
  ok("F2 " + tag + ": the ÖL! press burst x 6 after a slow tap: no negative radius, the canvas is gone after it", badJuice.length === 0 && jc === 0, { bad: badJuice.slice(0, 6), canvasLeft: jc });
  // 3) weather / sky scenes (seasonsky.js + seasonfw.js) after a slow tap
  const sky = await page.evaluate(async () => {
    const names = ["snow", "rain", "leaves", "fog", "fireworks", "aurora"], e0 = PNSky.stats.ended.length;
    window.__seed(77);
    await window.__slowTap(250, () => names.forEach((n) => PNSky.start(n)));
    await new Promise((r) => setTimeout(r, 1500));
    const broke = PNSky.stats.ended.slice(e0).filter((x) => /!$/.test(x));
    PNSky.stop(); return { broke, active: PNSky.active() };
  });
  const badSky = await page.evaluate(() => window.__bad.splice(0));
  ok("F3 " + tag + ": sky scenes after a slow tap: no negative radius, no scene stopped by an error", badSky.length === 0 && sky.broke.length === 0, { bad: badSky.slice(0, 6), sky });
  ok("F4 " + tag + ": no page errors", errs.filter((e) => !/ResizeObserver/.test(e)).length === 0, errs.slice(0, 4));
  await ctx.close();
}

(async () => {
  let cfg = "";
  try { cfg = await (await fetch(`http://127.0.0.1:${PORT}/config.js`)).text(); } catch (e) {}
  if (!/SUPABASE_URL/.test(cfg) || /wcdskpcevbhouvbytkhv/.test(cfg)) { console.log("FAIL the server on port " + PORT + " must serve the STAGING config.js (PN_TARGET=staging python3 tests/e2e/serve.py " + PORT + " docs)"); process.exit(1); }
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors",
    "--host-resolver-rules=MAP *.arcgisonline.com ~NOTFOUND, MAP *.cartocdn.com ~NOTFOUND, MAP *.openfreemap.org ~NOTFOUND, MAP *.invalid ~NOTFOUND, MAP swfix-probe.supabase.co ~NOTFOUND, MAP api.mapbox.com ~NOTFOUND"] });
  try {
    if (["sw", "w1", "w2", "w3"].some((p) => PARTS.includes(p))) await swPart(browser, cfg);
    if (PARTS.includes("fx")) {
      await fxRun(browser, { width: 390, height: 844 });
      await fxRun(browser, { width: 320, height: 480 });
      await fxRun(browser, { width: 320, height: 480 }, true);
    }
  } catch (e) {
    console.log("FAIL crash " + String(e && e.stack || e).slice(0, 700)); fail++;
  }
  await browser.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log("swfix-pw:", pass, "pass,", fail, "fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", String(e && e.stack || e).slice(0, 500)); process.exit(1); });
