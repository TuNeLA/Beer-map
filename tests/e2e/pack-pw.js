// lane pack (A5): the PACKED live site (scripts/build-site.mjs --bundle on = what pages-bundle.yml deploys after OWNER-INPUTS C4)
// against the site that is live TODAY (--bundle off = the single files + stamps, the same bytes as the branch deploy + stamp bot).
// usage: node pack-pw.js <port>      <port> = any test server (tests/e2e/serve.py); only its staging /config.js is read.
//        PACK_SWAP=1 node pack-pw.js <port>   the same checks on TODAY's site (must FAIL: proof for the old path)
// The test builds both sites from TEMP COPIES of docs/ and serves them itself with a counting server (requests, bytes and the
// gzip size of each answer: GitHub Pages sends text gzipped). Mocked Supabase (ds-helpers). Service worker ON (a real phone).
// Measured per site: first visit (until "load", then until the worker has cached the app and the lazy files ran), a 2nd and a
// 3rd visit (reload with the worker in charge). Numbers are printed; lane pack DONE.md has a table. Note: Playwright routing (the
// Supabase mock) turns the HTTP cache off, so the repeat numbers are the worst case (a phone also has its HTTP cache).
// "Data" = what sw.js DATA_RE answers stale-while-revalidate (bars, hours, places tiles, dialekt packs): it is refreshed in the
// background on every start by design, so it is counted but not judged here.
// Checks (the today site fails P1 and P3; see the "(today)" reference lines):
//   P1 first visit: <= 16 own scripts + stylesheets that are not x-lazy files (14 start files + slack; sw.js not counted); today 240+
//   P2 2nd and 3rd visit: no own app script / stylesheet comes from the network (all from the worker cache); the app runs,
//      no page error. The 3rd visit has no own request at all except the page, the data refresh and sw.js (the browser
//      checks the worker script for an update on a navigation; CI run 44518767729 saw it on the 3rd visit).
//   P3 first visit downloads less than the today site (gzip bytes)
//   P4 x-lazy files with data-demand stay lazy (the page does not ask for them at start; the worker may precache them for
//      offline), the other x-lazy files still run; the same modules as today
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), zlib = require("zlib");
const { mock } = require("./ds-helpers.js");
const CHROME = require("./env.js").CHROME;
const PORT = process.argv[2] || "8871";
const REPO = path.join(__dirname, "..", "..");
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 700))); c ? pass++ : fail++; };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pn-pack-"));

function build(tag, cfg, extra) {
  const root = path.join(TMP, "src-" + tag), out = path.join(TMP, "out-" + tag);
  fs.cpSync(path.join(REPO, "docs"), path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "config.js"), cfg);
  execFileSync("node", [path.join(REPO, "scripts", "build-site.mjs"), "--repo", root, "--out", out, "--layout", "docs", "--sha", "pack-" + tag].concat(extra), { encoding: "utf8" });
  return { dir: out, meta: JSON.parse(fs.readFileSync(path.join(out, "build.json"), "utf8")) };
}
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", png: "image/png",
  ico: "image/x-icon", svg: "image/svg+xml", woff2: "font/woff2", webmanifest: "application/manifest+json", jpg: "image/jpeg", webp: "image/webp", mp3: "audio/mpeg" };
