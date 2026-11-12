#!/usr/bin/env node
// CODE QUALITY GUARD layer 1. Node only, no browser. Baseline-based: today's code passes, only NEW problems fail.
//   node tests/quality/check.mjs [repo]            run all rules, write tests/quality/report.json, exit 1 on a new problem
//   node tests/quality/check.mjs [repo] --init      write a fresh baseline from today's tree (first setup only)
//   node tests/quality/check.mjs [repo] --shrink    lower/remove baseline entries that are fixed. Never adds or raises.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const repo = path.resolve(argv.find((a) => !a.startsWith("--")) || ".");
const MODE = argv.includes("--init") ? "init" : argv.includes("--shrink") ? "shrink" : "check";
const t0 = Date.now();
let acorn = null;
try { acorn = await import("acorn"); } catch (e) {}
if (!acorn) for (const p of [repo + "/node_modules/", process.cwd() + "/node_modules/", "/opt/node-tools/node_modules/"]) { try { acorn = createRequire(p)("acorn"); break; } catch (e) {} }
if (!acorn) { console.error("acorn not found (npm ci, or npm i --no-save acorn@8.12.1)"); process.exit(2); }

const LIM = { appLines: 400, moduleLines: 1200, moduleWarn: 900, fnLines: 150, dupLines: 30 };
const BASE_FILE = path.join(repo, "tests/quality/quality-baseline.json");
const rd = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");
const ls = (dir, ext) => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? ls(dir + "/" + e.name, ext) : e.name.endsWith(ext) ? [dir + "/" + e.name] : []);
const jsFiles = ["docs/app.js", ...ls("docs/js", ".js")].filter((f) => fs.existsSync(path.join(repo, f)));
const cssFiles = ls("docs", ".css").filter((f) => !f.startsWith("docs/docs/"));
const TOKEN_CSS = ["docs/pnds.css", "docs/ds.css"]; // token files: raw hex allowed here (DESIGN.md)

// ---- parse every js file once
const AST = {}, SRC = {}, parseErr = [];
for (const f of jsFiles) {
  const src = (SRC[f] = rd(f));
  try { AST[f] = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, allowHashBang: true, locations: true }); }
  catch (e) { try { AST[f] = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true }); } catch (e2) { parseErr.push(f + ": " + e.message); } }
}
function walk(node, fn, parent) {
  if (!node || typeof node.type !== "string") return;
  fn(node, parent);
  for (const k in node) {
    if (k === "loc") continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) { if (c && typeof c.type === "string") walk(c, fn, node); }
    else if (v && typeof v.type === "string") walk(v, fn, node);
  }
}
const lineCount = (s) => (s.match(/\n/g) || []).length + (s.endsWith("\n") || !s.length ? 0 : 1);

// ---- facts: each rule yields a map key -> number (or 0/1 for presence). "bad" = key not in baseline or value grew.
const facts = {
  fileSize: {}, functions: {}, windowGlobals: {}, appFunctions: {}, duplicates: {}, unusedExports: {}, emoji: {}, rawHex: {},
};
const warns = [];

