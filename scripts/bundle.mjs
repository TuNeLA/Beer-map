// ⚡ SPEED #10 / T-25: bundle + minify the app for the GitHub Pages deploy (.github/workflows/pages-bundle.yml) and the beta.
// node scripts/bundle.mjs <site dir> [--stamp]   (works IN PLACE on a COPY of docs/ — never on the repo's docs/ itself)
// - every <script defer src="./…"> in index.html, in document order, is joined into one file per run (a CDN script between two
//   local scripts ends a run, so the order stays the same: js/app.bundle-1.js, CDN, js/app.bundle-2.js …) and minified.
//   Deferred scripts run in document order after parsing, so one deferred bundle in the same place = the same order.
//   ci1 GROUPS: a run is cut into named groups (js/app.bundle-<name>.js) at the files in GROUPS below. The cuts follow the
//   document order, so the run order never changes. Why: a phone downloads a bundle again only when its ?v= hash changed
//   (sw.js copies files with the same hash from the old cache), so a fix in one file costs one group, not the whole app.
//   The last group ("last" = app.js) also gets `window.PN_BUILD = "<hash of the whole source site>"`: the last bundle tag
//   changes with every release (pnlog.js / vitals.js read the app version from it) and stays tiny.
//   The IIFE files only talk through window globals (scripts/bundle-check.sh checks: no top-level let/const/class/function).
//   Each part is wrapped in try/catch like separate <script> tags: one file that throws does not stop the rest; the error is
//   thrown again on a timer, so window "error" listeners (pnlog crash log, knas) still see it.
// - KEEP files stay their own <script> (left-T25): config.js holds the server address; the test server (tests/e2e/serve.py)
//   and the beta staging build (pintsnow-beta transform.py) rewrite that one file. A small file, one extra request.
// - text/x-lazy scripts (boot.js and the modules load them on demand) stay separate files, each minified in place.
// - CSS: every <link rel=stylesheet href="./…"> is joined into css/app.bundle.css (same order) and minified.
//   rel="x-lazy-css" links (loaded later by boot.js / the modules) stay separate files.
// - CDN scripts / styles stay as they are. index.html gets the new tags; the single files stay on the site (unbundle.js
//   loads them from the tag's data-parts if a bundle fails to load).
// - --stamp (A1): runs scripts/stamp.mjs (the ONE stamper, must sit next to this file) on the finished site: every local js/css in
//   index.html (also the data-parts lists) gets ?v=<sha256[:10] of the file>; sw.js VERSION = olnu-<hash of the whole site, bundles
//   included>, so a phone never mixes an old bundle with a new page. The repo itself holds no ?v= (scripts/ci/stamp-guard.mjs).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { transform } from "esbuild";