const TEXT = /\.(html|js|css|json|svg|webmanifest|txt)$/;
const srv = { root: "", log: [], port: 0, gz: new Map() };
function startServer() {
  return new Promise((res) => {
    const s = http.createServer((req, rs) => {
      let p; try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { rs.writeHead(400); rs.end(); return; }
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(srv.root, p);
      if (f.indexOf(srv.root) !== 0) { rs.writeHead(403); rs.end(); return; }
      fs.readFile(f, (err, buf) => {
        if (err) { srv.log.push({ p, bytes: 0, gzip: 0, code: 404 }); rs.writeHead(404, { "Content-Type": "text/plain" }); rs.end("404"); return; }
        const key = f + ":" + buf.length;
        if (!srv.gz.has(key)) srv.gz.set(key, TEXT.test(p) ? zlib.gzipSync(buf, { level: 6 }).length : buf.length);   // Pages: gzip for text
        srv.log.push({ p, bytes: buf.length, gzip: srv.gz.get(key), code: 200 });
        rs.writeHead(200, { "Content-Type": TYPES[path.extname(f).slice(1)] || "application/octet-stream", "Content-Length": buf.length, "Cache-Control": "max-age=600" });
        rs.end(buf);
      });
    });
    s.listen(0, "127.0.0.1", () => { srv.port = s.address().port; srv.http = s; res(); });
  });
}
const BASE = () => "http://127.0.0.1:" + srv.port + "/";
const DATA = /\/(bars(-extra|-closed)?\.json|arenas\.json|hours\.json|systembolaget\.json|places\.json|places\/[^/]+\.json|buildings(3d)?\/[^/]+\.json|zones\/[^/]+\.json|data\/dialekt-kommun\.json|js\/dialekt-packs\/[^/]+\.js)$/;   // = sw.js DATA_RE
const SW = /^\/sw\.js$/;   // the browser's own update check of the worker script (on a navigation): not an app file
const sum = (l) => ({ n: l.length, js_css: l.filter((x) => /\.(js|css)$/.test(x.p) && !DATA.test(x.p) && !SW.test(x.p)).length, data: l.filter((x) => DATA.test(x.p)).length, kb: Math.round(l.reduce((a, x) => a + x.bytes, 0) / 1024), gzip_kb: Math.round(l.reduce((a, x) => a + x.gzip, 0) / 1024) });
const MODS = () => Object.keys(window).filter((k) => /^[A-Z][A-Z0-9_]{1,}$/.test(k) && window[k] != null && !/^(OLNU_BUNDLE_ERR|OLNU_UNBUNDLED)$/.test(k)).sort();
const cached = (page, ver, ms) => page.evaluate(([v, t]) => new Promise((res) => {
  const t0 = Date.now();
  (function chk() {
    caches.open(v).then((c) => c.match("./index.html").then((hit) => {
      if (hit) return c.keys().then((rs) => res(rs.length));
      if (Date.now() - t0 > t) return res(0);
      setTimeout(chk, 300);
    }));
  })();
}), [ver, ms]);

