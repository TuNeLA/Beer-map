// A1: the ONE stamper. The repo holds NO ?v= in docs/index.html and `var VERSION = "dev";` in docs/sw.js.
// The deploy (pages-bundle.yml, the beta build, strip-logging.py, bundle.mjs --stamp) runs this on a COPY of docs/.
//   node scripts/stamp.mjs <site dir> [--write]    stamp in place (default): every local ./x.js|css in index.html (also the data-parts
//                                                  lists) gets ?v=<sha256[:10] of the file>; sw.js VERSION = <prefix><sha256[:10] of the site>
//   node scripts/stamp.mjs <site dir> --check      exit 1 when a tag or VERSION is stale. A clean dir (no ?v=, VERSION "dev") passes,
//                                                  a stamped dir must match its files exactly (a mixed or half-stale dir fails)
//   node scripts/stamp.mjs <site dir> --strip      back to the clean repo state (no ?v=, VERSION "dev")
//   options: --prefix olnu-  (VERSION prefix; default: keep the one in sw.js, else olnu-. The beta uses olnu-b- / olnu-t-)   --suffix -store   --strict-clean (with --check: also fail on a stamped dir)
// The site hash leaves out data that changes without an app change (bars.json, places.json, places/, buildings/, buildings3d/) and
// sw.js's own VERSION line, and reads index.html with the ?v= removed, so stamping twice gives the same result.
// No dependencies: node:fs + node:crypto only (the workflows copy this file next to bundle.mjs).
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const h10 = (b) => createHash("sha256").update(b).digest("hex").slice(0, 10);
const strip = (u) => u.replace(/^\.\//, "").replace(/\?.*$/, "");
const RE_REF = /((?:src|href)="\.\/)([^"?]+\.(?:js|css))(\?[^"]*)?"/g;   // any local js/css reference (script, link, preload, x-lazy-css)
const RE_PARTS = /data-parts="([^"]*)"/g;
const RE_VER = /^var VERSION = "([^"]*)";/m;
const SKIP_FILE = new Set(["sw.js", "index.html", "bars.json", "places.json"]);
const SKIP_DIR = ["places/", "buildings/", "buildings3d/"];

function walk(dir, out = []) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n), st = statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = (site, p) => relative(site, p).split(sep).join("/");

