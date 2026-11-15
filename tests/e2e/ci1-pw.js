// lane ci1: the LIVE BUILD (scripts/build-site.mjs = what .github/workflows/pages-bundle.yml deploys), in a real browser.
// usage: node ci1-pw.js <port>      <port> = any test server (tests/e2e/serve.py); only its staging /config.js is read.
// The test builds its own sites from TEMP COPIES of docs/ and serves them itself (like start1-pw.js). The repo is not changed.
//   A  = bundled build        B = bundled build with ONE changed source file (js/gpage.js)
//   P  = plain build (stamp only = the old branch deploy)        O = bundled the old way (--groups off: one bundle per run)
// Checks (each fails on the old path, see the note in the check):
//   C1 start requests: the bundled page loads <= 16 own scripts + stylesheets (the plain page: 150+)
//   C2 one changed file changes ONE bundle group + the small "last" group (old bundling: the 3 MB bundle)
//   C3 a phone that has build A and updates to B downloads only those changed bundles again (service worker, real update)
//   C4 window.PN_BUILD and the last bundle tag change with every release (pnlog.js / vitals.js read the version from that tag)
//   C5 the plain build = scripts/stamp.mjs on a copy (same VERSION): PAGES_BUNDLE off is the old site, byte for byte
//   C6 the Pages artifact tar holds .nojekyll and .well-known/assetlinks.json
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
const { mock } = require("./ds-helpers.js");
const CHROME = require("./env.js").CHROME;
const PORT = process.argv[2] || "8871";
const REPO = path.join(__dirname, "..", "..");
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 700))); c ? pass++ : fail++; };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pn-ci1-"));
const repoState = () => require("crypto").createHash("sha256").update(fs.readFileSync(path.join(REPO, "docs", "index.html"))).update(fs.readFileSync(path.join(REPO, "docs", "sw.js"))).digest("hex");
const REPO0 = repoState();

function source(tag, cfg, change) {   // a temp "repo root" with docs/ (staging config.js) for build-site.mjs --repo
  const root = path.join(TMP, "src-" + tag);
  fs.cpSync(path.join(REPO, "docs"), path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "config.js"), cfg);
  if (change) fs.appendFileSync(path.join(root, "docs", change), "\n;window.__ci1Build = " + JSON.stringify(tag) + ";\n");   // real code (a comment is minified away: the group would keep its hash)
  return root;
}
function build(tag, root, extra) {
  const out = path.join(TMP, "out-" + tag);
  const log = execFileSync("node", [path.join(REPO, "scripts", "build-site.mjs"), "--repo", root, "--out", out, "--layout", "docs", "--sha", "ci1-" + tag].concat(extra || []), { encoding: "utf8" });
  const meta = JSON.parse(fs.readFileSync(path.join(out, "build.json"), "utf8"));
  return { dir: out, ver: meta.version, meta, log, v: Object.fromEntries(meta.files.map((f) => [f.file, f])) };
}
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", png: "image/png",
  ico: "image/x-icon", svg: "image/svg+xml", woff2: "font/woff2", webmanifest: "application/manifest+json", jpg: "image/jpeg", webp: "image/webp" };
const srv = { root: "", counts: new Map(), port: 0 };
function startServer() {
  return new Promise((res) => {
    const s = http.createServer((req, rs) => {
      let p; try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { rs.writeHead(400); rs.end(); return; }
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(srv.root, p);
      if (f.indexOf(srv.root) !== 0) { rs.writeHead(403); rs.end(); return; }
      fs.readFile(f, (err, buf) => {
        if (err) { rs.writeHead(404, { "Content-Type": "text/plain" }); rs.end("404"); return; }
        srv.counts.set(p, (srv.counts.get(p) || 0) + 1);
        rs.writeHead(200, { "Content-Type": TYPES[path.extname(f).slice(1)] || "application/octet-stream", "Content-Length": buf.length, "Cache-Control": "max-age=600" });
        rs.end(buf);
      });
    });
    s.listen(0, "127.0.0.1", () => { srv.port = s.address().port; srv.http = s; res(); });
  });
}
const BASE = () => "http://127.0.0.1:" + srv.port + "/";
// own scripts + stylesheets the page asks for until the first pins are on the map
async function startFiles(browser, dir) {
  srv.root = dir;
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, locale: "sv-SE" });
  const page = await ctx.newPage();
  await mock(page);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
  const reqs = []; page.on("request", (q) => { if (q.url().startsWith(BASE()) && /^(script|stylesheet)$/.test(q.resourceType())) reqs.push(q.url().replace(BASE(), "").replace(/\?.*/, "")); });
  await page.goto(BASE());
  const pills = await page.waitForFunction(() => document.querySelectorAll(".pill").length > 0, null, { timeout: 45000 }).then(() => true, () => false);
  const n = reqs.length;
  const info = await page.evaluate(() => ({ build: window.PN_BUILD || "", last: ([].slice.call(document.querySelectorAll('script[src*="app.bundle"]')).pop() || { getAttribute() { return ""; } }).getAttribute("src"), partErr: (window.OLNU_BUNDLE_ERR || []).length }));
  await ctx.close();
  return { n, pills, errs, reqs: reqs.slice(0, n), ...info };
}
const cacheOf = (page, ver, ms) => page.evaluate(([v, t]) => new Promise((res) => {
  const t0 = Date.now();
  (function chk() {
    caches.open(v).then((c) => c.match("./index.html").then((hit) => {
      if (hit) return c.keys().then((rs) => res(rs.map((r) => new URL(r.url).pathname)));
      if (Date.now() - t0 > t) return res(null);
      setTimeout(chk, 300);
    }));
  })();
}), [ver, ms]);

