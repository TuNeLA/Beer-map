// ci1: the ONE site build. The deploy workflow (.github/workflows/pages-bundle.yml), the CI gate shards and a local check all
// run this file, so "what I tested here" = "what goes live". The repo's docs/ is never changed: the work happens on a COPY.
//   node scripts/build-site.mjs --out <new dir> [--layout root|docs] [--bundle on|off] [--sha <commit>] [--tar <file>] [--repo <root>]
//     --layout root (default, = repo variable PAGES_LAYOUT unset): <out>/index.html + <out>/docs/ = the app (like the branch deploy)
//     --layout docs                                               : <out>/ = the app (after the pintsnow.com move)
//     --bundle on  (= PAGES_BUNDLE on): scripts/bundle.mjs --stamp (needs esbuild; acorn for the exact check)
//     --bundle off (anything else)    : scripts/stamp.mjs only (the same files as the old branch deploy + stamp bot)
//     --tar <file>: also write the Pages artifact tar the same way actions/upload-pages-artifact@v3 does (for a local look)
//   Checks (exit 1 = no deploy): the stamp matches the files, sw.js VERSION is not "dev", every bundle parses, every local file
//   that index.html names exists, the dotfiles are in the output (.nojekyll, docs/.well-known/ → Android app links).
//   Writes <app>/build.json (version, commit, mode, bundle sizes) and prints a summary. `app=<dir>` + `version=<v>` go to
//   $GITHUB_OUTPUT when set.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { stampSite, checkSite } from "./stamp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const die = (m) => { console.error("build-site FAILED: " + m); process.exit(1); };
const REPO = resolve(opt("--repo", join(HERE, "..")));
const OUT = opt("--out"), LAYOUT = opt("--layout", "") === "docs" ? "docs" : "root", BUNDLE = opt("--bundle", "") === "on";
const SHA = opt("--sha", "") || (spawnSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout || "").trim();
if (!OUT) die("usage: node scripts/build-site.mjs --out <new dir> [--layout root|docs] [--bundle on|off] [--sha <commit>] [--tar <file>]");
const out = resolve(OUT);
if (existsSync(out) && readdirSync(out).length) die(out + " is not empty (give a new folder; nothing is ever deleted here)");
if (out === join(REPO, "docs") || out.startsWith(join(REPO, "docs") + "/")) die("--out must not be inside the repo's docs/");

// 1. copy
mkdirSync(out, { recursive: true });
const APP = LAYOUT === "docs" ? out : join(out, "docs");
if (LAYOUT === "docs") cpSync(join(REPO, "docs"), out, { recursive: true });
else {
  cpSync(join(REPO, "docs"), APP, { recursive: true });
  if (existsSync(join(REPO, "index.html"))) copyFileSync(join(REPO, "index.html"), join(out, "index.html"));
}
writeFileSync(join(out, ".nojekyll"), "");   // an Actions deploy runs no Jekyll; the file keeps a later branch deploy the same

// 2. bundle + stamp, or stamp only
let info = null;
if (BUNDLE) {
  const r = spawnSync("node", [join(HERE, "bundle.mjs"), APP, "--stamp"], { encoding: "utf8", cwd: REPO });
  if (r.status !== 0) die("bundle.mjs: " + (r.stderr || r.stdout).slice(0, 1500));
  if (r.stderr.trim()) console.warn(r.stderr.trim());
  try { info = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) { die("bundle.mjs printed no JSON: " + r.stdout.slice(0, 300)); }
} else stampSite(APP);

