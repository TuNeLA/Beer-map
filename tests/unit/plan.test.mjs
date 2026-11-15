// CI plan (scripts/ci/plan.mjs): the e2e matrix comes from tests/e2e/shards.txt; .ci-only cuts it on ci/ branches;
// --gate = the deploy gate; a docs-only / ops-only push starts no e2e runner. (lane cifast, finished by lane ci1)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseShards, parseOnly, plan, canSkipE2e, suites, durations, wallOf } from "../../scripts/ci/plan.mjs";

const TXT = "# c\nui-1 ^(a|b)$\n\nwebkit ^(w)$ chromium webkit par=1\nmain ^(main|sec)$ site=bundled gate   # the gate\n";
test("parseShards: name, regex, options (browsers, par, site, gate), comments and blanks skipped", () => {
  assert.deepEqual(parseShards(TXT), [
    { name: "ui-1", filter: "^(a|b)$", par: 2 }, { name: "webkit", filter: "^(w)$", par: 1, browsers: "chromium webkit" },
    { name: "main", filter: "^(main|sec)$", par: 2, site: "bundled", gate: true }]);
});
test("parseShards: duplicate, bad name, missing regex, bad regex, unknown option all fail", () => {
  assert.throws(() => parseShards("a ^(x)$\na ^(y)$"), /duplicate/);
  assert.throws(() => parseShards("a/b ^(x)$"), /bad name/);
  assert.throws(() => parseShards("a"), /no regex/);
  assert.throws(() => parseShards("a ^(x$"), /bad regex/);
  assert.throws(() => parseShards("a ^(x)$ par=0"), /unknown option/);
  assert.throws(() => parseShards("a ^(x)$ safari"), /unknown option/);
  assert.throws(() => parseShards("# nothing"), /no shards/);
});
test("plan: no .ci-only = every shard; .ci-only = only the named ones, in shards.txt order", () => {
  const s = parseShards(TXT);
  assert.equal(plan(s, null).include.length, 3);
  assert.deepEqual(plan(s, ["main", "ui-1"]).include.map((x) => x.name), ["ui-1", "main"]);
  assert.deepEqual(plan(s, parseOnly("ui-1 # mine\n\nunit\nbundle\n")).include.map((x) => x.name), ["ui-1"]);
});
test("plan: a typo or an empty .ci-only fails (never a silent run of 0 shards)", () => {
  const s = parseShards(TXT);
  assert.throws(() => plan(s, ["ui-11"]), /no such shard: ui-11/);
  assert.throws(() => plan(s, []), /lists no e2e shard/);
  assert.throws(() => plan(s, ["unit"]), /lists no e2e shard/);
});
test("canSkipE2e: only when EVERY changed file is docs-only / ops-only; no list = run", () => {
  assert.equal(canSkipE2e(["README.md", "ops/x.txt", "tests/e2e/CI-FOR-AGENTS.md", "android/app/build.gradle", "supabase/migrations/0520_x.sql", "scripts/dev/quick.sh", ".github/workflows/bars.yml"]), true);
  assert.equal(canSkipE2e(["README.md", "docs/js/pn.js"]), false);
  for (const f of ["docs/index.html", "docs/bars.json", "tests/e2e/main-pw.js", "tests/e2e/shards.txt", "scripts/bundle.mjs", "scripts/ci/plan.mjs", "package-lock.json", ".github/workflows/e2e.yml", ".github/workflows/tests.yml", ".github/workflows/pages-bundle.yml", "index.html"])
    assert.equal(canSkipE2e([f]), false, f);
  assert.equal(canSkipE2e([]), false);
  assert.equal(canSkipE2e(["", "  "]), false);
  assert.equal(canSkipE2e(undefined), false);
});
test("suites: reads `run`, `ENV=1 run`, `if …; then run` and the node-only lines of run-all.sh, once each, in order", () => {
  const s = suites(["run a $A a-pw.js", "NEEDS_MAPBOX=1 run glmap      $A glmap-pw.js mbx", "  # run no $B no-pw.js", "run a $B a-pw.js t",
    'if [ -f x ]; then run autoci $B ac-pw.js; else skip autoci "no"; fi', 'if [ -n "${P:-}" ]; then run smoke $B smoke-pw.js $P   # c',
    "[[ notif-sw =~ $FILTER ]] && { (cd $D && timeout 120 node notif-sw-test.js $REPO > x 2>&1); rc=$?"].join("\n"));
  assert.deepEqual(s.map((x) => x.name + ":" + x.file), ["a:a-pw.js", "glmap:glmap-pw.js", "autoci:ac-pw.js", "smoke:smoke-pw.js", "notif-sw:notif-sw-test.js"]);
});
test("wallOf: `par` workers take the suites in list order; an unknown suite counts 60 s", () => {
  const d = durations("# c\na 100\nb 300\nc 50\n");
  assert.equal(wallOf(["a", "b", "c"], d, 1), 450);
  assert.equal(wallOf(["a", "b", "c"], d, 2), 300);
  assert.equal(wallOf(["a", "x"], d, 1), 160);
});
test("the real shards.txt: parses, has the deploy gate on the built site, every regex is anchored", () => {
  const s = parseShards(readFileSync(new URL("../e2e/shards.txt", import.meta.url), "utf8"));
  assert.ok(s.length >= 10 && s.length <= 22, "one wave of runners: " + s.length + " shards");
  assert.ok(s.every((x) => /^\^\(.*\)\$$/.test(x.filter)));
  const g = s.filter((x) => x.gate);
  assert.ok(g.length >= 1 && g.every((x) => x.site === "bundled"));
  assert.ok(g.some((x) => new RegExp(x.filter).test("main")) && g.some((x) => new RegExp(x.filter).test("start1")), "main + start1 gate the deploy");
});
test("shard-guard passes on the repo (every *-pw.js in exactly one shard or on not-in-ci.txt)", () => {
  const r = spawnSync("node", [new URL("../../scripts/ci/shard-guard.mjs", import.meta.url).pathname, new URL("../..", import.meta.url).pathname], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

// the CLI, as the plan job runs it: ref rules, CR LF, empty file, --gate, changed files
function cli(ref, only, o = {}) {
  const d = mkdtempSync(join(tmpdir(), "plan-"));
  try {
    mkdirSync(join(d, "tests/e2e"), { recursive: true });
    writeFileSync(join(d, "tests/e2e/shards.txt"), o.txt || TXT);
    if (only !== null) writeFileSync(join(d, ".ci-only"), only);
    const out = join(d, "out.txt"); writeFileSync(out, "");
    const env = { ...process.env, GITHUB_REF: ref, GITHUB_OUTPUT: out }; delete env.CHANGED_FILES;
    if (o.changed !== undefined) env.CHANGED_FILES = o.changed;
    const r = spawnSync("node", [new URL("../../scripts/ci/plan.mjs", import.meta.url).pathname, d, ...(o.args || [])], { env, encoding: "utf8" });
    const t = readFileSync(out, "utf8"), m = /matrix=(.*)/.exec(t), c = /count=(\d+)/.exec(t);
    return { code: r.status, m: m ? JSON.parse(m[1]).include : null, names: m ? JSON.parse(m[1]).include.map((x) => x.name) : null, count: c && c[1], err: r.stderr };
  } finally { rmSync(d, { recursive: true, force: true }); }
}
test("cli: .ci-only is read only on refs/heads/ci/*", () => {
  assert.deepEqual(cli("refs/heads/ci/x-1", "main\n").names, ["main"]);
  for (const ref of ["refs/heads/big-update", "refs/heads/main", "refs/pull/5/merge"]) assert.equal(cli(ref, "main\n").names.length, 3, ref);
});
test("cli: CR LF, spaces, comments and blank lines are trimmed", () => {
  assert.deepEqual(cli("refs/heads/ci/x-1", "  ui-1 \r\n\r\n# note\r\nmain\t# mine\r\n").names, ["ui-1", "main"]);
});
test("cli: an empty or blank .ci-only fails loudly (exit 1, no matrix)", () => {
  for (const c of ["", "\r\n\r\n", "   \n# only a comment\n"]) { const r = cli("refs/heads/ci/x-1", c); assert.equal(r.code, 1); assert.equal(r.names, null); }
});
test("cli: every matrix row has name, filter, par, browsers, bkey, site (the workflow reads them all)", () => {
  assert.deepEqual(cli("refs/heads/big-update", null).m, [
    { name: "ui-1", filter: "^(a|b)$", par: 2, browsers: "chromium", bkey: "chromium", site: "plain" },
    { name: "webkit", filter: "^(w)$", par: 1, browsers: "chromium webkit", bkey: "chromium-webkit", site: "plain" },
    { name: "main", filter: "^(main|sec)$", par: 2, browsers: "chromium", bkey: "chromium", site: "bundled" }]);
});
test("cli --gate: only the gate shards, .ci-only and the changed files are ignored; no gate shard = exit 1", () => {
  const r = cli("refs/heads/ci/x-1", "ui-1\n", { args: ["--gate"], changed: "README.md\n" });
  assert.deepEqual(r.names, ["main"]); assert.equal(r.count, "1");
  assert.equal(cli("refs/heads/main", null, { args: ["--gate"], txt: "a ^(x)$\n" }).code, 1);
});
test("cli: a docs-only push gives an empty matrix and count=0; one app file runs everything", () => {
  const r = cli("refs/heads/big-update", null, { changed: "README.md\nops/notes.md\n" });
  assert.equal(r.count, "0"); assert.deepEqual(r.names, []);
  assert.equal(cli("refs/heads/big-update", null, { changed: "README.md\ndocs/app.js\n" }).count, "3");
  assert.equal(cli("refs/heads/big-update", null, { changed: "" }).count, "3");
  assert.equal(cli("refs/heads/big-update", null).count, "3");
});
