#!/usr/bin/env node
// D1 motion tokens: find every animation / transition duration and easing in docs/ (CSS files, index.html, CSS text inside
// JS strings, el.style.transition = "...", el.animate(kf, { duration, easing })) and say if it uses the motion tokens.
//   node tests/quality/motion.mjs [repo]            inventory: counts per file + every raw value (exit 0)
//   node tests/quality/motion.mjs [repo] --check    exit 1 when a raw value is not in ALLOW (the rule in check.mjs too)
// Tokens: docs/pnds.css "ds10 motion" (DESIGN.md "Motion"). Only the token DEFINITIONS are exempt; every use is checked.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// ---- the token set (names). A var() of one of these, or a calc() that holds one, is a token value.
// Old names (--ds-t-*, --d-*, --ds-ease, --ease, --sm-*, --pn-dec ...) are aliases in pnds.css only: a use of one is raw.
export const DUR_TOKENS = /^--m-[1-8]$/;
export const EASE_TOKENS = /^--e-(std|in|out|spring|pop|io|lin)$/;
export const OLD = /^--(ds-t-[1-3]|d-[1-3]|sm-t-in|sm-in|sm-out|ds-ease|ease|ease-spring|pn-dec|pn-acc)$/;   // aliases: pnds.css only
export const LONG_MS = 1000;   // 1 s and more: a loop period or a scene (often in step with a JS timer), not a motion step
// Allowed raw values (real time / physics, not the UI scale). Key = file + "|" + a piece of the declaration text.
// Keep this list short: each line says why.
export const ALLOW = [
  ["docs/js/pnui.js", "duration: ms", "sheet drag release: a damped spring sampled at 60 Hz, duration = number of frames"],
  ["docs/js/app-ticker.js", "TICK_SPAN_S", "LIVE ticker belt: real-time speed in px per second"],
];
const TIME = /^[-+]?(\d*\.)?\d+(ms|s)$/i;
const EASE_KW = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i;
const EASE_FN = /^(cubic-bezier|steps|linear)\(/i;
const NOT_EASE = /^(none|infinite|alternate|alternate-reverse|reverse|normal|forwards|backwards|both|running|paused|all|initial|inherit|unset|revert)$/i;

const ms = (t) => { const m = /^([-+]?(?:\d*\.)?\d+)(ms|s)$/i.exec(t); return m ? +m[1] * (m[2].toLowerCase() === "s" ? 1000 : 1) : NaN; };
// split on a separator at paren depth 0
function splitTop(s, sep) {
  const out = []; let d = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") d++; else if (ch === ")") d--;
    if (d === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) { if (cur.trim() || sep !== " ") out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim() || (sep !== " " && out.length)) out.push(cur.trim());
  return out.filter((x) => sep !== " " || x);
}
const varNames = (t) => [...t.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
const isDurTok = (t) => varNames(t).some((n) => DUR_TOKENS.test(n));
const isEaseTok = (t) => varNames(t).some((n) => EASE_TOKENS.test(n));
const timeLike = (t) => TIME.test(t) || (/^(var|calc)\(/i.test(t) && (isDurTok(t) || /\d(ms|s)\b/.test(t) || /^var\(--[\w-]*(m-|t-|dur|ms|delay|time|d-)/i.test(t)));
const easeLike = (t) => EASE_KW.test(t) || EASE_FN.test(t) || (/^var\(/i.test(t) && (isEaseTok(t) || /^var\(--([\w-]*ease[\w-]*|e-[\w-]+|pn-dec|pn-acc|sm-in|sm-out)\b/.test(t)));

// classify one time / easing value. Returns null when fine, else a reason.
function judgeTime(t, local) {
  if (/^(var|calc)\(/i.test(t)) {
    if (isDurTok(t)) return null;
    const vs = varNames(t); if (vs.length && vs.every((n) => local && local.has(n))) return null;   // a local var: its definition is checked
    if (vs.some((n) => OLD.test(n))) return "old alias name in " + t;
    const raw = (t.match(/(\d*\.)?\d+(ms|s)\b/gi) || []).filter((x) => ms(x) > 1 && ms(x) < LONG_MS);   // e.g. var(--d,5s): set by js, long
    return raw.length ? "raw time in " + t : null;
  }
  const v = ms(t); if (!(v > 1)) return null;   // 0 / 1 ms = off (reduced motion)
  if (v >= LONG_MS) return null;                // loop period / scene time: free number (counted as "long")
  return "raw time " + t;
}
function judgeEase(t) { return isEaseTok(t) || /^steps\(|^step-(start|end)$/i.test(t) ? null : "raw easing " + t; }   // steps(): discrete, not a curve

// one declaration value. prop = animation | transition | *-duration | *-timing-function | *-delay
export function judgeDecl(prop, value, local) {
  const v = value.replace(/!important/i, "").trim(), res = [];
  if (!v || /^(none|initial|inherit|unset|revert)$/i.test(v)) return res;
  const layers = splitTop(v, ",");
  for (const L of layers) {
    if (/-duration$/.test(prop)) { const w = judgeTime(L, local); res.push({ kind: "duration", value: L, raw: w }); continue; }
    if (/-delay$/.test(prop)) { res.push({ kind: "delay", value: L, raw: null }); continue; }
    if (/-timing-function$/.test(prop)) { res.push({ kind: "easing", value: L, raw: judgeEase(L) }); continue; }
    const parts = splitTop(L, " ");
    const times = parts.filter(timeLike), eases = parts.filter((p) => !NOT_EASE.test(p) && easeLike(p));
    if (!times.length || /^none$/i.test(parts[0])) continue;                           // no duration = no motion
    const dur = times[0];
    res.push({ kind: "duration", value: dur, raw: judgeTime(dur, local) });
    if (times[1]) res.push({ kind: "delay", value: times[1], raw: null });
    const off = TIME.test(dur) && !(ms(dur) > 1);
    if (off) continue;
    if (eases.length) for (const e of eases) res.push({ kind: "easing", value: e, raw: judgeEase(e) });
    else res.push({ kind: "easing", value: "(default ease)", raw: "no easing (browser default ease)" });
  }
  return res;
}

const DECL = /(?<![-\w(])(animation|transition)(-duration|-timing-function|-delay)?\s*:\s*([^;{}"'`]+)/gi;
const CUSTOM = /(?<![-\w])(--[\w-]+)\s*:\s*([^;{}"'`]+)/g;
const lineAt = (s, i) => s.slice(0, i).split("\n").length;

// css text (a file, a <style>, or a JS string). base = line of the text start.
export function scanCssText(text, file, base = 1, local) {
  const out = [], css = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  for (const m of css.matchAll(DECL)) {
    const prop = (m[1] + (m[2] || "")).toLowerCase();
    for (const r of judgeDecl(prop, m[3], local)) out.push({ file, line: base + lineAt(css, m.index) - 1, prop, decl: m[0].trim().slice(0, 160), ...r });
  }
  // custom properties that hold a motion value (a local name for a raw time or curve) count as uses
  for (const m of css.matchAll(CUSTOM)) {
    const name = m[1], val = m[2].replace(/!important/i, "").trim();
    if (DUR_TOKENS.test(name) || EASE_TOKENS.test(name)) continue;   // token definitions: checked by the token block itself
    const isT = TIME.test(val) || (/^calc\(/.test(val) && /\d(ms|s)\b/.test(val)), isE = EASE_FN.test(val) || /^(ease|ease-in|ease-out|ease-in-out)$/.test(val);
    if (!isT && !isE && !(/^var\(/.test(val) && (isDurTok(val) || isEaseTok(val)))) continue;
    if (local) local.add(name);
    const raw = isT ? (/^calc\(/.test(val) ? judgeTime(val) : judgeTime(val)) : isE ? judgeEase(val) : null;
    out.push({ file, line: base + lineAt(css, m.index) - 1, prop: name, decl: m[0].trim().slice(0, 160), kind: isE ? "easing" : "duration", value: val, raw, custom: true });
  }
  return out;
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
const STYLE_PROP = { transition: "transition", animation: "animation", transitionDuration: "transition-duration", animationDuration: "animation-duration",
  transitionTimingFunction: "transition-timing-function", animationTimingFunction: "animation-timing-function", webkitTransition: "transition", webkitAnimation: "animation" };
const strOf = (n) => n && (n.type === "Literal" && typeof n.value === "string" ? n.value : n.type === "TemplateLiteral" ? n.quasis.map((q) => q.value.cooked).join("0ms") : null);
// the literal pieces of "a" + x + "b" (dynamic parts become 0ms: a number there is computed, not a raw value)
function concatStr(n) {
  if (!n) return null;
  if (n.type === "BinaryExpression" && n.operator === "+") { const a = concatStr(n.left), b = concatStr(n.right); return (a == null ? "0ms" : a) + (b == null ? "0ms" : b); }
  return strOf(n);
}
const branches = (n) => n && n.type === "ConditionalExpression" ? branches(n.consequent).concat(branches(n.alternate)) : [n];

export function scanJs(src, file, acorn, local) {
  let ast; const out = [];
  try { ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, allowHashBang: true, locations: true }); }
  catch (e) { ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true }); }
  walk(ast, (n) => {
    // CSS text in a string: "...{transition:opacity .2s ease}"
    if ((n.type === "Literal" && typeof n.value === "string") || n.type === "TemplateElement") {
      const s = n.type === "Literal" ? n.value : n.value.cooked || "";
      if (/(animation|transition)[\w-]*\s*:/i.test(s)) for (const r of scanCssText(s, file, n.loc.start.line, local)) out.push(r);
    }
    // el.style.transition = "transform .2s ease"; el.style.setProperty("transition", "...")
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && !n.left.computed && STYLE_PROP[n.left.property.name]) {
      for (const br of branches(n.right)) { const s = concatStr(br); if (s == null) continue;
        for (const r of judgeDecl(STYLE_PROP[n.left.property.name], s, local)) out.push({ file, line: n.loc.start.line, prop: "style." + n.left.property.name, decl: src.slice(n.start, n.end).slice(0, 160), ...r }); }
    }
    // el.animate(keyframes, { duration: 300, easing: "ease-out" }) / el.animate(kf, 800)
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed && n.callee.property.name === "animate" && n.arguments.length >= 2) {
      const o = n.arguments[1], decl = src.slice(n.start, n.end).replace(/\s+/g, " ").slice(0, 200), line = n.loc.start.line;
      if (o.type === "Literal" && typeof o.value === "number") out.push({ file, line, prop: "animate()", decl, kind: "duration", value: String(o.value), raw: o.value > 1 ? "raw time " + o.value : null });
      if (o.type === "ObjectExpression") {
        let hasE = false, hasD = false;
        for (const p of o.properties) {
          const k = p.key && (p.key.name || p.key.value);
          if (k === "duration") { hasD = true; const v = p.value; out.push({ file, line, prop: "animate()", decl, kind: "duration", value: src.slice(v.start, v.end), raw: v.type === "Literal" && typeof v.value === "number" && v.value > 1 ? "raw time " + v.value : null }); }
          if (k === "easing") { hasE = true; const v = p.value; out.push({ file, line, prop: "animate()", decl, kind: "easing", value: src.slice(v.start, v.end), raw: v.type === "Literal" ? "raw easing " + v.value : null }); }
        }
        if (hasD && !hasE) out.push({ file, line, prop: "animate()", decl, kind: "easing", value: "(default linear)", raw: "no easing (WAAPI default linear)" });
      }
    }
  });
  return out;
}

const allowOf = (r) => ALLOW.find(([f, piece]) => r.file === f && (r.decl.includes(piece) || r.value.includes(piece)));

export function loadAcorn(repo) {
  for (const p of [repo + "/node_modules/", process.cwd() + "/node_modules/", "/opt/node-tools/node_modules/"]) { try { return createRequire(p)("acorn"); } catch (e) {} }
  return null;
}
const ls = (repo, dir, ext) => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? ls(repo, dir + "/" + e.name, ext) : e.name.endsWith(ext) ? [dir + "/" + e.name] : []);

// the whole app. Returns every motion value found, each with raw = null (token / off / computed) or a reason, and allow.
export function scanRepo(repo, acorn) {
  const local = new Set(), out = [];
  const css = ls(repo, "docs", ".css").filter((f) => !f.startsWith("docs/docs/"));
  // standalone pages (privacy, delete, 404 ...) do not load pnds.css: no tokens there, not checked
  const html = fs.readdirSync(path.join(repo, "docs")).filter((f) => f.endsWith(".html") && fs.readFileSync(path.join(repo, "docs", f), "utf8").includes("pnds.css")).map((f) => "docs/" + f);
  const js = ["docs/app.js", ...ls(repo, "docs/js", ".js")].filter((f) => fs.existsSync(path.join(repo, f)));
  const rd = (f) => fs.readFileSync(path.join(repo, f), "utf8");
  // pass 1 collects local custom properties (names), pass 2 judges uses with them known
  for (let pass = 0; pass < 2; pass++) {
    out.length = 0;
    for (const f of css.concat(html)) out.push(...scanCssText(rd(f), f, 1, local));
    if (acorn) for (const f of js) out.push(...scanJs(rd(f), f, acorn, local));
  }
  for (const r of out) { const a = r.raw && allowOf(r); if (a) r.allow = a[2]; }
  return out;
}
export const bad = (rows) => rows.filter((r) => r.raw && !r.allow && r.kind !== "delay");

// ---- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), repo = path.resolve(argv.find((a) => !a.startsWith("--")) || ".");
  const acorn = loadAcorn(repo); if (!acorn) { console.error("acorn not found"); process.exit(2); }
  const rows = scanRepo(repo, acorn), b = bad(rows);
  if (argv.includes("--json")) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
  const decls = new Map();
  for (const r of rows) { if (r.kind === "delay") continue; const k = r.file + ":" + r.line + ":" + r.decl; const d = decls.get(k) || { file: r.file, raw: false }; d.raw = d.raw || !!(r.raw && !r.allow); decls.set(k, d); }
  const per = {};
  for (const d of decls.values()) { const p = (per[d.file] = per[d.file] || { tok: 0, raw: 0 }); d.raw ? p.raw++ : p.tok++; }
  const n = decls.size, nr = [...decls.values()].filter((d) => d.raw).length;
  console.log("motion: " + n + " declarations, " + (n - nr) + " use tokens (or off / computed), " + nr + " hold a raw value. Allowed raw: " + rows.filter((r) => r.allow).length);
  if (argv.includes("--files")) for (const [f, p] of Object.entries(per).sort((a, b) => b[1].raw - a[1].raw)) if (p.raw) console.log("  " + f.padEnd(28) + " token " + String(p.tok).padStart(3) + "  raw " + String(p.raw).padStart(3));
  if (argv.includes("--list") || argv.includes("--check")) for (const r of b) console.log("  " + r.file + ":" + r.line + "  " + r.raw + "   | " + r.decl);
  if (argv.includes("--check") && b.length) { console.log("motion: " + b.length + " raw values. Use the tokens (DESIGN.md Motion), or add a real-time case to ALLOW in tests/quality/motion.mjs."); process.exit(1); }
}
