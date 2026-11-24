// E8 (lane i18n, 24 Nov 2026): inventory of the Swedish texts in the app code that do NOT go through the language switch.
// A Swedish string literal (scripts/i18n/svdetect.js) counts as COVERED when it has an English twin next to it:
//   - inside an `sv:` property of an object that also has an `en:` property (I18N.add({sv, en}), S = {sv: {...}, en: {...}})
//   - the 1st argument of a 2-argument call L("sv", "en") (any callee: L, T, tl, L1, I18N.L ...), or of a call whose 2nd
//     argument is not Swedish (the module's own pair helper)
//   - a branch of `cond ? a : b` where cond reads the language (sv(), en(), lang, I18N.lang, isSv ...)
//   - an array [sv, en] of exactly 2 strings where the 2nd is not Swedish (TX = { k: ["sv", "en"] } tables)
//   - a twin list: X = [Swedish …] when the same file has X_EN = [English …] (mapart WORDS / WORDS_EN)
// CSS value tokens (var(--x), cubic-bezier(), calc()) are removed first: "var" is also a Swedish word.
// Everything else = BYPASS (the English user sees Swedish). Not counted: comments, console.* / Error texts, object keys,
// "sv"/"en" dictionaries' keys, the dialect pack files (Swedish only on purpose), stats*.html files (owner panel).
// Usage: node scripts/i18n/inventory.mjs [--json] [--file docs/js/x.js] [--write-baseline]   (default: a per-file table + coverage %)
// The guard: tests/unit/i18n.test.mjs fails when a file gets MORE bypass texts than tests/unit/fixtures/i18n-baseline.json.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const acorn = require("acorn");
const { svWords } = require("./svdetect.js");

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
export const BASELINE = path.join(ROOT, "tests", "unit", "fixtures", "i18n-baseline.json");
const SKIP_FILE = /(^|\/)(dialekt-packs\/|dialekt\.js$)/;   // Swedish dialect packs: Swedish only on purpose (E8: hidden in English)
const LANG_TEST = /\b(sv|en|isSv|isEn|lang|svLang|EN|SV)\b|I18N|\.lang\b|"en"|"sv"/;

export function files() {
  const dir = path.join(ROOT, "docs", "js"), out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) out.push(p); } };
  walk(dir); out.push(path.join(ROOT, "docs", "app.js"));
  return out.map((f) => path.relative(ROOT, f)).filter((f) => !SKIP_FILE.test(f)).sort();
}
// CSS value tokens inside JS strings (motion / colour tokens): never text for people
// HTML attribute names + class/data/id values ("bl-ta", "bl-av") are markup, not text (coordinator 24 Nov: fixC false positive).
const MARKUP_ATTR = /\b(?:class|id|data-[\w-]+|maxlength|type|role|for|name)\s*=\s*\\?["'][^"'\\]*\\?["']?/g;
const CSS_TOKEN = /var\(--[\w-]+(?:\s*,[^()]*(?:\([^()]*\))?[^()]*)?\)|cubic-bezier\([^)]*\)|calc\([^)]*\)/g;
// CSS text inside JS (a style sheet string): "a{b:c}" / "x:y;z:w"
function isCss(s) { return /[a-z-]+\s*:\s*[^;{}]+;|\{[^}]*:[^}]*\}/.test(s) && !/[.!?]\s+[A-ZÅÄÖ]/.test(s); }
function keyName(p) { return p && p.key ? (p.key.type === "Identifier" ? p.key.name : p.key.value) : null; }
function objHas(o, k) { return o && o.type === "ObjectExpression" && o.properties.some((p) => keyName(p) === k); }
function strOf(n) { return n && n.type === "Literal" && typeof n.value === "string" ? n.value : n && n.type === "TemplateLiteral" ? n.quasis.map((q) => q.value.cooked || "").join(" ") : null; }
function calleeName(c) { const x = c.callee; return x.type === "Identifier" ? x.name : x.type === "MemberExpression" ? (x.object.name || (x.object.property && x.object.property.name) || "") + "." + (x.property.name || "") : ""; }

