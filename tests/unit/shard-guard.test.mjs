// lane ciwork (B4): scripts/ci/shard-guard.mjs fails when an e2e test runs in no shard, in two shards, or twice in one shard.
//   GUARD=<path> runs these checks against another copy of the guard (used to prove the old guard missed cases 4 + 5).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = process.env.GUARD || new URL("../../scripts/ci/shard-guard.mjs", import.meta.url).pathname;
const SHARDS = "gate ^(main)$ site=bundled gate\nui-1 ^(a|b)$\n";
const RUN = "run main $B main-pw.js\nrun a $B a-pw.js\nrun b $B b-pw.js x\n";

function guard(runAll, shards = SHARDS, files = ["main-pw.js", "a-pw.js", "b-pw.js"], notInCi = null) {
  const d = mkdtempSync(join(tmpdir(), "sg-"));
  try {
    mkdirSync(join(d, "tests/e2e"), { recursive: true });
    writeFileSync(join(d, "tests/e2e/run-all.sh"), runAll);
    writeFileSync(join(d, "tests/e2e/shards.txt"), shards);
    for (const f of files) writeFileSync(join(d, "tests/e2e", f), "");
    if (notInCi !== null) writeFileSync(join(d, "tests/e2e/not-in-ci.txt"), notInCi);
    const r = spawnSync("node", [GUARD, d], { encoding: "utf8" });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally { rmSync(d, { recursive: true, force: true }); }
}

test("1. a clean list passes", () => { const r = guard(RUN); assert.equal(r.code, 0, r.out); });
test("2. a *-pw.js file in no runner fails", () => {
  const r = guard(RUN, SHARDS, ["main-pw.js", "a-pw.js", "b-pw.js", "lost-pw.js"]);
  assert.equal(r.code, 1); assert.match(r.out, /lost-pw\.js is in no CI shard/);
});
test("3. a suite in two shards fails (the old eggs case)", () => {
  const r = guard(RUN, SHARDS + "ui-2 ^(a)$\n");
  assert.equal(r.code, 1); assert.match(r.out, /suite `a` is in 2 shards/);
});
test("4. the same suite name on two lines fails (it runs twice in its shard)", () => {
  const r = guard(RUN + "run a $B a-pw.js   # copied by a merge\n");
  assert.equal(r.code, 1, r.out); assert.match(r.out, /suite `a` is written twice/);
});
test("5. the same file + args under two names fails; other args are fine", () => {
  const r = guard(RUN + "run b2 $B b-pw.js x\n", "gate ^(main)$ site=bundled gate\nui-1 ^(a|b|b2)$\n");
  assert.equal(r.code, 1, r.out); assert.match(r.out, /`b` and `b2` run the same command/);
  const ok = guard(RUN + "run b-wk $B b-pw.js wk\n", "gate ^(main)$ site=bundled gate\nui-1 ^(a|b|b-wk)$\n");
  assert.equal(ok.code, 0, ok.out);
});
test("6. not-in-ci.txt keeps a file out of CI on purpose; it needs a reason; not on both lists", () => {
  const F = ["main-pw.js", "a-pw.js", "b-pw.js", "probe-pw.js"];
  assert.equal(guard(RUN, SHARDS, F, "probe-pw.js   a measuring probe with no PASS lines\n").code, 0);
  assert.match(guard(RUN, SHARDS, F, "probe-pw.js x\n").out, /a reason of 8\+ letters/);
  assert.match(guard(RUN, SHARDS, F.slice(0, 3), "a-pw.js   listed here and in run-all.sh\n").out, /in run-all\.sh AND in not-in-ci\.txt/);
});