// size
for (const f of jsFiles) {
  const n = lineCount(SRC[f]);
  const lim = f === "docs/app.js" ? LIM.appLines : LIM.moduleLines;
  if (n > lim) facts.fileSize[f] = n;
  else if (n > LIM.moduleWarn && f !== "docs/app.js") warns.push(f + " has " + n + " lines (warn at " + LIM.moduleWarn + ", limit " + LIM.moduleLines + ")");
}
// functions + window globals + app.js feature functions + PN exports
const fnName = (n, p, src) => {
  if (n.id && n.id.name) return n.id.name;
  if (p && p.type === "VariableDeclarator" && p.id.name) return p.id.name;
  if (p && (p.type === "Property" || p.type === "MethodDefinition" || p.type === "PropertyDefinition") && p.key) return p.key.name || String(p.key.value);
  if (p && p.type === "AssignmentExpression") return src.slice(p.left.start, p.left.end).replace(/\s+/g, "").slice(0, 60);
  return "anon";
};
// module wrapper(s): top-level `(function () { ... })()`, `(() => {...})()`, `!function(){}()`, `(function(){}).call(this)`
const wrapperOf = (ast) => {
  const out = new Set();
  for (const s of ast.body) {
    let e = s.type === "ExpressionStatement" ? s.expression : null;
    if (e && e.type === "UnaryExpression") e = e.argument;
    if (!e || e.type !== "CallExpression") continue;
    let c = e.callee;
    if (c.type === "MemberExpression" && /^(call|apply)$/.test(c.property.name || "")) c = c.object;
    if (c.type === "FunctionExpression" || c.type === "ArrowFunctionExpression") out.add(c);
  }
  return out;
};
const exportsDef = {}; // name -> count of definition sites
for (const f of jsFiles) {
  const ast = AST[f]; if (!ast) continue; const src = SRC[f];
  const wrap = wrapperOf(ast);
  walk(ast, (n, p) => {
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type)) {
      if (wrap.has(n)) return; // top-level IIFE wrapper = the module itself, not a function; functions inside it are still measured
      const len = n.loc.end.line - n.loc.start.line + 1;
      if (len > LIM.fnLines) { const k = f + "::" + fnName(n, p, src); facts.functions[k] = Math.max(facts.functions[k] || 0, len); }
    }
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && n.left.object.type === "Identifier") {
      const o = n.left.object.name, pr = n.left.computed ? (n.left.property.type === "Literal" ? String(n.left.property.value) : null) : n.left.property.name;
      if (!pr) return;
      if (o === "window" && pr !== "PN") { facts.windowGlobals[pr] = 1; exportsDef[pr] = (exportsDef[pr] || 0) + 1; }
      if (o === "PN") exportsDef[pr] = (exportsDef[pr] || 0) + 1;
    }
  });
}
// app.js: feature functions directly in the top level or in the top IIFE body. Pure PN forwarding stubs are wiring.
{
  const ast = AST["docs/app.js"], src = SRC["docs/app.js"];
  const stub = (n) => /^\{\s*return\s+PN\.[\w$]+\.apply\(/.test(src.slice(n.body.start, n.body.end));
  const scan = (body) => { for (const s of body) if (s.type === "FunctionDeclaration" && !stub(s)) facts.appFunctions[s.id.name] = 1; };
  if (ast) {
    scan(ast.body);
    for (const s of ast.body) {
      const e = s.type === "ExpressionStatement" ? s.expression : null;
      const c = e && e.type === "CallExpression" ? e.callee : null;
      const fn = c && (c.type === "FunctionExpression" || c.type === "ArrowFunctionExpression") ? c : c && c.type === "MemberExpression" && c.object.type === "FunctionExpression" ? c.object : null;
      if (fn && fn.body.type === "BlockStatement") scan(fn.body.body);
    }
  }
}
// unused exports: PN.x / window.X assigned but the word never appears anywhere else (docs js/html, tests)
{
  const hay = [];
  for (const f of jsFiles) hay.push(SRC[f]);
  for (const f of ls("docs", ".html").concat(ls("tests", ".js"), ls("tests", ".mjs"))) hay.push(rd(f));
  const all = hay.join("\n");
  for (const name in exportsDef) {
    if (!/^[\w$]+$/.test(name)) continue;
    const m = all.match(new RegExp("(?<![\\w$])" + name.replace(/\$/g, "\\$") + "(?![\\w$])", "g"));
    if ((m ? m.length : 0) <= exportsDef[name]) facts.unusedExports[name] = 1;
  }
}
// emoji in user-facing strings (string literals + template text, comments excluded)
const EMO = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
for (const f of jsFiles) {
  if (!AST[f]) continue; let c = 0;
  walk(AST[f], (n) => {
    if (n.type === "Literal" && typeof n.value === "string" && EMO.test(n.value)) c++;
    else if (n.type === "TemplateElement" && EMO.test(n.value.cooked || n.value.raw)) c++;
  });
  if (c) facts.emoji[f] = c;
}
// raw hex colours in CSS outside token files (custom property definitions "--x: #abc" are tokens, allowed)
for (const f of cssFiles) {
  if (TOKEN_CSS.includes(f)) continue;
  const css = rd(f).replace(/\/\*[\s\S]*?\*\//g, "");
  let c = 0;
  for (const b of css.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of b[1].split(";")) {
      if (/^\s*--[\w-]+\s*:/.test(decl)) continue;
      const v = decl.replace(/url\([^)]*\)/g, "");
      const m = v.match(/(?<![\w&\\])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g);
      if (m) c += m.length;
    }
  }
  if (c) facts.rawHex[f] = c;
}
// duplicate code: runs of > 30 identical normalised lines in 2 places. Key = file pair, value = matching windows.
{
  const W = LIM.dupLines + 1, lines = {}, byHash = new Map();
  for (const f of jsFiles) {
    const arr = [];
    SRC[f].split("\n").forEach((ln, i) => {
      const s = ln.trim().replace(/\s+/g, " ");
      if (s.length < 6 || /^(\/\/|\/\*|\*)/.test(s) || /^[)}\];,]+$/.test(s)) return;
      arr.push(s);
    });
    lines[f] = arr;
    for (let i = 0; i + W <= arr.length; i++) {
      const h = crypto.createHash("md5").update(arr.slice(i, i + W).join("\n")).digest("hex").slice(0, 12);
      let l = byHash.get(h); if (!l) byHash.set(h, (l = []));
      if (l.length < 6) l.push([f, i]);
    }
  }
  for (const l of byHash.values()) {
    for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) {
      if (l[a][0] === l[b][0] && Math.abs(l[a][1] - l[b][1]) < W) continue;
      const k = [l[a][0], l[b][0]].sort().join(" | ");
      facts.duplicates[k] = (facts.duplicates[k] || 0) + 1;
    }
  }
}
// structure: split-header guard (parts talk via PN)
let splitOut = "skipped (no scripts/split/move.mjs)", splitOk = true;
if (fs.existsSync(path.join(repo, "scripts/split/move.mjs"))) {
  const r = spawnSync(process.execPath, ["scripts/split/move.mjs", ".", "--check"], { cwd: repo, encoding: "utf8" });
  splitOk = r.status === 0; splitOut = ((r.stdout || "") + (r.stderr || "")).trim().split("\n")[0];
}

