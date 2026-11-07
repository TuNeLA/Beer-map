// ⚡ SPEED #10: bundle + minify the app for the GitHub Pages deploy (used by .github/workflows/pages-bundle.yml.disabled).
// node scripts/bundle.mjs <site dir>   (works IN PLACE on a copy of docs/ — never on the repo's docs/ itself)
// - every <script defer src="./…"> in index.html, in document order, is joined into ONE file js/app.bundle.js and minified
//   (deferred scripts run in document order after parsing, so one deferred bundle in the same place = the same order);
//   the IIFE files only talk through window globals, so joining them changes nothing. Each part is wrapped in try/catch
//   exactly like separate <script> tags: one file that throws does not stop the rest.
// - text/x-lazy scripts (boot.js loads them on demand) stay separate files, each minified in place.
// - CSS: every <link rel=stylesheet href="./…"> is joined into css/app.bundle.css (same order) and minified.
// - CDN scripts / styles stay as they are. index.html gets the new tags; the old files stay on the site (old pages).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { transform } from "esbuild";

const SITE = process.argv[2];
if (!SITE) { console.error("usage: node scripts/bundle.mjs <site dir>"); process.exit(1); }
const idxPath = join(SITE, "index.html");
let html = readFileSync(idxPath, "utf8");
const strip = (u) => u.replace(/^\.\//, "").replace(/\?.*$/, "");

// ---- scripts: each run of consecutive local deferred scripts → one bundle (a CDN script between them keeps its place) ----
const reAll = /<script defer src="([^"]+)"><\/script>\n?/g;
const tags = []; let m;
while ((m = reAll.exec(html))) tags.push({ all: m[0], src: m[1], local: /^\.\/[^?]+\.js(\?.*)?$/.test(m[1]) });
const runs = []; let cur = null;
for (const t of tags) { if (t.local) { if (!cur) runs.push(cur = []); cur.push(t); } else cur = null; }
if (!runs.length) { console.error("no local deferred scripts found"); process.exit(1); }
let raw = 0, outKB = 0, nParts = 0;
mkdirSync(join(SITE, "js"), { recursive: true });
for (let i = 0; i < runs.length; i++) {
  let js = "";
  for (const t of runs[i]) {
    const src = readFileSync(join(SITE, strip(t.src)), "utf8"); raw += src.length; nParts++;
    js += `\n/* ${strip(t.src)} */\ntry {\n${src}\n} catch (e) { try { console.error("olnu bundle: ${strip(t.src)}", e); } catch (x) {} }\n`;
  }
  const name = "js/app.bundle" + (runs.length > 1 ? "-" + (i + 1) : "") + ".js";
  const out = await transform(js, { loader: "js", minify: true, target: "es2017", legalComments: "none" });
  writeFileSync(join(SITE, name), out.code); outKB += out.code.length / 1024;
  runs[i].forEach((t, k) => { html = html.replace(t.all, k === 0 ? '<script defer src="./' + name + '"></script>\n' : ""); });
}
const parts = { length: nParts }, outJs = { code: { length: outKB * 1024 } };

// ---- lazy scripts: minify each in place ----
const reLazy = /<script type="text\/x-lazy"[^>]*src="(\.\/[^"]+\.js)(?:\?[^"]*)?"/g;
let lazyN = 0;
while ((m = reLazy.exec(html))) {
  const f = join(SITE, strip(m[1]));
  const r = await transform(readFileSync(f, "utf8"), { loader: "js", minify: true, target: "es2017", legalComments: "none" });
  writeFileSync(f, r.code); lazyN++;
}

// ---- styles ----
const reCss = /<link rel="stylesheet" href="(\.\/[^"]+\.css)(?:\?[^"]*)?">\n?/g;
const cssParts = []; let cssFirst = -1;
while ((m = reCss.exec(html))) { if (cssFirst < 0) cssFirst = m.index; cssParts.push(m[1]); }
if (cssParts.length) {
  const css = cssParts.map((p) => `/* ${strip(p)} */\n` + readFileSync(join(SITE, strip(p)), "utf8")).join("\n");
  const outCss = await transform(css, { loader: "css", minify: true });
  mkdirSync(join(SITE, "css"), { recursive: true });
  writeFileSync(join(SITE, "css/app.bundle.css"), outCss.code);
  html = html.replace(reCss, (all, href, off) => (off === cssFirst ? '<link rel="stylesheet" href="./css/app.bundle.css">\n' : ""));
}
writeFileSync(idxPath, html);
console.log(JSON.stringify({ scripts: parts.length, jsRawKB: Math.round(raw / 1024), jsBundleKB: Math.round(outJs.code.length / 1024), lazyMinified: lazyN, styles: cssParts.length }));
