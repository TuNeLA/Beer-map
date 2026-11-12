// A2: the module hook order lives in docs/js/pn.js (frozen BASE list). Pure node, no browser.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, "../../docs");
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", n), "utf8"));
const PN_SRC = fs.readFileSync(path.join(DOCS, "js/pn.js"), "utf8");
const BASE_FX = fx("hook-order-base.json");
const run = (win) => { const w = win || {}; w.window = w; vm.runInNewContext(PN_SRC, w); return w; };

test("pn.js BASE = fixture (85 names, same order)", () => {
  const w = run();
  assert.equal(BASE_FX.length, 85);
  assert.deepEqual([...w.PN.hookNames()], BASE_FX);
});

test("no app part still holds the literal list", () => {
  const files = ["app.js"].concat(fs.readdirSync(path.join(DOCS, "js")).filter((f) => /^app-.*\.js$/.test(f)).map((f) => "js/" + f));
  for (const f of files) assert.ok(!/window\.DIALEKT, window\.SOCIAL/.test(fs.readFileSync(path.join(DOCS, f), "utf8")), f);
});

test("PN.mod appends new names once; hookList reads window[name] at every call", () => {
  const win = {};
  BASE_FX.forEach((n, i) => { if (i !== 3 && i !== 40 && i !== 84) win[n] = { n }; });
  const w = run(win);
  w.PN.mod("NEWA"); w.PN.mod("NEWB"); w.PN.mod("NEWA"); w.PN.mod("DIALEKT");
  assert.deepEqual([...w.PN.hookNames()], BASE_FX.concat(["NEWA", "NEWB"]));
  let l = w.PN.hookList();
  assert.equal(l.length, 87);
  assert.deepEqual([l[3], l[40], l[84], l[85]], [undefined, undefined, undefined, undefined]);
  w.NEWB = { late: 1 };   // a late module shows up without a new registration
  assert.equal(w.PN.hookList()[86].late, 1);
});

test("a hook module is in BASE, calls PN.mod, or is listed in hook-free.json", () => {
  const HOOKS = fx("hook-names.json"), FREE = fx("hook-free.json"), free = Object.keys(FREE);
  const bad = [];
  for (const f of fs.readdirSync(path.join(DOCS, "js")).filter((f) => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(DOCS, "js", f), "utf8");
    const re = /window\.([A-Z][A-Z0-9_]*)\s*=\s*\{/g; let m;
    while ((m = re.exec(src))) {
      // the object literal: from the "{" to the matching "}" at depth 0
      let d = 0, i = m.index + m[0].length - 1, j = i;
      for (; j < src.length; j++) { const c = src[j]; if (c === "{") d++; else if (c === "}" && --d === 0) break; }
      const lit = src.slice(i + 1, j);
      // top-level members only (depth 1)
      let dd = 0, top = "";
      for (const c of lit) { if (c === "{" || c === "(" || c === "[") dd++; if (dd === 0) top += c; if (c === "}" || c === ")" || c === "]") dd--; }
      const has = HOOKS.some((h) => new RegExp("(^|[\\s,])" + h + "\\s*(:|\\()").test(top));
      const name = m[1];
      if (has && !BASE_FX.includes(name) && !free.includes(name) && !new RegExp('PN\\.mod\\(\\s*"' + name + '"').test(src)) bad.push(f + ":" + name);
    }
  }
  assert.deepEqual(bad, [], "add PN.mod(\"NAME\") after window.NAME = ...");
});

test("the 40 hook names used by mods(...) in docs/app.js + docs/js/app-*.js are the fixture", () => {
  const src = ["app.js"].concat(fs.readdirSync(path.join(DOCS, "js")).filter((f) => /^app-.*\.js$/.test(f)).map((f) => "js/" + f)).map((f) => fs.readFileSync(path.join(DOCS, f), "utf8")).join("\n");
  const got = [...new Set([...src.matchAll(/\bmods\("([A-Za-z0-9_]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(got, fx("hook-names.json").slice().sort());
});
