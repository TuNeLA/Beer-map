// start1-pw.js — lane start1 (14 Nov 2026). Owner I-107: "it took like 5 seconds, and then it opened the app again".
// Storage audit items 1 (saved map first), 2 (new version without a reload + the version-mix fix F4), 4 (no double download),
// 5b (map tiles survive an update), 8 (wipe at logout / account deletion).
// usage: node start1-pw.js <port> [parts]     parts: snap,priv,wipe,del,update,once   (default: all)
//   <port> = the normal test server (tests/e2e/serve.py <port> docs). Only its /config.js (the staging config) is read.
//   The app is served by THIS test from two TEMP COPIES of docs/ (build A, build B; stamped with scripts/stamp.mjs like a
//   deploy) on a free port, with real service workers and "Cache-Control: max-age=600" like GitHub Pages. The repo files
//   are never changed. START1_DOCS=<dir> tests another docs/ folder (the old code: every numbered check below must FAIL there).
// Supabase is mocked (ds-helpers mock + an own poll_v2). "once" runs with no routes (routes turn the HTTP cache off):
// a new visitor with no account, its one public poll may reach staging.
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { execFileSync } = require("child_process");
const PORT = process.argv[2] || 8871;
const PARTS = (process.argv[3] || "snap,priv,wipe,del,update,once").split(",");
const REPO = path.join(__dirname, "..", ".."), DOCS = path.resolve(process.env.START1_DOCS || path.join(REPO, "docs"));
const wait = (p, ms) => p.waitForTimeout(ms);
let pass = 0, fail = 0;
const ok = (m, c, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 500))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const hhmm = (ms) => { const d = new Date(ms); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); };