// ---- baseline
const RULES = {
  fileSize: "file size limit (app.js 400, module 1200 lines)",
  functions: "function size limit (150 lines)",
  windowGlobals: "no new window.* globals except PN",
  appFunctions: "app.js only wires (no new feature functions)",
  duplicates: "no new copy block > 30 lines (per file pair)",
  unusedExports: "no new unused PN.* / window.* export",
  emoji: "no new emoji in user-facing strings (docs/js)",
  rawHex: "no new raw hex colour in CSS outside token files",
};
if (MODE === "init") {
  const out = { _doc: "Baseline = today's problems. It may only shrink: CI fails on a new entry or a bigger value. See tests/quality/README.md.", limits: LIM, rules: {} };
  for (const r in RULES) { out.rules[r] = {}; for (const k of Object.keys(facts[r]).sort()) out.rules[r][k] = { value: facts[r][k], reason: "legacy: present on 12 Nov 2026, fix when the file is touched" }; }
  fs.mkdirSync(path.dirname(BASE_FILE), { recursive: true });
  fs.writeFileSync(BASE_FILE, JSON.stringify(out, null, 1) + "\n");
  console.log("baseline written: " + Object.entries(RULES).map(([r]) => r + "=" + Object.keys(facts[r]).length).join(" "));
  process.exit(0);
}
const base = JSON.parse(fs.readFileSync(BASE_FILE, "utf8"));
const fails = [], shrinkable = [], counts = {};
for (const r in RULES) {
  const b = (base.rules && base.rules[r]) || {};
  counts[r] = { now: Object.keys(facts[r]).length, baseline: Object.keys(b).length, newOrGrown: 0 };
  for (const k in facts[r]) {
    if (!b[k]) { fails.push([r, k, "NEW (" + facts[r][k] + ")"]); counts[r].newOrGrown++; }
    else if (facts[r][k] > b[k].value) { fails.push([r, k, "GREW " + b[k].value + " -> " + facts[r][k]]); counts[r].newOrGrown++; }
    else if (facts[r][k] < b[k].value) shrinkable.push([r, k]);
  }
  for (const k in b) if (!(k in facts[r])) shrinkable.push([r, k]);
}
if (!splitOk) fails.push(["structure", "scripts/split/move.mjs --check", splitOut]);
for (const e of parseErr) fails.push(["parse", e, "file does not parse"]);

if (MODE === "shrink") {
  let n = 0;
  for (const [r, k] of shrinkable) {
    if (!(k in facts[r])) delete base.rules[r][k]; else base.rules[r][k].value = facts[r][k];
    n++;
  }
  fs.writeFileSync(BASE_FILE, JSON.stringify(base, null, 1) + "\n");
  console.log("baseline shrunk: " + n + " entries lowered/removed");
  process.exit(0);
}

const report = {
  ok: fails.length === 0, seconds: +((Date.now() - t0) / 1000).toFixed(1), files: jsFiles.length + cssFiles.length,
  splitCheck: splitOut, counts, fails: fails.map(([rule, key, why]) => ({ rule, key, why })), warns, shrinkable: shrinkable.length,
};
fs.mkdirSync(path.join(repo, "tests/quality"), { recursive: true });
fs.writeFileSync(path.join(repo, "tests/quality/report.json"), JSON.stringify(report, null, 1) + "\n");
const L = ["QUALITY GUARD layer 1: " + (report.ok ? "PASS" : "FAIL") + " (" + report.seconds + " s, " + report.files + " files)"];
for (const r in RULES) L.push("  " + r.padEnd(14) + " now " + String(counts[r].now).padStart(4) + "  baseline " + String(counts[r].baseline).padStart(4) + "  new/grown " + counts[r].newOrGrown);
L.push("  split headers: " + splitOut + " | warnings: " + warns.length + " | fixable (run --shrink): " + shrinkable.length);
console.log(L.join("\n"));
if (fails.length) {
  console.log("\nNEW PROBLEMS:");
  for (const [r, k, why] of fails.slice(0, 60)) console.log("  [" + r + "] " + k + " - " + why + "  (rule: " + (RULES[r] || r) + ")");
}
for (const w of warns) console.log("  warn: " + w);
process.exit(fails.length ? 1 : 0);
