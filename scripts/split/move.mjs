#!/usr/bin/env node
// W2 app.js split — move tool (SPLIT-SPEC 4.2). Move only: items are cut verbatim (with the comments above them) and pasted
// into docs/js/app-<part>.js in app.js order. The only text changes: "x" -> "PN.s.x" for shared state (1.4), and the
// generated blocks (<split:imports>, <split:core>, "// <split:put/>" lines) + the part <script> tags in index.html.
// usage:  node scripts/split/move.mjs <repo> scripts/split/steps/step-<n>.json    apply step n (idempotent: a 2nd run changes nothing)
//         node scripts/split/move.mjs <repo> --regen                              rewrite only the generated blocks + index.html tags
//         node scripts/split/move.mjs <repo> --check                              exit 1 if a generated block or tag is out of date
import fs from "node:fs";
import path from "node:path";
import * as L from "./lib.mjs";

const args = process.argv.slice(2);
const repo = path.resolve(args.find((a) => !a.startsWith("--") && !a.endsWith(".json")) || ".");
const mode = args.includes("--regen") ? "regen" : args.includes("--check") ? "check" : "move";
const stepFile = args.find((a) => a.endsWith(".json"));
if (mode === "move" && !stepFile) { console.error("usage: move.mjs <repo> <step.json> | <repo> --regen | <repo> --check"); process.exit(2); }
const rd = (rel) => { const p = path.join(repo, rel); return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; };
const plan = L.readPlan();
const A = L.loadApp((part) => rd(L.relOf(part)));
const log = (s) => console.log(s);

function isSimple(n) {
  if (!n) return false;
  if (n.type === "Literal") return !n.regex;
  if (n.type === "ArrayExpression") return n.elements.length === 0;
  if (n.type === "ObjectExpression") return n.properties.length === 0;
  if (n.type === "UnaryExpression") return n.operator === "-" && n.argument.type === "Literal" && typeof n.argument.value === "number";
  return false;
}
const lineStarts = (text) => { const o = [0]; for (let i = 0; i < text.length; i++) if (text[i] === "\n") o.push(i + 1); return o; };

// var x -> PN.s.x in every file (scope-aware), its "var" goes: a literal start value moves into the PN.s literal (app-core.js),
// any other start value stays at the old place as "PN.s.x = <start>;".
function toState(x, why) {
  if (A.fields.some((f) => f.name === x)) return false;
  for (const f of Object.values(A.files)) if (f.items.some((it) => it.kind === "svar" && it.field === x)) return false;
  const o = A.owner[x];
  if (!o) { log("  WARN PN.s." + x + ": no top-level var " + x + " found (skipped)"); return false; }
  if (o.item.kind !== "var") throw new Error(x + " is a function, not a var");
  const st = o.item.node, k = st.declarations.findIndex((d) => d.id.name === x), d = st.declarations[k];
  const E = {};
  for (const f of Object.values(A.files)) {
    const R = L.refsOf(f)[x]; if (!R) continue;
    if (f.part !== o.file && f.items.some((it) => it.names.includes(x))) continue;
    E[f.part] = R.map((r) => (r.shorthand ? { start: r.parent.start, end: r.parent.end, text: x + ": PN.s." + x } : { start: r.node.start, end: r.node.end, text: "PN.s." + x }));
  }
  const D = A.files[o.file], text = D.text; (E[o.file] = E[o.file] || []);
  if (isSimple(d.init)) {
    let comment = "";
    if (st.declarations.length === 1) {
      if (D.items.filter((it) => it.grp === o.item.grp).length > 1 || o.item.sL !== o.item.eL) throw new Error("var " + x + ": not alone on its line");
      const after = D.P.lines[o.item.eL - 1].slice(st.loc.end.column);
      comment = after.trim() ? after.replace(/\s+$/, "") : "";
      const ls = lineStarts(text);
      E[o.file].push({ start: ls[o.item.sL - 1], end: ls[o.item.eL] !== undefined ? ls[o.item.eL] : text.length, text: "" });
    } else if (k > 0) E[o.file].push({ start: st.declarations[k - 1].end, end: d.end, text: "" });
    else E[o.file].push({ start: d.start, end: st.declarations[1].start, text: "" });
    A.fields.push({ name: x, init: text.slice(d.init.start, d.init.end), comment });
  } else {
    if (st.declarations.length !== 1) throw new Error("var " + x + ": non-literal start value inside a multi-name var");
    E[o.file].push({ start: st.start, end: d.id.end, text: "PN.s." + x });
  }
  let n = 0;
  for (const p in E) { A.files[p].text = L.applyEdits(A.files[p].text, E[p]); A.files[p].refs = null; n += E[p].length; }
  L.reparse(A);
  log("  PN.s." + x + " (" + why + "): " + n + " edits in " + Object.keys(E).map(L.relOf).join(", "));
  return true;
}