async function visit(browser, site) {
  srv.root = site.dir; srv.log = [];
  const ctx = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 390, height: 844 }, locale: "sv-SE" });
  const page = await ctx.newPage();
  await mock(page);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
  const asked = []; page.on("request", (q) => { if (q.url().startsWith(BASE())) asked.push(q.url().replace(BASE(), "").replace(/\?.*/, "")); });   // the page's own requests (not the worker's)
  const lazyFiles = new Set();
  await page.goto(BASE());                      // resolves at "load"
  const atLoad = sum(srv.log), loadList = srv.log.map((x) => x.p);
  const pills = await page.waitForFunction(() => document.querySelectorAll(".pill").length > 0, null, { timeout: 45000 }).then(() => true, () => false);
  await page.evaluate(() => Promise.race([window.OLNU_LAZY, new Promise((r) => setTimeout(r, 25000))]));
  const cacheN = await cached(page, site.meta.version, 60000);
  await page.waitForTimeout(1500);
  const first = { ...sum(srv.log), list: srv.log.map((x) => x.p) };
  const demand = await page.evaluate(() => [...document.querySelectorAll('script[type="text/x-lazy"][data-demand]')].map((n) => n.getAttribute("src").replace(/^\.\//, "").replace(/\?.*/, "")));
  const notRun = await page.evaluate(() => [...document.querySelectorAll('script[type="text/x-lazy"]:not([data-demand])')].map((n) => n.getAttribute("src"))
    .filter((u) => !document.querySelector('script[src="' + u + '"]:not([type="text/x-lazy"])')));
  const mods = await page.evaluate(MODS);
  (await page.evaluate(() => [...document.querySelectorAll('script[type="text/x-lazy"], link[rel="x-lazy-css"]')].map((n) => (n.getAttribute("src") || n.getAttribute("href")).replace(/^\.\//, "").replace(/\?.*/, ""))))
    .forEach((f) => lazyFiles.add("/" + f));
  const firstAsked = asked.slice();
  const ctl = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
  // 2nd and 3rd visit: the worker is in charge now
  const re = async () => {
    srv.log = [];
    await page.reload();
    const pills = await page.waitForFunction(() => document.querySelectorAll(".pill").length > 0, null, { timeout: 45000 }).then(() => true, () => false);
    await page.evaluate(() => Promise.race([window.OLNU_LAZY, new Promise((r) => setTimeout(r, 25000))]));
    await page.waitForTimeout(1500);
    const ctl = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
    return { ...sum(srv.log), pills, ctl, list: srv.log.map((x) => x.p) };
  };
  const again = await re(), third = await re();
  await ctx.close();
  const startJsCss = first.list.filter((p) => /\.(js|css)$/.test(p) && !DATA.test(p) && !SW.test(p) && !lazyFiles.has(p));
  return { atLoad, first, cacheN, pills, errs, demand, notRun, mods, ctl, again, third, loadList, firstAsked, startJsCss, lazyN: lazyFiles.size };
}
const V = (v) => v.n + " req (" + v.js_css + " app js/css, " + v.data + " data, " + v.gzip_kb + " KB gzip, " + v.kb + " KB raw)";
const row = (name, r) => console.log("     " + name.padEnd(7) + "| first visit until load: " + V(r.atLoad) + "\n            | whole first visit: " + V(r.first) + ", worker cache " + r.cacheN + " entries, start js/css (not x-lazy) " + r.startJsCss.length + ", x-lazy files " + r.lazyN +
  "\n            | 2nd visit: " + V(r.again) + "\n            | 3rd visit: " + V(r.third));

(async () => {
  let cfg = "";
  try { cfg = await (await fetch(`http://127.0.0.1:${PORT}/config.js`)).text(); } catch (e) {}
  if (!/SUPABASE_URL/.test(cfg) || /wcdskpcevbhouvbytkhv/.test(cfg)) { console.log("FAIL the server on port " + PORT + " must serve the STAGING config.js (PN_TARGET=staging python3 tests/e2e/serve.py " + PORT + " docs)"); process.exit(1); }
  try { require.resolve("esbuild", { paths: [REPO] }); } catch (e) { console.log("FAIL esbuild is not installed (npm ci): the packed build cannot be made"); process.exit(1); }
  const A = build("packed", cfg, ["--bundle", "on"]), P = build("today", cfg, ["--bundle", "off"]);
  console.log("     builds: packed " + A.meta.version + " (" + A.meta.start_files + " start files, " + A.meta.start_gzip_kb + " KB gzip) · today " + P.meta.version + " (" + P.meta.start_files + " start files, " + P.meta.start_gzip_kb + " KB gzip)");
  await startServer();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // PACK_SWAP=1: judge TODAY's site with the same checks (proof that the checks fail on the old path; lane pack DONE.md)
    const swap = process.env.PACK_SWAP === "1";
    const a = await visit(browser, swap ? P : A), p = await visit(browser, swap ? A : P);
    if (swap) console.log("     PACK_SWAP=1: \"packed\" below is TODAY's site, \"today\" is the packed one");
    row("packed", a); row("today", p);
    if (process.env.PACK_JSON) fs.writeFileSync(process.env.PACK_JSON, JSON.stringify({ packed: a, today: p, meta: { packed: A.meta, today: P.meta } }, null, 1));
    /* P1 */
    ok("P1 packed first visit: <= 16 own scripts + stylesheets that are not x-lazy files (" + a.startJsCss.length + "; today " + p.startJsCss.length + ")", a.pills && a.startJsCss.length > 0 && a.startJsCss.length <= 16, a.startJsCss);
    ok("P1 (today) the site that is live today starts 150+ own scripts + stylesheets: this is what the switch removes", p.startJsCss.length >= 150, { n: p.startJsCss.length });
    /* P2 */
    ok("P2 2nd visit, packed: the worker controls the page; no app script / stylesheet comes from the network", a.ctl && a.again.ctl && a.again.js_css === 0, { ctl: a.ctl, ctl2: a.again.ctl, list: a.again.list });
    const own3 = a.third.list.filter((x) => !DATA.test(x) && !/\/index\.html$/.test(x) && !SW.test(x));
    ok("P2 3rd visit, packed: only the page, the worker update check (sw.js) and the data refresh go to the network (" + a.third.n + " requests)", a.third.ctl && own3.length === 0, own3);
    ok("P2 packed: the app runs in all 3 visits (pins), no page error", a.pills && a.again.pills && a.third.pills && a.errs.length === 0, { pills: [a.pills, a.again.pills, a.third.pills], errs: a.errs });
    /* P3 */
    ok("P3 packed first visit downloads less than today's site (" + a.first.gzip_kb + " vs " + p.first.gzip_kb + " KB gzip)", a.first.gzip_kb > 0 && a.first.gzip_kb < p.first.gzip_kb, { a: a.first.gzip_kb, p: p.first.gzip_kb });
    /* P4 */
    const askedDemand = a.demand.filter((f) => a.firstAsked.includes(f));
    ok("P4 x-lazy files with data-demand stay lazy in the packed site: the page does not ask for them (" + a.demand.join(", ") + ")", a.demand.length > 0 && askedDemand.length === 0, { askedDemand });
    ok("P4 every other x-lazy file ran (packed and today)", a.notRun.length === 0 && p.notRun.length === 0, { packed: a.notRun, today: p.notRun });
    const miss = p.mods.filter((k) => !a.mods.includes(k));
    ok("P4 the packed site has every module of today's site after the lazy files (" + p.mods.length + ")", p.mods.length > 50 && miss.length === 0, { miss });
  } finally {
    await browser.close(); srv.http && srv.http.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log("pack:", pass, "PASS", fail, "FAIL");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", String(e && e.stack || e).slice(0, 500)); process.exit(1); });
