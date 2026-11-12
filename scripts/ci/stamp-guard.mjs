// A1 / A17 guard (CI): node scripts/ci/stamp-guard.mjs [docs dir=docs] [--strict] [--online]
//  1. the repo copy: clean (no ?v=, sw.js VERSION "dev") -- or, while the site still deploys from the branch and the stamp-version
//     bot still commits stamps (repo variable PAGES_DEPLOY != "actions"), consistent. --strict (or env PAGES_DEPLOY=actions) = clean only.
//  2. a temp COPY is stamped with scripts/stamp.mjs: VERSION changed from "dev", every local js/css in index.html has ?v=<10 hex>,
//     then bundled (scripts/bundle.mjs --stamp, needs esbuild) and every data-parts entry has ?v=<10 hex> too.
//  3. every CDN <script> / <link rel=stylesheet|preload> in index.html has integrity="sha384-..." + crossorigin; the CSP names exact CDN
//     paths (no bare host). --online: fetch each CDN file and compare its sha384 with the attribute.
import { cpSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stampSite, checkSite, state } from "../stamp.mjs";

const args = process.argv.slice(2);
const DOCS = args.find((a) => !a.startsWith("--")) || "docs";
const STRICT = args.includes("--strict") || process.env.PAGES_DEPLOY === "actions";
const HERE = dirname(fileURLToPath(import.meta.url)), SCRIPTS = join(HERE, "..");
const bad = [], note = [];
const html = readFileSync(join(DOCS, "index.html"), "utf8");

// 1. repo state
for (const p of checkSite(DOCS, { strictClean: STRICT })) bad.push("repo docs/: " + p);
note.push("repo docs/ is " + state(DOCS) + (STRICT ? " (strict)" : ""));

// 2. stamp a temp copy (+ bundle)
const tmp = mkdtempSync(join(tmpdir(), "pn-stamp-"));
cpSync(DOCS, join(tmp, "docs"), { recursive: true });
const T = join(tmp, "docs");
const r = stampSite(T);
if (r.version === "dev" || !/^olnu-[0-9a-f]{10}$/.test(r.version)) bad.push("stamp.mjs gave VERSION " + r.version);
if (!/^var VERSION = "olnu-[0-9a-f]{10}";/m.test(readFileSync(join(T, "sw.js"), "utf8"))) bad.push("sw.js VERSION was not written in the copy");
if (r.missing.length) bad.push("index.html names missing files: " + r.missing.join(", "));
const refs = [...readFileSync(join(T, "index.html"), "utf8").matchAll(/(?:src|href)="\.\/([^"?]+\.(?:js|css))(\?v=[0-9a-f]{10})?"/g)];
const un = refs.filter((m) => !m[2]).map((m) => m[1]);
if (un.length) bad.push("stamped copy: local files without ?v=<10 hex>: " + un.join(", "));
if (!refs.length) bad.push("stamped copy: no local js/css refs found (regex broke?)");
if (checkSite(T).length) bad.push("stamped copy fails its own --check: " + checkSite(T).join("; "));
note.push("stamped copy: " + refs.length + " refs, VERSION " + r.version);

const B = join(tmp, "bundled");
cpSync(DOCS, B, { recursive: true });
const bun = spawnSync("node", [join(SCRIPTS, "bundle.mjs"), B, "--stamp"], { encoding: "utf8", cwd: join(SCRIPTS, "..") });
if (bun.status !== 0) {
  if (/Cannot find (package|module) '(esbuild|acorn)'|ERR_MODULE_NOT_FOUND/.test(bun.stderr + bun.stdout)) note.push("bundle step SKIPPED (esbuild not installed)");
  else bad.push("bundle.mjs --stamp failed: " + (bun.stderr || bun.stdout).slice(0, 400));
} else {
  const bh = readFileSync(join(B, "index.html"), "utf8");
  const parts = [...bh.matchAll(/data-parts="([^"]*)"/g)].flatMap((m) => m[1].split(","));
  const noHash = parts.filter((u) => !/\?v=[0-9a-f]{10}$/.test(u));
  if (!parts.length) bad.push("bundled copy: no data-parts lists");
  if (noHash.length) bad.push("bundled copy: data-parts entries without ?v=: " + noHash.slice(0, 5).join(", "));
  const bun2 = [...bh.matchAll(/(?:src|href)="\.\/([^"?]+\.(?:js|css))(\?v=[0-9a-f]{10})?"/g)].filter((m) => !m[2]).map((m) => m[1]);
  if (bun2.length) bad.push("bundled copy: refs without ?v=: " + bun2.join(", "));
  if (checkSite(B).length) bad.push("bundled copy fails --check: " + checkSite(B).join("; "));
  if (!/^var VERSION = "olnu-[0-9a-f]{10}";/m.test(readFileSync(join(B, "sw.js"), "utf8"))) bad.push("bundled copy: sw.js VERSION not stamped");
  note.push("bundled copy: " + parts.length + " data-parts entries stamped");
}

// 3. SRI + CSP on the repo index.html
const cdn = [];
for (const m of html.matchAll(/<(script|link)\b[^>]*>/g)) {
  const tag = m[0], u = (tag.match(/\b(?:src|href)="(https?:\/\/[^"]+)"/) || [])[1];
  if (!u) continue;
  const rel = (tag.match(/\brel="([^"]+)"/) || [])[1] || "";
  if (m[1] === "link" && !/^(stylesheet|preload|modulepreload)$/.test(rel)) continue;   // preconnect / dns-prefetch carry no code
  cdn.push({ u, tag });
  const sri = (tag.match(/\bintegrity="(sha384-[A-Za-z0-9+/=]+)"/) || [])[1];
  if (!sri) bad.push("CDN tag without integrity=sha384: " + u);
  if (!/\bcrossorigin\b/.test(tag)) bad.push("CDN tag without crossorigin: " + u);
  cdn[cdn.length - 1].sri = sri;
}
if (!cdn.length) bad.push("no CDN tags found in index.html (regex broke?)");
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || "";
const ss = ((csp.match(/script-src ([^;]*)/) || [])[1] || "").split(/\s+/).filter((x) => x.startsWith("http"));
if (!ss.length) bad.push("CSP has no script-src https sources (or no CSP)");
for (const s of ss) if (!/^https:\/\/[^/]+\/.+\/$/.test(s)) bad.push("CSP script-src is not an exact path: " + s);
for (const c of cdn.filter((x) => /<script/.test(x.tag))) if (!ss.some((s) => c.u.startsWith(s))) bad.push("CSP does not allow " + c.u);
note.push(cdn.length + " CDN tags, " + ss.length + " CSP paths");
if (args.includes("--online")) {
  for (const c of cdn) {
    if (!c.sri) continue;
    try {
      const b = Buffer.from(await (await fetch(c.u)).arrayBuffer());
      const got = "sha384-" + createHash("sha384").update(b).digest("base64");
      if (got !== c.sri) bad.push("SRI mismatch for " + c.u + " (file " + got + ")");
    } catch (e) { bad.push("could not fetch " + c.u + ": " + e.message); }
  }
  note.push("SRI verified online");
}
console.log(note.join("\n"));
if (bad.length) { console.error("stamp-guard FAILED:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("stamp-guard ok");
