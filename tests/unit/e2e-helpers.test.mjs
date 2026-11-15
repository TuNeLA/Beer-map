// lane ci1: the shared e2e helpers load and export what the tests import (node --check does not see a missing function).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const E2E = new URL("../e2e/", import.meta.url).pathname;
for (const h of ["ds-helpers.js", "d2-helpers.js"]) {
  test(h + ": loads; boot, wait, settle, ctxFor, clickJS are functions", () => {
    const m = require(E2E + h);
    for (const k of ["boot", "wait", "settle", "ctxFor", "clickJS"]) assert.equal(typeof m[k], "function", k);
  });
  test(h + ": every name a test destructures from it is exported", () => {
    const m = require(E2E + h), bad = [];
    for (const f of readdirSync(E2E).filter((x) => /\.js$/.test(x))) {
      const src = readFileSync(E2E + f, "utf8");
      const direct = [...src.matchAll(new RegExp('const \\{([^}]*)\\} = require\\("\\./' + h.replace(".", "\\.") + '"\\)', "g"))].map((x) => x[1]);
      const viaH = new RegExp('const H = require\\("\\./' + h.replace(".", "\\.") + '"\\)').test(src) ? [...src.matchAll(/const \{([^}]*)\} = H;/g)].map((x) => x[1]) : [];
      for (const list of direct.concat(viaH)) for (const n of list.split(",").map((x) => x.split(":")[0].trim()).filter(Boolean)) if (!(n in m)) bad.push(f + ": " + n);
    }
    assert.deepEqual(bad, []);
  });
}
