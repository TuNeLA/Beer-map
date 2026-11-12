// CI plan (scripts/ci/plan.mjs): the e2e matrix comes from tests/e2e/shards.txt; .ci-only cuts it on ci/ branches.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseShards, parseOnly, plan } from "../../scripts/ci/plan.mjs";

const TXT = "# c\nui-1 ^(a|b)$\n\nwebkit ^(w)$ chromium webkit\nmain ^(main|sec)$\n";
test("parseShards: name, regex, optional browsers, comments and blanks skipped", () => {
  assert.deepEqual(parseShards(TXT), [
    { name: "ui-1", filter: "^(a|b)$" }, { name: "webkit", filter: "^(w)$", browsers: "chromium webkit" }, { name: "main", filter: "^(main|sec)$" }]);
});
test("parseShards: duplicate, bad name, missing regex, bad regex all fail", () => {
  assert.throws(() => parseShards("a ^(x)$\na ^(y)$"), /duplicate/);
  assert.throws(() => parseShards("a/b ^(x)$"), /bad name/);
  assert.throws(() => parseShards("a"), /no regex/);
  assert.throws(() => parseShards("a ^(x$"), /bad regex/);
  assert.throws(() => parseShards("# nothing"), /no shards/);
});
test("plan: no .ci-only = every shard; .ci-only = only the named ones, in shards.txt order", () => {
  const s = parseShards(TXT);
  assert.equal(plan(s, null).include.length, 3);
  assert.deepEqual(plan(s, ["main", "ui-1"]).include.map((x) => x.name), ["ui-1", "main"]);
  assert.deepEqual(plan(s, parseOnly("ui-1 # mine\n\nunit\n")).include.map((x) => x.name), ["ui-1"]);
});
test("plan: a typo or an empty .ci-only fails (never a silent run of 0 shards)", () => {
  const s = parseShards(TXT);
  assert.throws(() => plan(s, ["ui-11"]), /no such shard: ui-11/);
  assert.throws(() => plan(s, []), /lists no e2e shard/);
  assert.throws(() => plan(s, ["unit"]), /lists no e2e shard/);
});
test("the real tests/e2e/shards.txt parses and every name is unique", () => {
  const s = parseShards(readFileSync(new URL("../e2e/shards.txt", import.meta.url), "utf8"));
  assert.ok(s.length >= 40);
  assert.ok(s.every((x) => x.filter.startsWith("^(")));
});