/* ---------- two stamped builds + a static server like GitHub Pages ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pn-start1-"));
function build(tag, cfg) {
  const dir = path.join(TMP, tag);
  fs.cpSync(DOCS, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.js"), cfg);
  const ix = path.join(dir, "index.html");
  fs.writeFileSync(ix, fs.readFileSync(ix, "utf8").replace("<head>", '<head>\n<meta name="pn-build" content="' + tag + '">'));
  if (tag !== "A") fs.appendFileSync(path.join(dir, "js", "pn.js"), "\n// build " + tag + "\n");   // one file with a new hash
  execFileSync("node", [path.join(REPO, "scripts", "stamp.mjs"), dir], { stdio: "pipe" });
  const ver = (fs.readFileSync(path.join(dir, "sw.js"), "utf8").match(/^var VERSION = "([^"]*)";/m) || [])[1];
  return { dir, ver, tag };
}
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", png: "image/png",
  ico: "image/x-icon", svg: "image/svg+xml", woff2: "font/woff2", webmanifest: "application/manifest+json", jpg: "image/jpeg", webp: "image/webp", txt: "text/plain" };
// srv.root = the folder served now · srv.sw = the folder sw.js comes from (null = root) · srv.block = refuse everything
// srv.lie = { "/js/x.js": n } → the next n answers for that path carry other bytes (a deploy that is half way)
const srv = { root: "", sw: null, block: false, lie: {}, counts: new Map(), port: 0 };
function startServer() {
  return new Promise((res) => {
    const s = http.createServer((req, rs) => {
      if (srv.block) { req.socket.destroy(); return; }
      let p; try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { rs.writeHead(400); rs.end(); return; }
      if (p.endsWith("/")) p += "index.html";
      const root = p === "/sw.js" && srv.sw ? srv.sw : srv.root, f = path.join(root, p);
      if (f.indexOf(root) !== 0) { rs.writeHead(403); rs.end(); return; }
      fs.readFile(f, (err, buf) => {
        if (err) { rs.writeHead(404, { "Content-Type": "text/plain" }); rs.end("404"); return; }
        srv.counts.set(req.url, (srv.counts.get(req.url) || 0) + 1);
        if (srv.lie[p] > 0) { srv.lie[p]--; buf = Buffer.concat([buf, Buffer.from("\n// old bytes\n")]); }
        rs.writeHead(200, { "Content-Type": TYPES[path.extname(f).slice(1)] || "application/octet-stream", "Content-Length": buf.length, "Cache-Control": "max-age=600" });
        rs.end(buf);
      });
    });
    s.listen(0, "127.0.0.1", () => { srv.port = s.address().port; srv.http = s; res(); });
  });
}

/* ---------- the phone: seeded user, mocked Supabase with an own poll_v2 ---------- */
const NOW = Date.now(), iso = (m) => new Date(NOW - m * 60e3).toISOString();
const fakeJwt = () => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return b({ alg: "HS256", typ: "JWT" }) + "." + b({ sub: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", role: "authenticated", exp: Math.floor(NOW / 1000) + 86400, is_anonymous: true }) + ".sig"; };
const SESSION = { access_token: fakeJwt(), token_type: "bearer", expires_in: 86400, expires_at: Math.floor(NOW / 1000) + 86400, refresh_token: "rt-fake",
  user: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: iso(9999) } };
const pin = (id, ll, o = {}) => ({ id, lat: ll[0], lng: ll[1], beer_count: o.n || 2, other_count: 0, precise: true, created_at: iso(30), is_mine: !!o.mine, friend_name: o.f || null, skal_count: 0, i_skaled: false });
// me + 2 friends + 2 strangers, far from each other and from the bars (own pins, no cluster at z14)
const PINS = [pin(7001, [60.1440, 15.1790], { mine: 1, n: 3 }), pin(7002, [60.1561, 15.1960], { f: "Oskar", n: 4 }), pin(7003, [60.1425, 15.1975], { f: "Lisa" }),
  pin(7004, [60.1585, 15.1790]), pin(7005, [60.1400, 15.1873])];
const ans = (net) => ({ v: 1, server_time: new Date().toISOString(), full: true, bbox: [59.5, 14.5, 60.8, 15.9], pins: net.pins || PINS, capped: false, pins_in_view: (net.pins || PINS).length, live_total: 12,
  me: { id: 7001, beer_count: 3, other_count: 0, other_kind: null, hidden: false, ghost: false, expires_at: new Date(Date.now() + 5 * 3600e3).toISOString(), wait_seconds: 0, undo_until: null, undos_left: 3, beer_at: null },
  checkins: [{ bar_id: "n3472634175", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679, name: "Oskar", is_mine: false, is_friend: true, created_at: iso(40) }] });
async function newCtx(browser, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "sv-SE", isMobile: true, hasTouch: true,
    geolocation: { latitude: 60.1511, longitude: 15.1876 }, permissions: ["geolocation"],
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36" });
  await ctx.addInitScript(({ SESSION, clean }) => {
    window.__boot = Math.random();
    try { const o = JSON.parse(sessionStorage.getItem("t.or") || "[]"); o.push(performance.timeOrigin); sessionStorage.setItem("t.or", JSON.stringify(o)); } catch (e) {}   // every page load of this tab
    if (clean || localStorage.getItem("t.seeded")) return;   // once per phone (a new tab must not undo a logout)
    localStorage.setItem("t.seeded", "1");
    const S = (k, v) => localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    S("olnu.name", "Anton"); S("olnu.age18", "1"); S("olnu.intro", "1"); S("olnu.newsPn", "1"); S("olnu.notifAsked", "1"); S("olnu.notifAskAt", String(Date.now()));
    S("olnu.guideSeen", String(Date.now())); S("olnu.installSeen", "1"); S("olnu.lang", "sv"); S("olnu.inst1", { n: 2, how: "test" }); S("olnu.flyttAsked", "1");
    S("olnu.pnAha", "1"); S("olnu.pnOb", "1"); S("olnu.terms", "1"); S("olnu.auth", SESSION); S("olnu.uid", SESSION.user.id);
    S("olnu.night", { count: 3, expires: Date.now() + 6 * 3600e3, lastTap: Date.now() - 40 * 60e3 });
  }, { SESSION, clean: !!o.clean });
  return ctx;
}
// net = { hold: true → Supabase calls get no answer until release(), down: true → they fail at once, pins, polls }
async function newPage(ctx, net) {
  const page = await ctx.newPage();
  page.loads = 0; page.errs = [];
  page.on("domcontentloaded", () => { page.loads++; if (process.env.START1_DEBUG) console.log("  load", page.loads, page.url(), Date.now() % 100000); });
  if (process.env.START1_DEBUG) page.on("console", (m) => { if (/upd|wipe|sw/i.test(m.text())) console.log("  console", m.text().slice(0, 200)); });
  page.on("pageerror", (e) => page.errs.push(String(e.message).slice(0, 140)));
  if (!net) return page;
  await H.mock(page);
  await page.route(/supabase\.co\/(rest|auth|functions)\//, (r) => {
    if (net.down) return r.abort("internetdisconnected");
    if (net.hold) { net.held.push(() => r.fallback().catch(() => {})); return; }
    return r.fallback();
  });
  await page.route(/rest\/v1\/rpc\/delete_my_data(_v2)?\b/, (r) => J(r, { ok: true }));
  await page.route(/rest\/v1\/rpc\/poll_v2\b/, (r) => {
    if (net.down) return r.abort("internetdisconnected");
    const go = () => { net.polls++; return J(r, ans(net)).catch(() => {}); };
    if (net.hold) { net.held.push(go); return; }
    return go();
  });
  return page;
}
const mkNet = () => ({ hold: false, down: false, held: [], polls: 0, pins: null });
const release = (net) => { net.hold = false; const h = net.held; net.held = []; h.forEach((f) => f()); };
const BASE = () => `http://127.0.0.1:${srv.port}/`;
// poll an (async) page function from here, every 500 ms, until it is true
async function until(page, fn, arg, ms) {
  const end = Date.now() + (ms || 90000);
  while (Date.now() < end) {
    let v = false; try { v = await page.evaluate(fn, arg); } catch (e) {}
    if (v) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
// page loads of this tab so far (the init script notes each document; a reload that comes before DOMContentLoaded counts too)
const nLoads = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("t.or") || "[]").length).catch(() => -1);
// "the phone went idle": stop every service worker (they start again on the next event). Chromium lets a new worker in
// only when the old one has no work; a worker that is stopped has none. On a phone this is the state after some minutes
// in the background.
async function idleWorkers(ctx, page) { try { const c = await ctx.newCDPSession(page); await c.send("ServiceWorker.enable"); await c.send("ServiceWorker.stopAllWorkers"); await c.detach(); return true; } catch (e) { console.log("  (stopAllWorkers: " + String(e.message || e).slice(0, 80) + ")"); return false; } }
const buildIs = (page, tag, ms) => until(page, (tag) => (document.querySelector('meta[name="pn-build"]') || {}).content === tag && !!(window.PN && PN.s && PN.s.firstLoadDone), tag, ms);
const waitingNow = (page) => until(page, () => navigator.serviceWorker.getRegistration().then((r) => !!(r && r.waiting && !r.installing)));
const firstLoad = (page, ms) => page.waitForFunction(() => window.PN && PN.s && PN.s.firstLoadDone, null, { timeout: ms || 40000 }).then(() => true, () => false);
// the active worker's VERSION + the caches on the phone
const swInfo = (page) => page.evaluate(() => new Promise((res) => {
  const out = { ctl: !!navigator.serviceWorker.controller, ver: null, waiting: false, keys: [], build: (document.querySelector('meta[name="pn-build"]') || {}).content || null,
    boot: window.__boot, newver: !!document.getElementById("pn-newver"), upd: window.UPD0 ? UPD0.state() : {} };
  const fin = () => caches.keys().then((k) => { out.keys = k; res(out); }, () => res(out));
  navigator.serviceWorker.getRegistration().then((reg) => {
    out.waiting = !!(reg && reg.waiting);
    const w = reg && reg.active;
    if (!w) return fin();
    const ch = new MessageChannel(); let done = false;
    ch.port1.onmessage = (e) => { if (done) return; done = true; out.ver = e.data && e.data.v; fin(); };
    try { w.postMessage({ type: "pn-ver" }, [ch.port2]); } catch (e) {}
    setTimeout(() => { if (!done) { done = true; fin(); } }, 1500);   // the old sw.js has no pn-ver: ver stays null
  }, fin);
}));
// wait until the cache of version v holds its page (= the precache is complete) and a worker controls the page
const cacheReady = (page, v, ms) => until(page, (v) => !!navigator.serviceWorker.controller && caches.has(v).then((h) => h && caches.open(v).then((c) => c.match("./index.html")).then((r) => !!r)), v, ms);
const mods = (page) => page.evaluate(() => ({ missing: ["PN", "U", "X8", "SAFETY", "SOCIAL", "PNDS", "BARS"].filter((k) => !window[k]), build: (document.querySelector('meta[name="pn-build"]') || {}).content || null }));
// what is on the map from other people + the caption + the dim
const mapState = (page) => page.evaluate(() => {
  const c = document.getElementById("x8-stale"), vis = (e) => !!(e && !e.hidden && e.getClientRects().length && getComputedStyle(e).opacity !== "0");
  const b = (window.PN && PN.s && PN.s.beers) || [], pane = document.querySelector(".leaflet-marker-pane");
  return { friends: b.filter((x) => x.friend_name).map((x) => x.friend_name).sort(), strangers: b.filter((x) => !x.friend_name && !x.is_mine).length, mine: b.filter((x) => x.is_mine).length,
    dom: document.querySelectorAll(".leaflet-marker-pane .pp-f").length, cis: (PN.s.checkins || []).length, cap: vis(c), capText: c ? c.textContent.trim() : "", snapCls: document.body.classList.contains("x8-snap"),
    dim: pane ? getComputedStyle(pane).opacity : "", total: PN.s.liveTotal, snapKey: !!localStorage.getItem("olnu.x8.snap"),
    errToasts: document.querySelectorAll("#toasts .toast.err").length, boot: window.__boot, first: !!PN.s.firstLoadDone };
});

