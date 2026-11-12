#!/usr/bin/env node
// W2 app.js split — move-only proof (SPLIT-SPEC 4.2). Exit 0 = OK, 1 = FAIL.
// usage: node scripts/split/verify.mjs --base <ref> [--order <ref>] [--repo <dir>]
//   --base   the commit to compare with (pre-w2, or the commit before this step). Its app.js + parts are read with git show.
//   --order  an UNSPLIT app.js (default: pre-w2 if the tag exists, else --base) for the load-order checks.
// Checks: 1 every item (function / var / statement) of the base is in the work tree, text byte-equal after "PN.s.x" -> "x"
//         ("PN.s.x = v;" = "var x = v;", a PN.s literal field = "var x = v"), no item lost, new or twice; comment multiset equal.
//         2 PN.s fields = the step files of the applied steps; only the writers in plan.json write a field; no shared var is written
//         (a cross-file var that is written must be PN.s). 3 generated blocks + index.html tags in sync (move.mjs --check),
//         app.js is the last script. 4 node --check for every part. 5 no load hazard, listener order = base (except SPEC 4.4 pairs).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as L from "./lib.mjs";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg("--repo") || ".");
const base = arg("--base");
if (!base) { console.error("usage: verify.mjs --base <ref> [--order <ref>] [--repo <dir>]"); process.exit(2); }
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
const has = (ref) => { try { git("rev-parse", "--verify", "-q", ref + "^{commit}"); return true; } catch (e) { return false; } };
if (!has(base)) { console.error("no such ref: " + base); process.exit(2); }
const order = arg("--order") || (has("pre-w2") ? "pre-w2" : base);
const fails = []; const FAIL = (s) => fails.push(s);
const plan = L.readPlan();
const rd = (rel) => { const p = path.join(repo, rel); return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; };
const atRef = (ref) => { const ls = git("ls-tree", "--name-only", ref, "docs/js/").split("\n"); return (part) => (part === "app" || ls.includes(L.relOf(part)) ? git("show", ref + ":" + L.relOf(part)) : null); };

const A = L.loadApp((p) => rd(L.relOf(p)));
const B = L.loadApp(atRef(base));

