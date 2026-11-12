// CI plan: prints the e2e matrix as JSON from tests/e2e/shards.txt (one shard per line: <name> <regex> [browsers]).
//   normal run                         : every shard
//   ci/<agent>-<n> branch + .ci-only   : only the shards named in .ci-only (one name per line; # comments ok)
// Writes `matrix=<json>` and `count=<n>` to $GITHUB_OUTPUT (when set) and prints a summary. Exit 1 on a bad file or a typo in .ci-only.
// No dependencies. Used by the "plan" job in .github/workflows/tests.yml; unit test: tests/unit/plan.test.mjs.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OTHER_JOBS = new Set(["unit", "quality", "schema", "bundle"]);   // always run; allowed in .ci-only, ignored here

export function parseShards(text) {
  const out = [], seen = new Set();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line[0] === "#") return;
    const [name, filter, ...rest] = line.split(/\s+/);
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("shards.txt line " + (i + 1) + ": bad name " + JSON.stringify(name));
    if (!filter) throw new Error("shards.txt line " + (i + 1) + ": shard " + name + " has no regex");
    try { new RegExp(filter); } catch (e) { throw new Error("shards.txt line " + (i + 1) + ": bad regex for " + name); }
    if (seen.has(name)) throw new Error("shards.txt line " + (i + 1) + ": duplicate shard " + name);
    seen.add(name);
    const s = { name, filter };
    if (rest.length) s.browsers = rest.join(" ");
    out.push(s);
  });
  if (!out.length) throw new Error("shards.txt has no shards");
  return out;
}
export function parseOnly(text) {
  return text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
}
// only = null (run all) or the list of names from .ci-only
export function plan(shards, only) {
  if (only === null) return { include: shards, note: "all shards" };
  const names = new Set(shards.map((s) => s.name));
  const want = only.filter((n) => !OTHER_JOBS.has(n));
  const unknown = want.filter((n) => !names.has(n));
  if (unknown.length) throw new Error(".ci-only names no such shard: " + unknown.join(", ") + " (see tests/e2e/shards.txt)");
  const include = shards.filter((s) => want.includes(s.name));
  if (!include.length) throw new Error(".ci-only lists no e2e shard (one shard name per line, see tests/e2e/shards.txt)");
  return { include, note: ".ci-only: " + include.map((s) => s.name).join(", ") };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const root = process.argv[2] || ".";
    const ref = process.env.GITHUB_REF || "";
    const shards = parseShards(readFileSync(join(root, "tests/e2e/shards.txt"), "utf8"));
    const f = join(root, ".ci-only");
    const only = ref.startsWith("refs/heads/ci/") && existsSync(f) ? parseOnly(readFileSync(f, "utf8")) : null;
    const p = plan(shards, only);
    console.log("plan: " + p.include.length + " of " + shards.length + " e2e shards (" + p.note + ")");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "matrix=" + JSON.stringify({ include: p.include }) + "\ncount=" + p.include.length + "\n");
    else console.log(JSON.stringify({ include: p.include }));
  } catch (e) { console.error("plan FAILED: " + e.message); process.exit(1); }
}