(async () => {
  let cfg = "";
  try { cfg = await (await fetch(`http://127.0.0.1:${PORT}/config.js`)).text(); } catch (e) {}
  if (!/SUPABASE_URL/.test(cfg) || /wcdskpcevbhouvbytkhv/.test(cfg)) { console.log("FAIL the server on port " + PORT + " must serve the STAGING config.js (PN_TARGET=staging python3 tests/e2e/serve.py " + PORT + " docs)"); process.exit(1); }
  try { require.resolve("esbuild", { paths: [REPO] }); } catch (e) { console.log("FAIL esbuild is not installed (npm ci, or npm i --no-save esbuild@0.24.0 acorn@8.12.1): the live build cannot be made"); process.exit(1); }
  const CHANGED = "js/gpage.js";
  const rootA = source("A", cfg), rootB = source("B", cfg, CHANGED);
  const A = build("A", rootA, ["--bundle", "on", "--tar", path.join(TMP, "A.tar")]), B = build("B", rootB, ["--bundle", "on"]), P = build("P", rootA, ["--bundle", "off"]);
  console.log("     builds: A " + A.ver + " (" + A.meta.start_files + " start files, " + A.meta.start_gzip_kb + " KB gzip)  B " + B.ver + "  P " + P.ver + " (" + P.meta.start_files + " start files, " + P.meta.start_gzip_kb + " KB gzip)");
  await startServer();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    /* ---------- C1: start requests ---------- */
    const sa = await startFiles(browser, A.dir), sp = await startFiles(browser, P.dir);
    console.log("     start: bundled " + sa.n + " scripts + stylesheets, plain " + sp.n);
    ok("C1 the bundled page starts with <= 16 own scripts + stylesheets (the plain site: " + sp.n + ")", sa.pills && sa.n > 0 && sa.n <= 16, { n: sa.n, pills: sa.pills, reqs: sa.reqs });
    ok("C1 … and the plain build still needs 150+ (the old live path; this is what the switch removes)", sp.pills && sp.n >= 150, { n: sp.n, pills: sp.pills });
    ok("C1 the bundled start has no page error and no bundle part error", sa.errs.length === 0 && sa.partErr === 0, { errs: sa.errs, partErr: sa.partErr });

    /* ---------- C2: one changed file = one group + "last" ---------- */
    const changed = Object.keys(A.v).filter((f) => !B.v[f] || B.v[f].v !== A.v[f].v), kb = Math.round(changed.reduce((a, f) => a + B.v[f].gzip, 0) / 1024);
    const group = ([...fs.readFileSync(path.join(B.dir, "index.html"), "utf8").matchAll(/<script defer src="\.\/(js\/app\.bundle[-\w]*\.js)[^"]*" data-parts="([^"]*)"/g)]
      .find((m) => m[2].split(",").some((u) => u.replace(/^\.\//, "").replace(/\?.*/, "") === CHANGED)) || [])[1];
    console.log("     one changed file (" + CHANGED + "): new ?v= on " + changed.join(", ") + " = " + kb + " KB gzip of " + A.meta.start_gzip_kb);
    ok("C2 one changed source file gives a new ?v= to its bundle group and to the small last group only", changed.length === 2 && changed.includes(group) && changed.includes("js/app.bundle-last.js"), { changed, group });
    ok("C2 … an update for it costs < 250 KB gzip (all start files: " + A.meta.start_gzip_kb + " KB)", kb > 0 && kb < 250, { kb });
    const O = { a: path.join(TMP, "old-A"), b: path.join(TMP, "old-B") };
    for (const [d, r] of [[O.a, rootA], [O.b, rootB]]) { fs.cpSync(path.join(r, "docs"), d, { recursive: true }); execFileSync("node", [path.join(REPO, "scripts", "bundle.mjs"), d, "--stamp", "--groups", "off"], { stdio: "pipe" }); }
    const tags = (d) => Object.fromEntries([...fs.readFileSync(path.join(d, "index.html"), "utf8").matchAll(/<script defer src="\.\/(js\/app\.bundle[-\w]*\.js)\?v=([0-9a-f]{10})"/g)].map((m) => [m[1], m[2]]));
    const oa = tags(O.a), ob = tags(O.b), oc = Object.keys(oa).filter((f) => oa[f] !== ob[f]), okb = Math.round(oc.reduce((a, f) => a + require("zlib").gzipSync(fs.readFileSync(path.join(O.b, f)), { level: 9 }).length, 0) / 1024);
    ok("C2 (reference) the old bundling, one bundle per run, makes the same change cost " + okb + " KB gzip (3 x more or worse)", oc.length >= 1 && okb > 3 * kb, { oc, okb, kb });

    /* ---------- C4: PN_BUILD + the last bundle tag ---------- */
    const sb = await startFiles(browser, B.dir);
    ok("C4 window.PN_BUILD is set and changes with the release", /^[0-9a-f]{10}$/.test(sa.build) && /^[0-9a-f]{10}$/.test(sb.build) && sa.build !== sb.build && sa.build === A.meta.build, { a: sa.build, b: sb.build, meta: A.meta.build });
    ok("C4 the last bundle tag (pnlog.js / vitals.js read the app version from it) changes with the release", /app\.bundle-last\.js\?v=[0-9a-f]{10}$/.test(sa.last) && sa.last !== sb.last, { a: sa.last, b: sb.last });

    /* ---------- C3: a real update A → B downloads only the changed bundles ---------- */
    {
      srv.root = A.dir; srv.counts.clear();
      const ctx = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 390, height: 844 }, locale: "sv-SE" });
      const page = await ctx.newPage();
      await mock(page);
      await page.goto(BASE());
      const a = await cacheOf(page, A.ver, 90000);
      const inA = (a || []).filter((u) => /app\.bundle/.test(u));
      ok("C3 build A: the service worker precaches every bundle that the built index.html names (the list comes from the build)", !!a && inA.length === A.meta.files.filter((f) => /app\.bundle/.test(f.file)).length && a.length < 80, { n: a && a.length, inA });
      srv.root = B.dir; srv.counts.clear();
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()));
      const b = await cacheOf(page, B.ver, 90000);
      const got = [...srv.counts.keys()].filter((u) => /app\.bundle/.test(u)).sort(), want = changed.map((f) => "/" + f).sort();
      console.log("     update A → B: bundles downloaded again: " + got.join(", "));
      ok("C3 update to build B: only the changed bundles are downloaded again; the others are copied from the old cache", !!b && JSON.stringify(got) === JSON.stringify(want), { got, want, cacheB: b && b.length });
      const inB = (b || []).filter((u) => /app\.bundle/.test(u));
      ok("C3 … and the new version's cache is complete (every bundle + the page)", inB.length === inA.length && (b || []).includes("/index.html"), { inB: inB.length, inA: inA.length });
      await ctx.close();
    }

    /* ---------- C5 / C6: plain build = the old stamp; the artifact ---------- */
    const st = path.join(TMP, "stamp-only");
    fs.cpSync(path.join(rootA, "docs"), st, { recursive: true });
    execFileSync("node", [path.join(REPO, "scripts", "stamp.mjs"), st, "--write"], { stdio: "pipe" });
    const sv = (fs.readFileSync(path.join(st, "sw.js"), "utf8").match(/^var VERSION = "([^"]*)";/m) || [])[1];
    ok("C5 the plain build (PAGES_BUNDLE off) has the VERSION of scripts/stamp.mjs on a copy: the old site, same bytes", P.ver === sv && fs.readFileSync(path.join(P.dir, "index.html"), "utf8") === fs.readFileSync(path.join(st, "index.html"), "utf8"), { P: P.ver, stamp: sv });
    const tar = execFileSync("tar", ["-tf", path.join(TMP, "A.tar")], { encoding: "utf8", maxBuffer: 64 << 20 }).split("\n");
    ok("C6 the Pages artifact tar (same flags as upload-pages-artifact@v3) holds .nojekyll, .well-known/assetlinks.json, sw.js, build.json", ["./.nojekyll", "./.well-known/assetlinks.json", "./sw.js", "./build.json"].every((f) => tar.includes(f)), tar.filter((f) => /^\.\/\./.test(f)).slice(0, 8));
    ok("C6 the repo's docs/index.html and docs/sw.js were not touched by the builds", REPO0 === repoState(), {});
  } catch (e) {
    console.log("FAIL crash " + String(e && e.stack || e).slice(0, 700)); fail++;
  }
  await browser.close();
  srv.http.close();
  console.log("ci1:", pass, "PASS", fail, "FAIL");
  process.exit(fail ? 1 : 0);
})();