const args = process.argv.slice(2);
const SITE = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--groups");
const STAMP = args.includes("--stamp");
if (!SITE) { console.error("usage: node scripts/bundle.mjs <site dir> [--stamp] [--groups off]"); process.exit(1); }
const idxPath = join(SITE, "index.html");
let html = readFileSync(idxPath, "utf8");
if (/js\/app\.bundle[-\w]*\.js/.test(html)) { console.error("index.html is already bundled"); process.exit(1); }
const strip = (u) => u.replace(/^\.\//, "").replace(/\?.*$/, "");
const KEEP = new Set(["config.js"]);
// ci1: group name -> the file that STARTS the group (document order; a file that is not in index.html = that cut is skipped
// with a warning, the build still works). A run that starts with another file gets the name g<n>. --groups off = one bundle per run.
export const GROUPS = [
  ["boot", "js/upd0.js"],            // before the Mapbox CDN tag: update flow, PN, logging, warm start
  ["mbx", "js/mbx.js"],              // the Leaflet-like shim over Mapbox GL
  ["base", "js/icons.js"],           // texts (i18n), util, bars, push, fx
  ["social", "js/news.js"],          // news, medals, social, games, after
  ["fun", "js/delight-content.js"],  // delight, gang, crew, film, events
  ["more", "js/delight-more-content.js"],   // near, forfest, group page, party, inbox, dm, invite
  ["map", "js/barea.js"],            // basemap, glmap, zones, places, ride
  ["people", "js/account.js"],       // account, profile, avatar, unlocks
  ["ui", "js/pnmove.js"],            // pnui, icons, pnds, bold, x8
  ["app", "js/app-core.js"],         // the app parts (docs/js/app-*.js)
  ["last", "app.js"],                // boot file + PN_BUILD (changes every release, a few KB)
];
const GROUPS_ON = !(args.includes("--groups") && args[args.indexOf("--groups") + 1] === "off");
const MIN = { loader: "js", minify: true, target: "es2017", legalComments: "none" };

// ---- scripts: each run of consecutive local deferred scripts → one bundle (a CDN or KEEP script between them keeps its place) ----
const reAll = /<script defer src="([^"]+)"[^>]*><\/script>\n?/g;   // cln08: any attributes (a CDN tag with crossorigin ends a run)
const tags = []; let m;
while ((m = reAll.exec(html))) tags.push({ all: m[0], src: m[1], local: /^\.\/[^?]+\.js(\?.*)?$/.test(m[1]) && !KEEP.has(strip(m[1])) });
// Each part runs inside try { } in the bundle. That is the same as its own <script> only if the file has no top-level
// let / const / class / function (they would stop being globals) and no top-level "use strict", document.currentScript,
// import or export. A file that breaks this rule stops the build (fix the file: wrap it in an IIFE like the others).
let acorn = null; try { acorn = await import("acorn"); } catch (e) {}
function partProblems(src) {
  const bad = [];
  if (/\bdocument\.currentScript\b/.test(src)) bad.push("document.currentScript");
  if (acorn) {
    let ast; try { ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script" }); } catch (e) { return ["does not parse as a classic script: " + e.message]; }
    for (const st of ast.body) {
      if (st.type === "VariableDeclaration" && st.kind !== "var") bad.push("top-level " + st.kind);
      else if (st.type === "ClassDeclaration" || st.type === "FunctionDeclaration") bad.push("top-level " + (st.type === "ClassDeclaration" ? "class " : "function ") + (st.id && st.id.name));
      else if (st.type === "ExpressionStatement" && st.directive === "use strict") bad.push('top-level "use strict"');
    }
  } else {   // no acorn: a line-start check (the app's files indent everything inside their IIFE)
    const m = src.match(/^(?:let|const|class|function|async\s+function)\b[^\n]{0,40}/gm); if (m) bad.push(...m.map((x) => "top-level " + x));
    if (/^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use strict["']/.test(src)) bad.push('top-level "use strict"');
    if (/^(?:import|export)\b/m.test(src)) bad.push("import / export");
  }
  return bad;
}
const problems = [];
for (const t of tags) if (t.local) { const b = partProblems(readFileSync(join(SITE, strip(t.src)), "utf8")); if (b.length) problems.push(strip(t.src) + ": " + b.join(", ")); }
if (problems.length) { console.error("bundle.mjs: these files cannot be joined safely:\n  " + problems.join("\n  ")); process.exit(1); }

const runs = []; let cur = null;
const cutAt = new Map(GROUPS_ON ? GROUPS.map(([n, f]) => [f, n]) : []), cutSeen = new Set();
for (const t of tags) {
  if (!t.local) { cur = null; continue; }
  const cut = cutAt.get(strip(t.src));
  if (cut) cutSeen.add(cut);
  if (!cur || cut) { runs.push(cur = []); cur.name = cut || null; }
  cur.push(t);
}
if (!runs.length) { console.error("no local deferred scripts found"); process.exit(1); }
const cutMiss = GROUPS_ON ? GROUPS.filter(([n]) => !cutSeen.has(n)).map(([n, f]) => n + " (" + f + ")") : [];
if (cutMiss.length) console.warn("bundle.mjs: group start files not found in index.html (cut skipped): " + cutMiss.join(", "));
runs.forEach((r, i) => { r.file = "js/app.bundle" + (GROUPS_ON ? "-" + (r.name || "g" + (i + 1)) : runs.length > 1 ? "-" + (i + 1) : "") + ".js"; });
// PN_BUILD: the hash of the whole source site (before any file is written), so it changes with every release
let build = "";
if (GROUPS_ON) { try { build = (await import("./stamp.mjs")).siteHash(SITE); } catch (e) { build = ""; } }
let raw = 0, outKB = 0, nParts = 0;
const outFiles = [], groups = [];
mkdirSync(join(SITE, "js"), { recursive: true });
// one tiny helper per bundle (the bundles may load in any order; the first one that runs defines it)
const HELP = 'var __olnuBE=window.__olnuBE||(window.__olnuBE=function(f,e){try{console.error("olnu bundle: "+f,e)}catch(x){}' +
  'window.OLNU_BUNDLE_ERR=(window.OLNU_BUNDLE_ERR||[]).concat(f);setTimeout(function(){throw e},0)});\n';
for (let i = 0; i < runs.length; i++) {
  let js = HELP, rawG = 0;
  if (build && i === runs.length - 1) js += "window.PN_BUILD=" + JSON.stringify(build) + ";\n";
  for (const t of runs[i]) {
    const f = strip(t.src);
    const src = readFileSync(join(SITE, f), "utf8"); raw += src.length; rawG += src.length; nParts++;
    js += `\n/* ${f} */\ntry {\n${src}\n} catch (e) { __olnuBE(${JSON.stringify(f)}, e); }\n`;
  }
  const name = runs[i].file;
  const out = await transform(js, MIN);
  writeFileSync(join(SITE, name), out.code); outKB += out.code.length / 1024; outFiles.push(name);
  groups.push({ file: name, parts: runs[i].length, rawKB: Math.round(rawG / 1024), kb: Math.round(out.code.length / 1024) });
  // cln08: data-parts = the single files (js/unbundle.js loads them if this bundle fails to load)
  const dp = runs[i].map((t) => t.src).join(",");
  runs[i].forEach((t, k) => { html = html.replace(t.all, k === 0 ? (i === 0 ? '<script defer src="./js/unbundle.js"></script>\n' : "") + '<script defer src="./' + name + '" data-parts="' + dp + '"></script>\n' : ""); });
}

// ---- lazy scripts: minify each in place ----
const reLazy = /<script type="text\/x-lazy"[^>]*src="(\.\/[^"]+\.js)(?:\?[^"]*)?"/g;
let lazyN = 0;
while ((m = reLazy.exec(html))) {
  const f = join(SITE, strip(m[1]));
  const r = await transform(readFileSync(f, "utf8"), MIN);
  writeFileSync(f, r.code); lazyN++; outFiles.push(strip(m[1]));
}

// ---- styles ----
const reCss = /<link rel="stylesheet" href="(\.\/[^"]+\.css)(?:\?[^"]*)?">\n?/g;
const cssParts = []; let cssFirst = -1;
while ((m = reCss.exec(html))) { if (cssFirst < 0) cssFirst = m.index; cssParts.push(m[1]); }
let cssKB = 0, cssRaw = 0;
if (cssParts.length) {
  const css = cssParts.map((p) => { const s = readFileSync(join(SITE, strip(p)), "utf8"); cssRaw += s.length; return `/* ${strip(p)} */\n` + s; }).join("\n");
  const outCss = await transform(css, { loader: "css", minify: true });
  mkdirSync(join(SITE, "css"), { recursive: true });
  writeFileSync(join(SITE, "css/app.bundle.css"), outCss.code); cssKB = outCss.code.length / 1024; outFiles.push("css/app.bundle.css");
  html = html.replace(reCss, (all, href, off) => (off === cssFirst ? '<link rel="stylesheet" href="./css/app.bundle.css" data-parts="' + cssParts.join(",") + '">\n' : ""));
}

let stamped = 0;
writeFileSync(idxPath, html);
// ---- stamp (A1): after index.html is written; stamp.mjs reads the finished site ----
if (STAMP) { const { stampSite } = await import("./stamp.mjs"); stamped = stampSite(SITE).stamped; }
console.log(JSON.stringify({ scripts: nParts, bundles: runs.length, jsRawKB: Math.round(raw / 1024), jsBundleKB: Math.round(outKB), lazyMinified: lazyN,
  styles: cssParts.length, cssRawKB: Math.round(cssRaw / 1024), cssBundleKB: Math.round(cssKB), kept: [...KEEP], stamped, build, groups }));