// 3. checks
const bad = [...checkSite(APP)];
const html = readFileSync(join(APP, "index.html"), "utf8"), sw = readFileSync(join(APP, "sw.js"), "utf8");
const version = (sw.match(/^var VERSION = "([^"]*)";/m) || [])[1] || "";
if (!/^olnu-[0-9a-f]{10}$/.test(version)) bad.push("sw.js VERSION is " + JSON.stringify(version) + " (want olnu-<10 hex>)");
const refs = [...html.matchAll(/<(script|link)\b[^>]*?\s(?:src|href)="\.\/([^"?]+\.(?:js|css))(\?v=([0-9a-f]{10}))?"/g)].map((m) => ({ tag: m[0], kind: m[1], file: m[2], v: m[4] }));
const h10 = (b) => createHash("sha256").update(b).digest("hex").slice(0, 10);
for (const r of refs) {
  const f = join(APP, r.file);
  if (!existsSync(f)) { bad.push("index.html names a missing file: " + r.file); continue; }
  if (!r.v) bad.push("no ?v= on " + r.file);
  else if (h10(readFileSync(f)) !== r.v) bad.push("?v= of " + r.file + " is not the hash of the file (the service worker would download it twice)");
}
const start = refs.filter((r) => (r.kind === "script" && /\bdefer\b/.test(r.tag)) || (r.kind === "link" && /rel="stylesheet"/.test(r.tag)));
const bundles = start.filter((r) => /app\.bundle/.test(r.file));
if (BUNDLE) {
  if (!bundles.some((r) => r.kind === "script") || !bundles.some((r) => r.kind === "link")) bad.push("no js / css bundle in index.html");
  for (const r of bundles.filter((x) => x.kind === "script")) {
    const c = spawnSync("node", ["--check", join(APP, r.file)], { encoding: "utf8" });
    if (c.status !== 0) bad.push(r.file + " does not parse: " + c.stderr.slice(0, 200));
  }
  if (start.length > 20) bad.push("the bundled page still starts " + start.length + " local files (want <= 20)");
} else if (bundles.length) bad.push("--bundle off but index.html names bundles");
if (!existsSync(join(out, ".nojekyll"))) bad.push(".nojekyll is missing in the output");
if (existsSync(join(REPO, "docs", ".well-known"))) for (const n of readdirSync(join(REPO, "docs", ".well-known"))) if (!existsSync(join(APP, ".well-known", n))) bad.push(".well-known/" + n + " is missing in the output");
// the repo itself must be untouched (stamping the repo copy by mistake = the old merge conflict)
if (/\?v=[0-9a-f]{10}/.test(readFileSync(join(REPO, "docs", "index.html"), "utf8")) && process.env.PAGES_DEPLOY === "actions") bad.push("the repo's docs/index.html holds ?v= tags (PAGES_DEPLOY=actions wants a clean repo)");
if (bad.length) die("\n  " + bad.join("\n  "));

// 4. build.json (not in the site hash: scripts/stamp.mjs SKIP_FILE) + summary
const size = (f) => { const b = readFileSync(join(APP, f)); return { bytes: b.length, gzip: gzipSync(b, { level: 9 }).length }; };
const files = start.map((r) => ({ file: r.file, v: r.v, ...size(r.file) }));
const meta = { version, commit: SHA, mode: BUNDLE ? "bundled" : "plain", layout: LAYOUT, built: new Date().toISOString(), build: info ? info.build : "",
  start_files: files.length, start_gzip_kb: Math.round(files.reduce((a, f) => a + f.gzip, 0) / 1024), files };
writeFileSync(join(APP, "build.json"), JSON.stringify(meta, null, 1) + "\n");
const after = checkSite(APP); if (after.length) die("build.json changed the stamp: " + after.join("; "));

// 5. optional: the artifact tar, the same flags as actions/upload-pages-artifact@v3 (dotfiles stay; @v4 drops them, @v5 needs include-hidden-files)
const TAR = opt("--tar");
if (TAR) {
  const t = spawnSync("tar", ["--dereference", "--hard-dereference", "--directory", out, "-cf", resolve(TAR), "--exclude=.git", "--exclude=.github", "."], { encoding: "utf8" });
  if (t.status !== 0) die("tar: " + t.stderr);
  const list = spawnSync("tar", ["-tf", resolve(TAR)], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout.split("\n");
  const want = ["./.nojekyll", (LAYOUT === "docs" ? "./" : "./docs/") + ".well-known/assetlinks.json", (LAYOUT === "docs" ? "./" : "./docs/") + "sw.js"];
  const miss = want.filter((w) => !list.includes(w));
  if (miss.length) die("the artifact tar lacks: " + miss.join(", "));
  console.log("artifact tar: " + list.filter(Boolean).length + " entries, " + Math.round(statSync(resolve(TAR)).size / 1048576) + " MB, dotfiles in: " + want.join(" "));
}
console.log("build-site ok: " + meta.mode + ", layout " + LAYOUT + ", VERSION " + version + ", commit " + (SHA || "?").slice(0, 7));
console.log("start files: " + files.length + " local (" + meta.start_gzip_kb + " KB gzip)" + (info ? ", from " + info.scripts + " scripts + " + info.styles + " stylesheets, " + info.lazyMinified + " lazy files minified" : ""));
for (const f of files) console.log("  " + f.file.padEnd(30) + String(Math.round(f.bytes / 1024)).padStart(6) + " KB" + String(Math.round(f.gzip / 1024)).padStart(6) + " KB gzip  ?v=" + f.v);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "app=" + APP + "\nversion=" + version + "\n");
