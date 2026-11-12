// I-29: a change in only a dialekt pack file must change the ?v= of dialekt.js (packs load with that tag).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stampSite, checkSite, stripSite } from "../../scripts/stamp.mjs";

function site() {
  const d = mkdtempSync(join(tmpdir(), "stamp-packs-"));
  mkdirSync(join(d, "js/dialekt-packs"), { recursive: true });
  writeFileSync(join(d, "index.html"), '<script defer src="./js/dialekt.js"></script><script defer src="./js/other.js"></script>');
  writeFileSync(join(d, "sw.js"), 'var VERSION = "dev";\n');
  writeFileSync(join(d, "js/dialekt.js"), "// loader");
  writeFileSync(join(d, "js/other.js"), "// other");
  writeFileSync(join(d, "js/dialekt-packs/sv-syd.js"), "// pack v1");
  return d;
}
const tag = (d, f) => new RegExp(f.replace(/[./]/g, "\\$&") + "\\?v=([0-9a-f]{10})").exec(readFileSync(join(d, "index.html"), "utf8"))[1];

test("pack-only change changes the dialekt.js tag, not other tags", () => {
  const d = site();
  try {
    stampSite(d); const a = tag(d, "js/dialekt.js"), o = tag(d, "js/other.js");
    stripSite(d);
    writeFileSync(join(d, "js/dialekt-packs/sv-syd.js"), "// pack v2");
    stampSite(d);
    assert.notEqual(tag(d, "js/dialekt.js"), a);
    assert.equal(tag(d, "js/other.js"), o);
    assert.deepEqual(checkSite(d), []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
test("a new pack file also changes the tag; stamping twice is stable", () => {
  const d = site();
  try {
    stampSite(d); const a = tag(d, "js/dialekt.js"); stampSite(d);
    assert.equal(tag(d, "js/dialekt.js"), a);
    stripSite(d); writeFileSync(join(d, "js/dialekt-packs/sv-vast.js"), "// new");
    stampSite(d); assert.notEqual(tag(d, "js/dialekt.js"), a);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