// index.html with every ?v= taken off the local js/css refs and the data-parts lists
export function unstampHtml(html) {
  return html.replace(RE_REF, (all, a, f) => a + f + '"')
    .replace(RE_PARTS, (all, list) => 'data-parts="' + list.split(",").map((u) => "./" + strip(u)).join(",") + '"');
}
export function siteHash(site) {
  const all = createHash("sha256");
  for (const p of walk(site)) {
    const r = rel(site, p);
    if (SKIP_FILE.has(r) || SKIP_DIR.some((d) => r.startsWith(d))) continue;
    all.update(r + "\0").update(readFileSync(p));
  }
  const idx = join(site, "index.html"), sw = join(site, "sw.js");
  if (existsSync(idx)) all.update("index.html\0" + unstampHtml(readFileSync(idx, "utf8")));
  if (existsSync(sw)) all.update("sw.js\0" + readFileSync(sw, "utf8").replace(RE_VER, ""));
  return all.digest("hex").slice(0, 10);
}
export function stampHtml(site, html) {
  let missing = [], n = 0;
  const v = (f) => { const p = join(site, f); if (existsSync(p)) { n++; return "?v=" + h10(readFileSync(p)); } missing.push(f); return ""; };
  const out = html.replace(RE_REF, (all, a, f) => a + f + v(f) + '"')
    .replace(RE_PARTS, (all, list) => 'data-parts="' + list.split(",").map((u) => { const f = strip(u); return "./" + f + (existsSync(join(site, f)) ? "?v=" + h10(readFileSync(join(site, f))) : ""); }).join(",") + '"');
  return { html: out, stamped: n, missing };
}
// state of a dir: "clean" (nothing stamped), "stamped" or "mixed"
export function state(site) {
  const html = readFileSync(join(site, "index.html"), "utf8");
  const refs = [...html.matchAll(RE_REF)].filter((m) => m[3]);
  const sw = existsSync(join(site, "sw.js")) ? (readFileSync(join(site, "sw.js"), "utf8").match(RE_VER) || [])[1] : "dev";
  const dev = sw === "dev";
  if (!refs.length && dev) return "clean";
  return "stamped";
}
// prefix: default = the one already in sw.js ("olnu-b-" beta, "olnu-t-" test build; keep it when a later step stamps again), else "olnu-"
export function stampSite(site, { prefix, suffix = "", write = true } = {}) {
  const idx = join(site, "index.html"), swp = join(site, "sw.js");
  const html0 = readFileSync(idx, "utf8");
  const hash = siteHash(site);
  const r = stampHtml(site, html0);
  let sw0 = existsSync(swp) ? readFileSync(swp, "utf8") : null;
  if (prefix === undefined) prefix = ((sw0 && (sw0.match(RE_VER) || [])[1] || "").match(/^olnu-[a-z]-/) || ["olnu-"])[0];
  const version = prefix + hash + suffix;
  const sw1 = sw0 === null ? null : sw0.replace(RE_VER, () => 'var VERSION = "' + version + '";');
  if (write) { if (r.html !== html0) writeFileSync(idx, r.html); if (sw1 !== null && sw1 !== sw0) writeFileSync(swp, sw1); }
  return { version, hash, stamped: r.stamped, missing: r.missing, html: r.html, sw: sw1, html0, sw0 };
}
export function stripSite(site) {
  const idx = join(site, "index.html"), swp = join(site, "sw.js");
  const h = readFileSync(idx, "utf8"), u = unstampHtml(h);
  if (u !== h) writeFileSync(idx, u);
  if (existsSync(swp)) { const s = readFileSync(swp, "utf8"), n = s.replace(RE_VER, 'var VERSION = "dev";'); if (n !== s) writeFileSync(swp, n); }
}
// returns a list of problems ([] = ok)
export function checkSite(site, { strictClean = false } = {}) {
  const st = state(site), bad = [];
  if (st === "clean") return bad;
  if (strictClean) { bad.push("not clean: index.html has ?v= or sw.js VERSION is not \"dev\" (run: node scripts/stamp.mjs " + site + " --strip)"); return bad; }
  const r = stampSite(site, { write: false });
  if (r.missing.length) bad.push("index.html names files that are missing: " + r.missing.join(", "));
  const a = [...r.html0.matchAll(RE_REF)], b = [...r.html.matchAll(RE_REF)];
  a.forEach((m, i) => { if ((m[3] || "") !== (b[i][3] || "")) bad.push("stale ?v= on " + m[2] + " (" + (m[3] || "none") + ", want " + (b[i][3] || "none") + ")"); });
  const have = (r.sw0 && (r.sw0.match(RE_VER) || [])[1]) || "";
  if (!have.includes(r.hash)) bad.push("sw.js VERSION " + JSON.stringify(have) + " does not hold the site hash " + r.hash);
  const pa = [...r.html0.matchAll(RE_PARTS)], pb = [...r.html.matchAll(RE_PARTS)];
  pa.forEach((m, i) => { if (m[1] !== pb[i][1]) bad.push("stale data-parts list"); });
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const site = args.find((a, i) => !a.startsWith("--") && !["--prefix", "--suffix"].includes(args[i - 1]));
  if (!site || !existsSync(join(site, "index.html"))) { console.error("usage: node scripts/stamp.mjs <site dir> [--write | --check [--strict-clean] | --strip] [--prefix olnu-] [--suffix -store]"); process.exit(2); }
  if (args.includes("--strip")) { stripSite(site); console.log("stamp: " + site + " is clean (no ?v=, VERSION dev)"); }
  else if (args.includes("--check")) {
    const bad = checkSite(site, { strictClean: args.includes("--strict-clean") });
    if (bad.length) { console.error("stamp --check FAILED:\n  " + bad.join("\n  ")); process.exit(1); }
    console.log("stamp --check ok (" + state(site) + ")");
  } else {
    const r = stampSite(site, { prefix: opt("--prefix"), suffix: opt("--suffix") || "" });
    if (r.missing.length) console.warn("stamp: missing files named in index.html: " + r.missing.join(", "));
    console.log("stamp: " + r.stamped + " refs, VERSION " + r.version);
  }
}
