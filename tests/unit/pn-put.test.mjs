// #10: PN.put must not overwrite names that pn.js / boot.js / app-core.js own (a silent break of module loading).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import { DOCS } from "./load.mjs";

const read = (f) => fs.readFileSync(DOCS + "/" + f, "utf8");
function boot(win) {
  const w = Object.assign({ console: { error() { w._errs.push([].slice.call(arguments).join(" ")); } }, _errs: [] }, win || {}); w.window = w;
  vm.runInNewContext(read("js/pn.js"), w);
  const core = read("js/app-core.js"), m = /var PN = window\.PN, links = \[\];\n\s*(PN\.put = [^\n]*)\n\s*(PN\.link = [^\n]*)/.exec(core);
  assert.ok(m, "PN.put / PN.link lines in app-core.js");
  vm.runInNewContext("var PN = window.PN, links = [];" + m[1] + m[2], w);
  return w;
}

test("PN.put copies normal names and runs the link callbacks", () => {
  const w = boot({ PN_DEV: true }); let n = 0;
  w.PN.link(() => { n++; }); w.PN.put({ foo: 1, U: { a: 1 } });
  assert.equal(w.PN.foo, 1); assert.equal(n, 2);
});

test("dev/test: a reserved name throws and nothing is overwritten", () => {
  const w = boot({ PN_DEV: true }), mod = w.PN.mod;
  for (const k of ["mod", "hookNames", "hookList", "s", "put", "link", "load"]) assert.throws(() => w.PN.put({ [k]: 1 }), /reserved name/, k);
  assert.equal(w.PN.mod, mod);
});

test("localhost counts as dev", () => {
  const w = boot({ location: { hostname: "localhost" } });
  assert.throws(() => w.PN.put({ load: 1 }), /reserved/);
});

test("prod: console.error, the name is skipped, other names in the same call still land", () => {
  const w = boot({ location: { hostname: "pintsnow.example" } }), mod = w.PN.mod;
  w.PN.put({ mod: 1, ok: 2 });
  assert.equal(w.PN.mod, mod); assert.equal(w.PN.ok, 2); assert.equal(w._errs.length, 1); assert.match(w._errs[0], /reserved name 'mod'/);
});

test("the reserved list covers every name pn.js defines", () => {
  const w = boot({ PN_DEV: true });
  for (const k of ["mod", "hookNames", "hookList", "reserved", "putBad"]) assert.ok(w.PN.reserved.includes(k), k);
});
