// ci1 (code audit A1): every e2e test runs in CI exactly once, or is on a list that says why not.
//   node scripts/ci/shard-guard.mjs [repo root]      exit 1 = a test that never runs, runs twice, or a stale list entry
// Checks:
//   1. every tests/e2e/*-pw.js file is named in tests/e2e/run-all.sh, or in tests/e2e/not-in-ci.txt (`<file>  <why>`), not both
//   2. every suite name in run-all.sh matches exactly ONE shard regex in tests/e2e/shards.txt (0 = never runs, 2+ = runs twice)
//   3. every shard matches at least one suite; every not-in-ci.txt line names a file that exists and gives a reason
//   4. the deploy gate exists: at least one `gate` shard, and gate shards serve the built site (site=bundled)
// Prints the expected minutes per shard (tests/e2e/durations.txt) as information; a shard over 8 min is a warning, not a fail.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseShards, suites, durations, wallOf } from "./plan.mjs";

const root = process.argv[2] || ".", E2E = join(root, "tests/e2e");
const bad = [], warn = [];
const runAll = readFileSync(join(E2E, "run-all.sh"), "utf8");
const all = suites(runAll);
let shards = [];
try { shards = parseShards(readFileSync(join(E2E, "shards.txt"), "utf8")); } catch (e) { bad.push(e.message); }
const skipFile = join(E2E, "not-in-ci.txt"), skip = new Map();
if (existsSync(skipFile)) readFileSync(skipFile, "utf8").split(/\r?\n/).forEach((l, i) => {
  const t = l.trim(); if (!t || t[0] === "#") return;
  const m = /^(\S+)\s+(.{8,})$/.exec(t);
  if (!m) bad.push("not-in-ci.txt line " + (i + 1) + ": want `<file>  <why it is not in CI>` (a reason of 8+ letters)");
  else skip.set(m[1], m[2]);
});

// 1. files
const files = readdirSync(E2E).filter((f) => /-pw\.js$/.test(f)).sort();
const inRunAll = new Set(all.map((s) => s.file));
for (const f of files) {
  const a = inRunAll.has(f), b = skip.has(f);
  if (!a && !b) bad.push(f + " is in no CI shard: add `run <name> $B " + f + "` to tests/e2e/run-all.sh (+ a shard in shards.txt) or a line to tests/e2e/not-in-ci.txt");
  if (a && b) bad.push(f + " is in run-all.sh AND in not-in-ci.txt: take it off one list");
}
for (const f of skip.keys()) if (!existsSync(join(E2E, f))) bad.push("not-in-ci.txt names a file that does not exist: " + f);
for (const s of all) if (/\.js$/.test(s.file) && !existsSync(join(E2E, s.file))) bad.push("run-all.sh line " + s.line + ": " + s.file + " does not exist");

// 2. + 3. suites ↔ shards
const res = shards.map((s) => ({ s, re: new RegExp(s.filter), names: [] }));
for (const u of all) {
  const hit = res.filter((r) => r.re.test(u.name));
  hit.forEach((r) => r.names.push(u.name));
  if (!hit.length) bad.push("suite `" + u.name + "` (run-all.sh line " + u.line + ", " + u.file + ") is in NO shard of shards.txt: it never runs in CI");
  if (hit.length > 1) bad.push("suite `" + u.name + "` is in " + hit.length + " shards (" + hit.map((r) => r.s.name).join(", ") + "): it runs " + hit.length + " times");
}
for (const r of res) if (!r.names.length) bad.push("shard `" + r.s.name + "` (" + r.s.filter + ") matches no suite in run-all.sh: a runner that tests nothing");
// 4. gate
const gate = shards.filter((s) => s.gate);
if (shards.length && !gate.length) bad.push("shards.txt has no `gate` shard: the live deploy would have no e2e gate");
for (const g of gate) if (g.site !== "bundled") bad.push("gate shard `" + g.name + "` must have site=bundled (the gate tests the site that goes live)");

// info: expected time
const dp = join(E2E, "durations.txt"), dur = existsSync(dp) ? durations(readFileSync(dp, "utf8")) : {};
let worst = 0, total = 0;
for (const r of res) {
  const wall = wallOf(r.names, dur, r.s.par); worst = Math.max(worst, wall);
  total += r.names.reduce((a, n) => a + (dur[n] === undefined ? 60 : dur[n]), 0);
  if (wall > 480) warn.push("shard `" + r.s.name + "` is expected to take " + Math.round(wall / 60) + " min (target: 8): move a suite (node scripts/ci/plan.mjs . --times)");
}
console.log("shard-guard: " + files.length + " *-pw.js files (" + (files.length - skip.size) + " in CI, " + skip.size + " on not-in-ci.txt), " + all.length + " suites, " + shards.length + " shards (" + gate.length + " gate), " +
  Math.round(total / 60) + " test min, longest shard about " + Math.round((worst + 45) / 6) / 10 + " min");
for (const w of warn) console.log("  warn: " + w);
if (bad.length) { console.error("shard-guard FAILED:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("shard-guard ok");
