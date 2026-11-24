// D1 one motion token set: the scanner (tests/quality/motion.mjs) and the app. Fails when a raw duration < 1 s or a raw easing
// is back in docs/ (CSS, CSS text in JS, el.style.transition, el.animate), or when the token block and DESIGN.md disagree.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeDecl, scanCssText, scanJs, scanRepo, bad, loadAcorn, DUR_TOKENS, EASE_TOKENS } from "../quality/motion.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const acorn = loadAcorn(REPO);
const raws = (rows) => rows.filter((r) => r.raw && r.kind !== "delay").map((r) => r.value);

test("motion scanner: raw times and curves are found, tokens pass", () => {
  assert.deepEqual(raws(judgeDecl("transition", "opacity .2s ease")), [".2s", "ease"]);
  assert.deepEqual(raws(judgeDecl("transition", "opacity var(--m-4) var(--e-std),transform var(--m-2) var(--e-spring)")), []);
  assert.deepEqual(raws(judgeDecl("animation", "pop 300ms cubic-bezier(.2,1.6,.4,1) both")), ["300ms", "cubic-bezier(.2,1.6,.4,1)"]);
  assert.deepEqual(raws(judgeDecl("animation", "pop var(--m-5) both")), ["(default ease)"], "no easing = the browser default ease");
  assert.deepEqual(raws(judgeDecl("animation", "glow 1.6s var(--e-io) infinite")), [], "1 s and more = loop period: own seconds");
  assert.deepEqual(raws(judgeDecl("animation", "blink var(--m-8) steps(2) infinite")), [], "steps() = discrete, allowed");
  assert.deepEqual(raws(judgeDecl("transition", "opacity .16s var(--e-std),visibility 0s linear .16s")), [".16s"], "a 0 s part moves nothing");
  assert.deepEqual(raws(judgeDecl("transition", "transform var(--ds-t-1) var(--ds-ease)")), ["var(--ds-t-1)", "var(--ds-ease)"], "old alias names are raw");
  assert.deepEqual(raws(judgeDecl("animation-duration", "1ms")), [], "reduced motion 1 ms = off");
  assert.deepEqual(raws(judgeDecl("animation", "none")), []);
});
test("motion scanner: CSS custom properties and comments", () => {
  assert.deepEqual(raws(scanCssText(".a{--tk-dim:80ms}/* transition: opacity .3s ease */")), ["80ms"]);
  assert.deepEqual(raws(scanCssText("@supports (animation-timing-function:linear(0,1)){.a{color:red}}")), []);
});
test("motion scanner: JS strings, style assignments (both ternary sides) and el.animate()", { skip: !acorn && "no acorn" }, () => {
  const js = 'var s = ".x{transition:opacity .25s ease}";\n' +
    'el.style.transition = ok ? "none" : "transform 220ms cubic-bezier(.2,.9,.3,1.2)";\n' +
    'el.animate([{opacity:0},{opacity:1}], { duration: 300, easing: "ease-out" });\n' +
    'el.animate([{opacity:0},{opacity:1}], 800);\n' +
    'el.animate([{opacity:0},{opacity:1}], { duration: SMOOTH.ms("--m-5", 300), easing: SMOOTH.ease("--e-in", "ease-out") });';
  assert.deepEqual(raws(scanJs(js, "x.js", acorn)), [".25s", "ease", "220ms", "cubic-bezier(.2,.9,.3,1.2)", "300", '"ease-out"', "800"]);
});
test("D1: no raw duration under 1 s and no raw easing in docs/ (run: node tests/quality/motion.mjs . --list)", { skip: !acorn && "no acorn" }, () => {
  const b = bad(scanRepo(REPO, acorn));
  assert.equal(b.length, 0, b.slice(0, 20).map((r) => r.file + ":" + r.line + " " + r.raw).join("\n"));
});
test("D1: the token block in pnds.css holds the whole set, and DESIGN.md lists each token", () => {
  const css = fs.readFileSync(path.join(REPO, "docs/pnds.css"), "utf8"), md = fs.readFileSync(path.join(REPO, "DESIGN.md"), "utf8");
  const block = css.slice(css.indexOf("/* ds10 motion START"), css.indexOf("@supports (animation-timing-function:linear(0,1))"));
  const want = { "--m-1": "50ms", "--m-2": "100ms", "--m-3": "150ms", "--m-4": "200ms", "--m-5": "300ms", "--m-6": "450ms", "--m-7": "600ms", "--m-8": "900ms",
    "--e-std": "cubic-bezier(.2,0,0,1)", "--e-in": "cubic-bezier(.05,.7,.1,1)", "--e-out": "cubic-bezier(.3,0,.8,.15)", "--e-io": "cubic-bezier(.42,0,.58,1)",
    "--e-pop": "cubic-bezier(.2,1.4,.4,1)", "--e-lin": "linear" };
  for (const [k, v] of Object.entries(want)) {
    assert.ok(block.includes(k + ":" + v), k + " = " + v + " in the pnds.css token block");
    assert.ok(md.includes("`" + k + "`"), k + " in DESIGN.md");
    assert.ok(DUR_TOKENS.test(k) || EASE_TOKENS.test(k), k + " is a token name for the guard");
  }
  assert.ok(md.includes("`--e-spring`") && /--e-spring:/.test(block));
});
test("D1: old motion names are defined only in pnds.css (as aliases of the tokens)", () => {
  const dir = path.join(REPO, "docs"), files = fs.readdirSync(dir).filter((f) => f.endsWith(".css") && f !== "pnds.css");
  for (const f of files) {
    const t = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const m = t.match(/(?<![-\w])--(ds-t-[1-3]|d-[1-3]|sm-t-in|sm-in|sm-out|ds-ease|ease|ease-spring|pn-dec|pn-acc)\s*:/);
    assert.equal(m, null, f + " defines " + (m && m[0]));
  }
});