(async () => {
  let cfg = "";
  try { cfg = await (await fetch(`http://127.0.0.1:${PORT}/config.js`)).text(); } catch (e) {}
  if (!/SUPABASE_URL/.test(cfg) || /wcdskpcevbhouvbytkhv/.test(cfg)) { console.log("FAIL the server on port " + PORT + " must serve the STAGING config.js (PN_TARGET=staging python3 tests/e2e/serve.py " + PORT + " docs)"); process.exit(1); }
  const A = build("A", cfg), B = build("B", cfg);
  console.log("builds:", A.ver, B.ver, "from", DOCS);
  await startServer();
  // The raster tile hosts do not resolve in this test: a tile request through the service worker that hangs keeps the old
  // worker busy, and the browser lets a new worker in only when the old one has no request in flight.
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors",
    "--host-resolver-rules=MAP *.arcgisonline.com ~NOTFOUND, MAP *.cartocdn.com ~NOTFOUND, MAP *.openfreemap.org ~NOTFOUND"] });
  try {
    /* ===== snap + priv: the saved map first (audit item 1) ===== */
    if (PARTS.includes("snap") || PARTS.includes("priv")) {
      srv.root = A.dir; srv.sw = null; srv.block = false;
      const ctx = await newCtx(browser), net = mkNet();
      let page = await newPage(ctx, net);
      await page.goto(BASE());
      const up = await firstLoad(page);
      await cacheReady(page, A.ver);
      await page.reload(); await firstLoad(page); await wait(page, 1500);   // 2nd load: under the worker, so the CDN files are in its cache too
      const saved = await page.evaluate(() => { try { const o = JSON.parse(localStorage.getItem("olnu.x8.snap")); return { n: o.pins.length, f: o.pins.filter((p) => p.friend_name).length, at: o.at }; } catch (e) { return null; } });
      ok("S0 setup: first start online, the poll answer is saved on the phone (5 pins, 2 friends)", up && saved && saved.n === 5 && saved.f === 2, { up, saved });
      await page.close();

      if (PARTS.includes("snap")) {
        // second start, network blocked: the site server refuses everything, Supabase gives no answer (a weak signal: the
        // old code waited for the 15 s RPC timeout before it drew the saved map)
        srv.block = true; net.hold = true;
        page = await newPage(ctx, net);
        await page.goto(BASE(), { waitUntil: "commit" });
        const t = await page.evaluate(() => new Promise((res) => {
          (function chk() {
            const n = document.querySelectorAll(".leaflet-marker-pane .pp-f").length;
            if (n >= 3) return res({ ms: Math.round(performance.now()), n });
            if (performance.now() > 9000) return res({ ms: -1, n });
            requestAnimationFrame(chk);
          })();
        })).catch((e) => ({ ms: -2, e: String(e).slice(0, 80) }));
        const mark = await page.evaluate(() => { const m = performance.getEntriesByName("pn:snap")[0], n = performance.getEntriesByType("navigation")[0] || {};
          return { snap: m ? Math.round(m.startTime) : -1, scriptsFrom: Math.round(n.domInteractive || 0), scriptsDone: Math.round(n.domContentLoadedEventStart || 0) }; }).catch(() => ({}));
        await wait(page, 400);   // the line fades in (opacity 0 → 1)
        const s1 = await mapState(page).catch(() => ({}));
        ok("S1 second start, network blocked: my pin + 2 friends' pins are on the map within 1 s", t.ms > 0 && t.ms <= 1000, { firstSeenMs: t.ms, mark, dom: t.n });
        ok("S2 … the friends are the saved ones, strangers too (snapshot under 30 min), the live total is the saved one", s1.friends && s1.friends.join() === "Lisa,Oskar" && s1.strangers === 2 && s1.mine === 1 && s1.total === 12, s1);
        ok("S3 … ONE quiet line 'Senast uppdaterad HH:MM' with the snapshot's time, no red toast, no poll answer yet", s1.cap && s1.capText === "Senast uppdaterad " + hhmm(saved.at) && s1.errToasts === 0 && s1.first === false, { cap: s1.cap, txt: s1.capText, want: hhmm(saved.at), err: s1.errToasts });
        ok("S4 … the saved pins are dimmed (people pane at 60 %)", s1.snapCls === true && Math.abs(parseFloat(s1.dim) - 0.6) < 0.01, { cls: s1.snapCls, dim: s1.dim });
        await page.screenshot({ path: require("./env.js").OUT + "start1-snap.png" }).catch(() => {});
        // the first poll answers (one friend went home): live pins replace the snapshot, the line and the dim go away, no reload
        net.pins = PINS.filter((p) => p.id !== 7003);
        srv.block = false; release(net);
        await firstLoad(page, 30000); await wait(page, 600);
        const s2 = await mapState(page);
        ok("S5 the first poll replaces the saved pins: 1 friend left, line gone, dim gone, same page (no reload)", s2.first && s2.friends.join() === "Oskar" && !s2.cap && !s2.snapCls && s2.dim === "1" && s2.boot === s1.boot && (await nLoads(page)) === 1, { s2, loads: await nLoads(page) });
        net.pins = null;
        await page.close();
      }

      if (PARTS.includes("priv")) {
        // privacy rules: age the snapshot on the phone, start with no network answer, look at what is drawn
        const start = async (edit) => {
          const p0 = await newPage(ctx, net);
          srv.block = false; net.hold = false;
          await p0.goto(BASE()); await firstLoad(p0); await wait(p0, 300);
          const same = await p0.evaluate(({ edit, PINS }) => {
            const o = { at: Date.now(), u: "aaaaaaaa", pins: PINS, live_total: 12, checkins: [{ bar_id: "b1", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679, name: "Oskar", is_mine: false, is_friend: true }, { bar_id: "b1", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679, name: "Kalle", is_mine: false, is_friend: false }] };
            if (edit.min) o.at -= edit.min * 60e3;
            if (edit.user) o.u = edit.user;
            localStorage.setItem("olnu.x8.snap", JSON.stringify(o));
            return U.next5am(new Date(o.at)).getTime() === U.next5am().getTime();
          }, { edit, PINS });
          await p0.close();
          net.hold = true;
          const p = await newPage(ctx, net);
          await p.goto(BASE());
          await p.waitForFunction(() => window.__pnSplashGone || performance.now() > 4000, null, { timeout: 15000 }).catch(() => {});
          await wait(p, 400);
          const s = await mapState(p);
          release(net); await p.close();
          return { s, same };
        };
        let r = await start({ min: 26 * 60 });
        ok("P1 a snapshot from another night (26 h old): no other people on the map, no line, the snapshot is deleted", r.s.friends.length === 0 && r.s.strangers === 0 && r.s.dom === 0 && !r.s.snapCls && !r.s.snapKey, r.s);
        r = await start({ min: 45 });
        if (r.same) ok("P2 a 45 min old snapshot of tonight: my pin + friends, NO strangers, no stranger check-in, no live total", r.s.friends.join() === "Lisa,Oskar" && r.s.strangers === 0 && r.s.mine === 1 && r.s.cis === 1 && r.s.total == null && r.s.snapCls, r.s);
        else ok("P2 (run just after 05:00: 45 min ago was last night) nothing of other people is drawn", r.s.friends.length === 0 && r.s.strangers === 0, r.s);
        r = await start({ min: 200 });
        if (r.same) ok("P3 a 3 h 20 min old snapshot of tonight: only my own pin", r.s.friends.length === 0 && r.s.strangers === 0 && r.s.mine === 1 && r.s.cis === 0, r.s);
        else ok("P3 (run before 08:20: 200 min ago was last night) nothing of other people is drawn", r.s.friends.length === 0 && r.s.strangers === 0, r.s);
        r = await start({ user: "bbbbbbbb" });
        ok("P4 a snapshot of another account: nothing drawn, deleted", r.s.friends.length === 0 && r.s.strangers === 0 && r.s.mine === 0 && !r.s.snapKey, r.s);
      }
      await ctx.close();
    }

    /* ===== wipe + del: logout / account deletion (audit F7, item 8) ===== */
    const LS = ["olnu.x8.snap", "olnu.x8.last", "olnu.x8.outbox", "olnu.otherQueue", "olnu.warm.d1", "olnu.warm.r1", "olnu.ffNames", "olnu.squadLast", "olnu.rallyHeads", "olnu.kingOf",
      "olnu.newsRanks", "olnu.gact", "olnu.pinFolj", "olnu.pinFolj.last", "olnu.walkMine"];
    const fill = (page, LS) => page.evaluate(async (LS) => {
      LS.forEach((k) => localStorage.setItem(k, JSON.stringify({ t: 1, who: "ZZseed" })));
      localStorage.setItem("olnu.lang", "sv");
      const pend = await caches.open("olnu-pending");
      for (const k of ["./__face/abc", "./__face/def", "./__pnq", "./__pnlog_ntf", "./__badge", "./__pending_open"]) await pend.put(k, new Response("x"));
      await pend.put("./__kanal", new Response(JSON.stringify({ ch: "stable" }), { headers: { "Content-Type": "application/json" } }));
      await (await caches.open("olnu-bold")).put("./bg1", new Response("img"));
      await (await caches.open("mapbox-tiles")).put("./t1", new Response("tile"));
      const put = (name, store) => new Promise((res) => { const rq = indexedDB.open(name, 1); rq.onupgradeneeded = () => rq.result.createObjectStore(store);
        rq.onsuccess = () => { const tx = rq.result.transaction(store, "readwrite"); tx.objectStore(store).put({ s: Date.now(), b: "photo of Oskar" }, "k1"); tx.oncomplete = () => res(rq.result); }; rq.onerror = () => res(null); });
      window.__keepDb = await put("olnu-photos", "p");   // stays OPEN, like js/photo.js after a chat photo
      const q = await put("olnu-film-q", "q"); if (q) q.close();
    }, LS);
    const left = (page, LS) => page.evaluate(async (LS) => {
      // "left" = still holds what fill() put there (the app writes new, empty values for the next account after the reload)
      const out = { ls: LS.filter((k) => /ZZseed/.test(localStorage.getItem(k) || "")), lang: localStorage.getItem("olnu.lang"), intro: localStorage.getItem("olnu.intro"), mark: localStorage.getItem("pn.wipe") };
      const keys = await caches.keys();
      out.bold = keys.includes("olnu-bold"); out.tiles = keys.includes("mapbox-tiles");
      out.pend = []; out.kanal = false;
      if (keys.includes("olnu-pending")) { const c = await caches.open("olnu-pending");
        for (const r of await c.keys()) { const p = new URL(r.url).pathname, t = await (await c.match(r)).text(); if (/__kanal$/.test(p)) out.kanal = true; else if (t === "x") out.pend.push(p); } }
      const count = (name, store) => new Promise((res) => { const rq = indexedDB.open(name); let fresh = false;
        rq.onupgradeneeded = () => { fresh = true; };
        rq.onsuccess = () => { const db = rq.result; if (fresh || !db.objectStoreNames.contains(store)) { db.close(); indexedDB.deleteDatabase(name); return res(0); }
          const c = db.transaction(store).objectStore(store).count(); c.onsuccess = () => { db.close(); res(c.result); }; c.onerror = () => { db.close(); res(-1); }; };
        rq.onerror = () => res(-1); });
      out.photos = await count("olnu-photos", "p"); out.film = await count("olnu-film-q", "q");
      return out;
    }, LS);
    const clean = (l) => l.ls.length === 0 && !l.bold && l.photos === 0 && l.film === 0 && l.pend.length === 0;
    for (const part of ["wipe", "del"]) {
      if (!PARTS.includes(part)) continue;
      srv.root = A.dir; srv.sw = null; srv.block = false;
      const ctx = await newCtx(browser), net = mkNet(), page = await newPage(ctx, net);
      await page.goto(BASE()); await firstLoad(page); await wait(page, 1500);
      await fill(page, LS);
      const before = await left(page, LS);
      const nav = page.waitForNavigation({ timeout: 25000 }).catch(() => null);
      if (part === "wipe") {
        await page.evaluate(() => window.ACCOUNT.logout());
        await page.waitForSelector("#sheet-body .acct-logout-go", { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => { const b = document.querySelector("#sheet-body .acct-logout-go"); if (b) b.click(); });
      } else {
        // Radera kontot → "Radera direkt, utan ångertid" (misc-mod.js) → the v14.js flow: Ja, radera → Radera nu
        await page.evaluate(() => window.PRIVACY.showDelete());
        await page.waitForSelector("#sheet-body .mm-del-now, #sheet-body .confirm, #sheet-body .btn-danger", { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => { const b = document.querySelector("#sheet-body .mm-del-now"); if (b) b.click(); });
        await page.waitForFunction(() => { const b = document.querySelector("#sheet-body .btn-danger"); return b && !b.classList.contains("mm-del-go"); }, null, { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => { const b = document.querySelector("#sheet-body .btn-danger"); if (b) b.click(); });
        await page.waitForSelector("#sheet-body .confirm .btn-danger", { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => { const b = document.querySelector("#sheet-body .confirm .btn-danger"); if (b) b.click(); });
      }
      await nav; await page.waitForLoadState("domcontentloaded").catch(() => {}); await wait(page, 2500);
      let after = null;
      for (let k = 0; k < 4 && !after; k++) { try { after = await left(page, LS); } catch (e) { await wait(page, 2000).catch(() => {}); } }   // a page that is still reloading
      if (!after) after = { ls: ["?"], pend: ["?"] };
      const name = part === "wipe" ? "logout" : "account deletion";
      ok((part === "wipe" ? "W1 " : "D1 ") + name + ": friends' data is gone from the phone (snapshot, WARM, outboxes, name lists, faces, notification log, olnu-bold, photos, film queue)",
        before.ls.length === LS.length && before.pend.length === 6 && before.bold && before.photos === 1 && before.film === 1 && clean(after), { before: { ls: before.ls.length, pend: before.pend.length, photos: before.photos, film: before.film }, after });
      ok((part === "wipe" ? "W2 " : "D2 ") + name + ": kept = map tiles, the beta channel choice" + (part === "wipe" ? ", device settings (language, intro seen)" : "") + "; no unfinished wipe mark",
        after.tiles && after.kanal && !after.mark && (part !== "wipe" || (after.lang === "sv" && after.intro === "1")), after);
      await ctx.close();
    }

    /* ===== update: a new version without a reload under the user (audit item 2, F4, F1) ===== */
    if (PARTS.includes("update")) {
      srv.root = A.dir; srv.sw = null; srv.block = false;
      const ctx = await newCtx(browser), net = mkNet();
      let page = await newPage(ctx, net);
      await page.goto(BASE()); await firstLoad(page);
      const ready = await cacheReady(page, A.ver);
      await page.reload(); await firstLoad(page); await wait(page, 1000);
      let i = await swInfo(page);
      ok("U0 setup: build A runs under its own worker, its cache is complete", ready && i.ctl && i.build === "A" && i.keys.includes(A.ver), i);
      await page.evaluate(async () => { await (await caches.open("mapbox-tiles")).put("./t1", new Response("tile")); await (await caches.open("olnu-bold")).put("./bg1", new Response("img")); });

      // --- F4 version mix: the site already has build B, this phone still has worker A (its sw.js check has not run yet)
      srv.root = B.dir; srv.sw = A.dir;
      await page.reload(); await firstLoad(page); await wait(page, 3000);   // an online start: the old code stored B's page in A's cache here
      await ctx.setOffline(true); srv.block = true; net.down = true;
      await page.reload().catch(() => {});
      await page.waitForFunction(() => window.__pnSplashGone || performance.now() > 6000, null, { timeout: 20000 }).catch(() => {});
      const m = await mods(page).catch((e) => ({ missing: ["page"], build: String(e).slice(0, 60) }));
      ok("U1 version mix (F4): after a deploy, an OFFLINE start still runs complete build A from A's own cache", m.build === "A" && m.missing.length === 0, m);
      await ctx.setOffline(false); srv.block = false; net.down = false;
      await page.reload(); await firstLoad(page); await wait(page, 500);

      // --- the update is found while the app is open and in use
      srv.sw = null;
      const boot0 = (await swInfo(page)).boot, loads0 = await nLoads(page);
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
      const found = await waitingNow(page);
      await wait(page, 12000);   // the old code reloaded the page a few seconds after the install
      i = await swInfo(page);
      ok("U2 a new version is found while the app is in use: NO reload, the page stays build A, no 'Ny version' button", found && (await nLoads(page)) === loads0 && i.boot === boot0 && i.build === "A" && !i.newver, { found, loads: (await nLoads(page)) - loads0, build: i.build, newver: i.newver });
      ok("U3 … the new worker WAITS; the old one still serves A (both caches on the phone)", i.waiting && i.ver === A.ver && i.keys.includes(A.ver) && i.keys.includes(B.ver) && i.upd && i.upd.ready, { waiting: i.waiting, ver: i.ver, upd: i.upd });
      // a short trip to the background does nothing (the real visibilitychange handler, with a faked hidden state + clock)
      const hideFor = (pg, min) => pg.evaluate((min) => {
        const set = (v) => Object.defineProperty(document, "hidden", { configurable: true, get: () => v });
        set(true); document.dispatchEvent(new Event("visibilitychange"));
        const n = Date.now; Date.now = () => n() + min * 60e3;
        set(false); document.dispatchEvent(new Event("visibilitychange"));
      }, min);
      await hideFor(page, 5); await wait(page, 2500);
      ok("U4 back after 5 min in the background: still no reload", (await nLoads(page)) === loads0 && (await swInfo(page)).build === "A", { loads: (await nLoads(page)) - loads0 });

      // --- cold start: close the app, open it again
      await page.close(); await new Promise((r) => setTimeout(r, 1500));
      page = await newPage(ctx, net);
      await page.goto(BASE()); await firstLoad(page); await wait(page, 4000);
      i = await swInfo(page);
      ok("U5 cold start: build B is active, with exactly ONE page load (the app does not open twice)", i.build === "B" && i.ver === B.ver && (await nLoads(page)) === 1 && page.loads === 1 && !i.waiting, { build: i.build, ver: i.ver, loads: await nLoads(page), waiting: i.waiting });
      ok("U6 the old version's cache is gone; Mapbox's tile cache and olnu-bold survived the update (F1)", !i.keys.includes(A.ver) && i.keys.includes(B.ver) && i.keys.includes("mapbox-tiles") && i.keys.includes("olnu-bold"), i.keys);

      // --- a start on the OLD worker while a new version waits (reload / second tab): at most one reload, under the splash
      srv.root = A.dir;   // "build A" is now the newer deploy
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
      await waitingNow(page);
      let l0 = await nLoads(page);
      await page.reload();
      const took = await buildIs(page, "A", 7000);
      if (took) {
        // when did the page reload itself? ms after the start of the page before this one (the splash stays up to 2.6 s)
        const splash = await page.evaluate(() => { const o = JSON.parse(sessionStorage.getItem("t.or") || "[]"), at = +sessionStorage.getItem("pn.upd.at") || 0; return { at: at, ms: at && o.length > 1 ? Math.round(at - o[o.length - 2]) : -1 }; });
        await wait(page, 6000);
        i = await swInfo(page);
        ok("U7 start on the old worker with a version waiting: ONE extra load, early under the splash, then build A; no loop", i.build === "A" && i.ver === A.ver && (await nLoads(page)) - l0 === 2 && splash.ms >= 0 && splash.ms < 2600, { build: i.build, ver: i.ver, loads: (await nLoads(page)) - l0, reloadAtMs: splash.ms });
      } else {
        // Chromium did not let the new worker in while the page was starting (the old worker was busy): then NO reload now.
        // The worker comes in later, under the running page ("mixed"); the page reloads once at the next return from the background.
        const late = { loads: (await nLoads(page)) - l0, i: await swInfo(page), alive: await firstLoad(page, 20000) };
        await idleWorkers(ctx, page);
        const mixed = await until(page, () => window.UPD0 && UPD0.state().mixed, null, 30000);
        await wait(page, 2000);
        const mid = { loads: (await nLoads(page)) - l0, build: (await swInfo(page)).build, lazy: await page.evaluate(() => fetch("./js/news-more.js" + ((document.querySelector('script[src*="news-more.js"]') || { getAttribute: () => "" }).getAttribute("src") || "").replace(/^[^?]*/, "")).then((r) => r.ok, () => false)) };
        await page.evaluate(() => window.UPD0 && UPD0._back(1000));
        const now = await buildIs(page, "A", 30000);
        await wait(page, 4000);
        i = await swInfo(page);
        ok("U7 (late path) start on the old worker, the browser lets the new one in late: no reload under the running page, its files still load; ONE reload at the next return, then build A",
          late.loads === 1 && late.i.build === "B" && late.alive && mixed && mid.loads === 1 && mid.build === "B" && mid.lazy && now && i.ver === A.ver && (await nLoads(page)) - l0 === 2, { late: { loads: late.loads, build: late.i.build, alive: late.alive }, mixed, mid, now, ver: i.ver, loads: (await nLoads(page)) - l0 });
      }
      ok("U7b the old version's cache went away with that start (not before: the old page could still use it)", !i.keys.includes(B.ver) && i.keys.includes(A.ver), i.keys);
      // loop guard: another version right away → this tab does not reload by itself again (10 min)
      srv.root = B.dir;
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
      await waitingNow(page);
      l0 = await nLoads(page);
      await page.reload(); await firstLoad(page); await wait(page, 5000);
      i = await swInfo(page);
      ok("U8 loop guard: a second new version inside 10 min does not reload this tab again (it keeps waiting)", (await nLoads(page)) - l0 === 1 && i.build === "A" && i.waiting && i.upd.asked === "", { loads: (await nLoads(page)) - l0, build: i.build, waiting: i.waiting, asked: i.upd.asked });

      // --- back after 30 min in the background: not while a sheet is open, else one reload
      await page.evaluate(() => sessionStorage.removeItem("pn.upd.at"));
      l0 = await nLoads(page);
      await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 800);
      await hideFor(page, 31); await wait(page, 2500);
      const busy = { loads: (await nLoads(page)) - l0, build: (await swInfo(page)).build, asked: (await swInfo(page)).upd.asked };
      await page.evaluate(() => { const b = document.getElementById("sheet-close"); if (b) b.click(); }); await wait(page, 800);
      ok("U9 back after 31 min with a sheet open: no reload, nothing asked (never under the user's hands)", busy.loads === 0 && busy.build === "A" && busy.asked === "", busy);
      await idleWorkers(ctx, page);   // 30 min in the background: the workers are stopped
      await page.evaluate(() => window.UPD0 && UPD0._back(31 * 60e3));
      const backOk = await buildIs(page, "B", 30000);
      await wait(page, 4000);
      i = await swInfo(page);
      ok("U10 back after 31 min, nothing open: ONE reload, build B is active", backOk && (await nLoads(page)) - l0 === 1 && i.build === "B" && i.ver === B.ver && !i.waiting, { loads: (await nLoads(page)) - l0, build: i.build, ver: i.ver });

      // --- the manual path: Inställningar → "Uppdatera nu" applies a waiting version at once
      srv.root = A.dir;
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
      await waitingNow(page);
      l0 = await nLoads(page);
      await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
      let tapped = await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => /Uppdatera nu/.test(x.textContent));
        if (!b) { const t = document.querySelector("#sheet-body [data-pf=s]"); if (t) t.click(); } return !!b; });
      if (!tapped) await wait(page, 1500);
      const nav = page.waitForNavigation({ timeout: 40000 }).catch(() => null);
      tapped = await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => /Uppdatera nu/.test(x.textContent)); if (b) b.click(); return !!b; });
      await nav;
      const manual = await buildIs(page, "A", 40000);
      const st1 = await swInfo(page);
      const verA = (v) => new Promise((res) => navigator.serviceWorker.getRegistration().then((r) => { const w = r && r.active; if (!w) return res(false);
        const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(e.data && e.data.v === v); w.postMessage({ type: "pn-ver" }, [ch.port2]); setTimeout(() => res(false), 1000); }));
      if (!(await until(page, verA, A.ver, 15000))) { await idleWorkers(ctx, page); await until(page, verA, A.ver, 60000); }   // the old worker was busy: let it go idle
      await wait(page, 4000);
      i = await swInfo(page);
      const healed = await cacheReady(page, A.ver, 60000);
      ok("U11 'Uppdatera nu' with a version waiting: the new build runs at once with ONE page load; the new worker is asked to take over and does, with no second load",
        tapped && manual && (st1.ver === A.ver || st1.upd.asked === "manual") && i.build === "A" && i.ver === A.ver && !i.waiting && (await nLoads(page)) - l0 === 1 && !i.upd.mixed, { tapped, build: i.build, ver: i.ver, waiting: i.waiting, loads: (await nLoads(page)) - l0, asked: st1.upd.asked, mixed: i.upd.mixed });
      ok("U12 … and its cache is complete again (the button deletes the app caches): the next start works offline", healed, { healed });
      ok("U13 no page errors in the whole update run", page.errs.length === 0, page.errs.slice(0, 4));
      await ctx.close();
    }

    /* ===== once: no double download on the first visit (audit item 4) ===== */
    if (PARTS.includes("once")) {
      srv.root = A.dir; srv.sw = null; srv.block = false; srv.counts.clear();
      srv.lie = { "/js/pn.js": 1 };   // half-way deploy: the first answer for pn.js?v=<new hash> carries other bytes
      const ctx = await newCtx(browser, { clean: true }), page = await newPage(ctx, null);   // no routes: the HTTP cache is on
      await page.goto(BASE());
      const ready = await cacheReady(page, A.ver, 120000);
      const hashed = [...srv.counts.entries()].filter(([u]) => /[?&]v=[0-9a-f]{10}$/.test(u));
      const twice = hashed.filter(([u, n]) => n > 1 && !/\/js\/pn\.js\?/.test(u)).map(([u, n]) => u.replace(/\?.*/, "") + "×" + n);
      const total = hashed.reduce((a, [, n]) => a + n, 0);
      ok("O1 first visit: each ?v= file is downloaded ONCE (the worker takes it from the HTTP cache the page just filled)", ready && hashed.length > 100 && twice.length === 0, { files: hashed.length, requests: total, twice: twice.slice(0, 6), more: twice.length });
      const pn = await page.evaluate(() => caches.keys().then((ks) => caches.open(ks.find((k) => /^olnu-[0-9a-f]{10}$/.test(k))).then((c) => c.keys().then((rs) => { const r = rs.find((x) => /\/js\/pn\.js\?v=/.test(x.url)); return r ? c.match(r).then((x) => x.text()) : null; }))));
      const disk = fs.readFileSync(path.join(A.dir, "js", "pn.js"), "utf8"), nPn = [...srv.counts.entries()].filter(([u]) => /\/js\/pn\.js\?/.test(u)).reduce((a, [, n]) => a + n, 0);
      ok("O2 wrong bytes under a new hash (deploy half way): the worker sees the hash is wrong, downloads again, stores the right file", pn === disk && nPn === 2, { same: pn === disk, requests: nPn });
      srv.lie = {};
      await ctx.close();
    }
  } catch (e) {
    console.log("FAIL crash " + String(e && e.stack || e).slice(0, 700)); fail++;
  }
  await browser.close();
  try { srv.http.close(); } catch (e) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log("start1:", pass, "PASS", fail, "FAIL");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", String(e && e.stack || e).slice(0, 500)); process.exit(1); });