// scan one file: [{ line, text, covered, why }]
export function scanFile(rel) { return scanSource(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
export function scanSource(src) {
  let ast; try { ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "script", locations: true, allowHashBang: true }); } catch (e) { return [{ line: 0, text: "PARSE ERROR " + e.message, covered: false, why: "parse" }]; }
  const out = [], stack = [];
  // twin lists: WORDS = [...Swedish] next to WORDS_EN = [...English] (the code picks one by language)
  const twins = new Set([...src.matchAll(/\b([A-Za-z][\w$]*?)_?EN\s*=/g)].map((m) => m[1]).filter((n) => new RegExp("\\b" + n + "\\s*=").test(src)));
  const visit = (n, parent, key) => {
    if (!n || typeof n.type !== "string") return;
    stack.push({ n, key });
    const s = n.type === "Literal" ? (typeof n.value === "string" ? n.value : null) : n.type === "TemplateElement" ? (n.value.cooked || "") : null;
    if (s != null && !(parent && parent.type === "Property" && key === "key")) {
      const w = svWords(s.replace(CSS_TOKEN, " ").replace(MARKUP_ATTR, " "));   // var(--x) etc. are CSS, not the Swedish word "var"
      if (w.length && !/^[a-z0-9_.:-]*[-_.:][a-z0-9_.:-]*$/.test(s) && !isCss(s)) { const why = cover(stack); out.push({ line: n.loc.start.line, text: s.slice(0, 120), covered: !!why && why !== "skip", why: why || "", skip: why === "skip" }); }
    }
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && visit(c, n, k)); else if (v && typeof v.type === "string") visit(v, n, k);
    }
    stack.pop();
  };
  const cover = (st) => {
    for (let i = st.length - 2; i >= 0; i--) {
      const a = st[i].n, child = st[i + 1];
      if (a.type === "CallExpression") {
        const nm = calleeName(a);
        if (/^console\.|^(Error|TypeError)$|\.(querySelector|querySelectorAll|getItem|setItem|removeItem|matches|closest)$/.test(nm)) return "skip";
        if (child.key === "arguments") {
          const idx = a.arguments.indexOf(child.n);
          if (idx === 0 && a.arguments.length >= 2) {
            const s2 = strOf(a.arguments[1]);
            if (s2 == null || !svWords(s2).length) return "pair:" + nm;
          }
          if (idx === 1 && a.arguments.length >= 2 && /^(L|L1|T|tl|tr|LL|tx|lt|I18N\.L|I\.L)$/.test(nm)) return "pair:" + nm;   // the 2nd half of a pair (should be English)
        }
      }
      if (a.type === "BinaryExpression" && /^[!=]==?$/.test(a.operator)) return "skip";   // a compare: a key, not a text
      if (a.type === "SwitchCase" && child.key === "test") return "skip";
      if (a.type === "NewExpression" && a.callee && /Error$/.test(a.callee.name || "")) return "skip";
      if (a.type === "ConditionalExpression" && child.key !== "test" && LANG_TEST.test(srcOf(a.test))) return "cond";
      if (a.type === "LogicalExpression" && LANG_TEST.test(srcOf(a.left)) && child.key === "right") return "cond";
      if (a.type === "ArrayExpression" && a.elements.length === 2 && a.elements[0] === child.n) { const s2 = strOf(a.elements[1]); if (s2 != null && !svWords(s2).length) return "pair:[]"; }
      if (a.type === "Property" && keyName(a) === "sv") { const o = st[i - 1] && st[i - 1].n; if (objHas(o, "en")) return "dict"; }
      if (a.type === "Property" && keyName(a) === "en") return "dict-en";
      if (a.type === "VariableDeclarator" && a.id && twins.has(a.id.name)) return "twin";
    }
    return null;
  };
  const srcOf = (n) => src.slice(n.start, n.end);
  visit(ast, null, null);
  return out;
}

export function inventory() {
  const per = {};
  let cov = 0, byp = 0;
  for (const f of files()) {
    const list = scanFile(f).filter((x) => !x.skip);
    const b = list.filter((x) => !x.covered);
    cov += list.length - b.length; byp += b.length;
    if (list.length) per[f] = { covered: list.length - b.length, bypass: b.length, items: b };
  }
  return { per, covered: cov, bypass: byp, pct: Math.round(1000 * cov / Math.max(1, cov + byp)) / 10 };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const a = process.argv.slice(2), one = a.indexOf("--file") >= 0 ? a[a.indexOf("--file") + 1] : null;
  if (one) { for (const x of scanFile(one)) if (!x.covered && !x.skip) console.log(x.line + ": " + JSON.stringify(x.text)); process.exit(0); }
  const r = inventory();
  if (a.includes("--write-baseline")) {   // only after you MOVED texts into I18N (the number per file may only go down)
    const base = {}; for (const [f, v] of Object.entries(r.per)) if (v.bypass) base[f] = v.bypass;
    fs.writeFileSync(BASELINE, JSON.stringify({ _note: "E8: Swedish texts per file that do not go through the language switch (scripts/i18n/inventory.mjs). Only shrink it.", bypass: base }, null, 1) + "\n");
    console.log("wrote " + path.relative(ROOT, BASELINE)); process.exit(0);
  }
  if (a.includes("--json")) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  const rows = Object.entries(r.per).sort((x, y) => y[1].bypass - x[1].bypass);
  for (const [f, v] of rows) console.log(String(v.bypass).padStart(5) + " bypass " + String(v.covered).padStart(5) + " covered  " + f);
  console.log(`\nSwedish texts: ${r.covered + r.bypass} · through the switch: ${r.covered} (${r.pct}%) · bypass: ${r.bypass}`);
}
