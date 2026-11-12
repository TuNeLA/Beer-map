// W2 app.js split: the unit loader finds a function in ANY app file (app.js or docs/js/app-*.js), never a generated stub,
// and gives "PN.s.x" code the same sandbox state as plain "x" code. Same test before and after a move = no logic change.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadFunctions, DOCS } from "./load.mjs";

test("errMsg loads from any part (not a stub) and maps server codes", () => {
  let re = 0;
  const f = loadFunctions(["errMsg"], { U: { errCode: (e) => e && e.code }, t: (k) => "T:" + k, reauth: () => { re++; } });
  assert.ok(!/PN\.errMsg\.apply/.test(fs.readFileSync(path.join(DOCS, f.where.errMsg), "utf8").match(/function errMsg\([^]*?\n  \}/)[0]));
  assert.equal(f.errMsg({ code: "own_beer" }), "T:skalOwn");
  assert.equal(f.errMsg({ code: "not_authenticated" }), "T:notAuth");
  assert.equal(re, 1);
  assert.equal(f.errMsg({ code: "x" }, "fb"), "fb");
  assert.equal(f.errMsg(null), "T:fail");
});

test("every app part is one IIFE with a generated imports block; app.js loads last", () => {
  const parts = fs.readdirSync(path.join(DOCS, "js")).filter((f) => /^app-[a-z]+\.js$/.test(f));
  for (const p of parts) {
    const s = fs.readFileSync(path.join(DOCS, "js", p), "utf8");
    assert.match(s, /^\/\* PintsNow app part: .*\*\/\n\(function \(\) \{\n  "use strict";\n/, p);
    assert.ok(s.includes("  // <split:imports>") && s.includes("  // </split:imports>"), p);
    assert.ok(s.endsWith("\n})();\n"), p);
  }
  const tags = fs.readFileSync(path.join(DOCS, "index.html"), "utf8").split("\n").filter((l) => /<script\b[^>]*\bsrc=/.test(l));
  assert.match(tags[tags.length - 1], /src="\.\/app\.js/);
  for (const p of parts) assert.ok(tags.some((l) => l.includes('src="./js/' + p)), p + " has a script tag");
});
