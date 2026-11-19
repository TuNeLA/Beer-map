// lane ciwork (C23): no signing key and no key password in the repo. The old TWA build (android.yml + android/olnu-test.keystore)
// had a test keystore and its password in this PUBLIC repo; the Capacitor build (android-cap.yml) takes them from GitHub secrets.
// The failure text names only the file, never the value.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = new URL("../..", import.meta.url).pathname;
const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

test("no keystore / key file is tracked (.keystore .jks .p12 .pk8 .pem)", () => {
  assert.deepEqual(files.filter((f) => /\.(keystore|jks|p12|pk8|pem)$/i.test(f)), []);
});
test("no workflow or gradle file sets a store / key password to a fixed value (only ${{ secrets.* }} or env)", () => {
  const bad = [];
  for (const f of files.filter((x) => /^\.github\/workflows\/.*\.ya?ml$|\.gradle$|gradle\.properties$/.test(x))) {
    readFileSync(ROOT + f, "utf8").split("\n").forEach((l, i) => {
      const m = /^\s*(?:[A-Z0-9_]*(?:STORE|KEY)_?PASS(?:WORD)?|storePassword|keyPassword|android\.injected\.signing\.(?:store|key)\.password)\s*[:=]\s*(.+)$/i.exec(l);
      if (m && !/\$\{\{\s*secrets\.|System\.getenv|\$\{?[A-Z_]+\}?|^["']?\s*["']?$/.test(m[1].trim())) bad.push(f + ":" + (i + 1));
    });
  }
  assert.deepEqual(bad, [], "a fixed signing password (the value is not printed)");
});
test("the old TWA build is gone; the Capacitor build is the Android build", () => {
  assert.ok(!files.includes(".github/workflows/android.yml"), "android.yml (old TWA) is still in the repo");
  assert.ok(!files.some((f) => f.startsWith("android/")), "android/ (old TWA project) is still in the repo");
  assert.ok(files.includes(".github/workflows/android-cap.yml") && files.some((f) => f.startsWith("android-cap/")), "android-cap build missing");
});