function moveStep(step) {
  const app = A.files.app, G = L.groups(app.items), lines = app.P.lines;
  const take = {}, cut = [];
  let last = null;
  for (const g of G) {
    for (const l of lines.slice(g[0].gapStart - 1, g[0].sL - 1)) {
      const s = L.SEC_RE(l);
      if (s) { if (!plan.sections.includes(s)) throw new Error("new section header in app.js: \"" + s + "\" — add it to scripts/split/plan.json sections and to a step file"); last = null; }
    }
    const ts = [...new Set(g.map((it) => L.targetOf(plan, it)).filter(Boolean))];
    if (ts.length > 1) throw new Error("app.js:" + g[0].sL + ": statements on one line go to " + ts.join(" + "));
    let t = ts[0];
    const what = g.map((it) => it.keys.join(",") || "stmt `" + it.norm.split("\n")[0].slice(0, 60) + "`").join(" ; ");
    if (!t) { t = last || "app"; log("  UNKNOWN item " + what + " (app.js line " + g[0].sL + ") -> " + t + (last ? " (nearest earlier named item of its section)" : " (first item of its section: stays)")); }
    else last = t;
    if (step.parts[t]) { (take[t] = take[t] || []).push(...lines.slice(g[0].gapStart - 1, g[0].gEnd)); cut.push([g[0].gapStart - 1, g[0].gEnd]); }
  }
  if (!cut.length) { log("  nothing to move (step already applied)"); return 0; }
  const keep = lines.slice(); for (const [a, b] of cut.reverse()) keep.splice(a, b - a);
  app.text = keep.join("\n");
  for (const t of Object.keys(take)) {
    const f = A.files[t];
    if (f) { const pl = f.P.lines.slice(); pl.splice(f.P.endLine - 1, 0, ...take[t]); f.text = pl.join("\n"); log("  WARN " + take[t].length + " lines appended to the existing " + L.relOf(t)); continue; }
    const head = ["/* part */", "(function () {", '  "use strict";', t === "core" ? L.CORE_MARK : "  var PN = window.PN;", L.IMP_MARK];
    A.files[t] = { part: t, raw: null, text: head.concat(take[t], ["})();", ""]).join("\n") };
    log("  " + L.relOf(t) + ": " + take[t].length + " lines moved");
  }
  for (const f of Object.values(A.files)) f.refs = null;
  L.reparse(A);
  return cut.length;
}

let step = null;
if (mode === "move") {
  step = JSON.parse(fs.readFileSync(path.resolve(stepFile), "utf8"));
  log("step " + step.step + ": move " + Object.keys(step.parts).join(" + "));
  for (const s of plan.steps) if (s.step < step.step) for (const p of Object.keys(s.parts)) if (!A.files[p]) throw new Error("step " + s.step + " is not applied (no " + L.relOf(p) + "): apply the steps in order");
  for (const x of step.s) toState(x, "step " + step.step);
  moveStep(step);
}
const need = L.needState(A);
for (const x of need) {
  if (mode !== "move") { console.error("FAIL: " + x + " is written and used by 2+ files: it must be PN." + "s." + x + " (only a step run converts it)"); process.exitCode = 1; continue; }
  log("  NOTE " + x + " is shared + written but not in step.s: converted too (add it to the step file / plan.json state)");
  toState(x, "computed");
}
if (A.fields.length && !A.files.core) throw new Error("PN.s fields but no app-core.js");
const texts = L.render(A, plan);
// render must be stable: strip + render again gives the same text
const B = L.loadApp((p) => (texts[p] !== undefined ? texts[p] : null));
const again = L.render(B, plan);
for (const p in texts) if (again[p] !== texts[p]) throw new Error("render is not stable for " + L.relOf(p) + " (tool bug)");
const html0 = rd("docs/index.html"), html = L.renderIndex(html0, texts);
const changed = [];
for (const p in texts) if (texts[p] !== A.files[p].raw) changed.push(L.relOf(p));
if (html !== html0) changed.push("docs/index.html");
if (mode === "check") {
  if (changed.length) { console.error("FAIL: generated blocks / tags out of date in: " + changed.join(", ") + "\n  fix: node scripts/split/move.mjs . --regen"); process.exit(1); }
  if (!process.exitCode) console.log("split blocks in sync (" + Object.keys(texts).length + " files)");
  process.exit(process.exitCode || 0);
}
if (process.exitCode) process.exit(process.exitCode);
for (const p in texts) if (texts[p] !== A.files[p].raw) fs.writeFileSync(path.join(repo, L.relOf(p)), texts[p]);
if (html !== html0) fs.writeFileSync(path.join(repo, "docs/index.html"), html);
const imp = L.imports(B);
for (const p of L.ORDER) if (texts[p] !== undefined) {
  const n = texts[p].split("\n").length - 1, I = imp[p];
  log("  " + L.relOf(p).padEnd(26) + String(n).padStart(5) + " lines  stubs " + I.fns.length + "  links " + I.vars.length + "  exports " + (I.exportFns.length + I.exportVars.size));
}
log("  PN.s fields: " + L.fieldNames(B).size + "   changed: " + (changed.join(", ") || "nothing"));