// ---------- 1 items + comments ----------
function itemMap(X) {
  const m = new Map(), st = new Map();
  const put = (k, text, file) => { if (m.has(k)) FAIL("item twice: " + k + " (" + L.relOf(m.get(k).file) + ", " + L.relOf(file) + ")"); m.set(k, { text, file }); };
  for (const f of Object.values(X.files)) for (const it of f.items) {
    const n = it.node, src = f.P.text, norm = (a, b) => src.slice(a, b).split("PN.s.").join("");
    if (it.kind === "fn") put("fn:" + it.names[0], norm(n.start, n.end), f.part);
    else if (it.kind === "var") n.declarations.forEach((d) => put("var:" + d.id.name, norm(d.start, d.end), f.part));
    else if (it.kind === "svar") put("var:" + it.field, norm(n.start, n.end).replace(/;$/, ""), f.part);
    else { const k = it.norm; st.set(k, (st.get(k) || []).concat([f.part])); }
  }
  for (const x of X.fields) put("var:" + x.name, x.name + " = " + x.init, "core");
  return { m, st };
}
const comments = (X) => {
  const out = [];
  for (const f of Object.values(X.files)) for (const c of f.P.comments) {
    if (/^\s*<\/?split:/.test(c.value) || (f.part !== "app" && /^ PintsNow app part: /.test(c.value) && c.loc.start.line === 1)) continue;
    out.push(c.value);
  }
  for (const x of X.fields) if (x.comment) out.push(x.comment.replace(/^\s*\/\//, ""));
  return out;
};
const IA = itemMap(A), IB = itemMap(B);
let same = 0;
for (const [k, v] of IB.m) {
  const w = IA.m.get(k);
  if (!w) FAIL("lost: " + k + " (was in " + L.relOf(v.file) + ")");
  else if (w.text !== v.text) FAIL("changed: " + k + " in " + L.relOf(w.file));
  else same++;
}
for (const [k, w] of IA.m) if (!IB.m.has(k)) FAIL("new item (not in base): " + k + " in " + L.relOf(w.file));
let stmts = 0;
for (const [k, v] of IB.st) { const w = IA.st.get(k) || []; if (w.length !== v.length) FAIL("statement count " + v.length + " -> " + w.length + ": `" + k.split("\n")[0].slice(0, 80) + "`"); else stmts += v.length; }
for (const [k, w] of IA.st) if (!IB.st.has(k)) FAIL("new or changed statement in " + w.map(L.relOf).join(",") + ": `" + k.split("\n")[0].slice(0, 80) + "`");
{
  const ca = comments(A), cb = comments(B), cnt = new Map();
  cb.forEach((c) => cnt.set(c, (cnt.get(c) || 0) + 1)); ca.forEach((c) => cnt.set(c, (cnt.get(c) || 0) - 1));
  const bad = [...cnt].filter(([, n]) => n !== 0);
  if (bad.length) FAIL("comments differ (" + bad.length + "): " + bad.slice(0, 4).map(([c, n]) => (n > 0 ? "lost " : "extra ") + JSON.stringify(c.slice(0, 60))).join("; "));
}
console.log("items: " + same + " names + " + stmts + " statements byte-equal to " + base + " (" + IB.m.size + " names, " + [...IB.st.values()].reduce((a, v) => a + v.length, 0) + " statements in base)");

// ---------- 2 state ----------
const applied = plan.steps.filter((s) => Object.keys(s.parts).every((p) => A.files[p]));
const want = new Set(applied.flatMap((s) => s.s)), got = L.fieldNames(A);
for (const x of want) if (!got.has(x)) FAIL("PN.s." + x + " missing (step file says it is shared state)");
for (const x of got) if (!want.has(x)) FAIL("PN.s." + x + " is not in the applied step files");
const writers = {};
const walkW = (n, file) => {
  if (!n || typeof n.type !== "string") return;
  const tgt = n.type === "AssignmentExpression" ? n.left : n.type === "UpdateExpression" ? n.argument : null;
  if (tgt && tgt.type === "MemberExpression" && !tgt.computed && tgt.object.type === "MemberExpression" && tgt.object.object.name === "PN" && tgt.object.property.name === "s") (writers[tgt.property.name] = writers[tgt.property.name] || new Set()).add(file);
  for (const k in n) { if (k === "loc") continue; const v = n[k]; if (Array.isArray(v)) v.forEach((c) => c && walkW(c, file)); else if (v && typeof v.type === "string") walkW(v, file); }
};
for (const f of Object.values(A.files)) for (const it of f.items) { if (it.kind === "svar") walkW(it.node.expression.right, f.part); else walkW(it.node, f.part); }
for (const x in writers) {
  const st = plan.state[x]; if (!st) continue;
  const ok = new Set(st.writers.map((w) => (A.files[w] ? w : "app")));
  for (const w of writers[x]) if (!ok.has(w)) FAIL("PN.s." + x + " written in " + L.relOf(w) + " (writers: " + st.writers.join(", ") + ")");
}
for (const x of L.needState(A)) FAIL(x + " is written and used by 2+ files: it must be PN.s." + x);
console.log("state: " + got.size + " PN.s fields (" + applied.map((s) => s.step).join(",") + " applied)");

// ---------- 3 generated blocks + tags ----------
const texts = L.render(A, plan);
for (const p in texts) if (texts[p] !== A.files[p].raw) FAIL("generated block out of date: " + L.relOf(p) + " (node scripts/split/move.mjs . --regen)");
const html = rd("docs/index.html");
if (L.renderIndex(html, texts) !== html) FAIL("index.html part tags / ?v= out of date (node scripts/split/move.mjs . --regen)");
const tags = html.split("\n").filter((l) => /<script\b[^>]*\bsrc=/.test(l));
if (!/src="\.\/app\.js/.test(tags[tags.length - 1] || "")) FAIL("app.js is not the last script tag in index.html");

// ---------- 4 node --check ----------
for (const p of Object.keys(A.files)) { try { execFileSync(process.execPath, ["--check", path.join(repo, L.relOf(p))], { stdio: "pipe" }); } catch (e) { FAIL("node --check " + L.relOf(p) + ": " + String(e.stderr).split("\n").slice(0, 3).join(" ")); } }

// ---------- 5 load order ----------
const O = L.loadApp((p) => (p === "app" ? git("show", order + ":docs/app.js") : null));
const rank = (file) => L.ORDER.filter((p) => A.files[p]).indexOf(file);
const lit = new Set(A.fields.map((x) => x.name));
const fileOfKey = (k) => { const n = k.slice(k.indexOf(":") + 1); if (lit.has(n)) return "core"; const o = A.owner[n]; if (o) return o.file; for (const f of Object.values(A.files)) if (f.items.some((it) => it.kind === "svar" && it.field === n)) return f.part; return null; };
const stUsed = new Map();
const OI = O.files.app.items.map((it) => {
  let file;
  if (it.kind === "stmt") { const fs2 = IA.st.get(it.norm) || []; const u = stUsed.get(it.norm) || 0; stUsed.set(it.norm, u + 1); file = fs2[u] || null; }
  else file = fileOfKey(it.keys[0]);
  const imm = new Set(), calls = new Set();
  L.walkItem(it.node, (r) => { if (!r.load) return; if (r.call) calls.add(r.name); else imm.add(r.name); });
  const sig = [];
  if (it.kind === "stmt") {
    const t = it.norm; let m; const re = /(\$\("[^"]+"\)|document|window|map|clusters|navigator\.serviceWorker)\.(?:addEventListener|on|once)\("([^"]+)"/g;
    while ((m = re.exec(t))) sig.push(m[1] + "|" + m[2]);
    const fe = t.match(/^\[((?:"\w+"(?:, )?)+)\]\.forEach\(function \((\w+)\) \{\s*(document|window)\.addEventListener\(\2\b/);
    if (fe) sig.push(fe[3] + "|" + fe[1].replace(/"/g, "").split(", ").join(" "));
  }
  return { it, file, imm, calls, sig, line: it.sL };
});
const OO = {}; OI.forEach((x) => x.it.names.forEach((n) => (OO[n] = x)));
const lost = OI.filter((x) => !x.file); if (lost.length) console.log("order: " + lost.length + " items of " + order + " not found (new since then?) — not checked");
const pos = (x) => rank(x.file) * 1e6 + x.line;
let hz = 0;
for (const x of OI) {
  if (x.it.kind === "fn" || !x.file) continue;
  const seen = new Set(x.imm), q = [...x.calls], called = new Set();
  while (q.length) { const f = q.pop(); if (called.has(f)) continue; called.add(f); const b = OO[f]; if (!b || b.it.kind !== "fn") continue; b.imm.forEach((r) => seen.add(r)); b.calls.forEach((c) => q.push(c)); }
  for (const n of [...seen, ...called]) {
    const o = OO[n]; if (!o || !o.file || lit.has(n)) continue;
    const isCall = called.has(n) && o.it.kind === "fn";
    if (o.it.kind === "fn") { if (isCall && rank(o.file) > rank(x.file)) { hz++; FAIL("LOAD hazard: " + L.relOf(x.file) + " `" + x.it.node.type + "@" + x.line + "` calls " + n + "() of " + L.relOf(o.file) + " (loads later)"); } }
    else if (o.file !== x.file && pos(o) > pos(x)) { hz++; FAIL("LOAD hazard: " + L.relOf(x.file) + " line " + x.line + " reads " + n + " of " + L.relOf(o.file) + " (set later)"); }
  }
}
const LS = OI.filter((x) => x.sig.length && x.file);
const okPair = (t, ev, a, b) => (t === "window" && ev === "resize") || (t === "document" && [a, b].every((x) => /^\[("\w+", )*"\w+"\]\.forEach/.test(x.it.norm) && /"pointerdown"/.test(x.it.norm.split("\n")[0])));
let flips = 0, okFlips = 0;
for (let i = 0; i < LS.length; i++) for (let j = i + 1; j < LS.length; j++) {
  const a = LS[i], b = LS[j]; if ((pos(a) < pos(b)) === (a.line < b.line)) continue;
  for (const s1 of a.sig) for (const s2 of b.sig) {
    const [t1, e1] = s1.split("|"), [t2, e2] = s2.split("|"); if (t1 !== t2) continue;
    for (const ev of e1.split(" ").filter((e) => e2.split(" ").includes(e))) {
      if (okPair(t1, ev, a, b)) { okFlips++; continue; }
      flips++; FAIL("LISTENER order flipped: " + t1 + " " + ev + ": " + L.relOf(a.file) + " (base line " + a.line + ") now after/before " + L.relOf(b.file) + " (base line " + b.line + ")");
    }
  }
}
console.log("load order (" + order + "): " + hz + " hazards, " + flips + " listener flips (+" + okFlips + " allowed by SPEC 4.4)");
const parts = Object.keys(A.files).filter((p) => p !== "app");
console.log("files: " + parts.length + " parts + app.js (" + (A.files.app.raw.split("\n").length - 1) + " lines)");
if (fails.length) { console.log("FAIL (" + fails.length + "):"); fails.slice(0, 40).forEach((f) => console.log("  " + f)); if (fails.length > 40) console.log("  …"); process.exit(1); }
console.log("verify OK: move only");
