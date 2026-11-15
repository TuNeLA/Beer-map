// CI plan (lane cifast, finished by lane ci1): prints the e2e matrix as JSON from tests/e2e/shards.txt.
//   one line per shard:  <name> <regex for run-all.sh> [options]
//   options: chromium|webkit|firefox (browsers to install, default chromium) · par=N (tests at once inside the shard, default 2)
//            site=bundled (the shard serves the BUILT site: scripts/build-site.mjs --bundle on) · gate (also runs before a live deploy)
//   node scripts/ci/plan.mjs [root]            normal run: every shard
//   node scripts/ci/plan.mjs [root] --gate     only the `gate` shards (.github/workflows/pages-bundle.yml: the deploy gate)
//   node scripts/ci/plan.mjs [root] --times    table: expected minutes per shard from tests/e2e/durations.txt (no output file)
//   ci/<agent>-<n> branch + .ci-only           only the shards named in .ci-only (one name per line; # comments ok)
// Rules: .ci-only is read ONLY on refs/heads/ci/* (a leaked file never cuts a run on big-update, main or a PR; the unit job fails there).
//   Lines are trimmed (CR LF, spaces, # comments). An empty .ci-only or an unknown name FAILS the job: never a silent skip-all (false green).
//   Skip rule (B1 path filter): when EVERY changed file of the push (env CHANGED_FILES, one per line) is docs-only or ops-only
//   (SKIP_E2E below), the matrix is empty and count=0: the e2e job does not start. No list, or one other file = run everything.
// Writes `matrix=<json>` and `count=<n>` to $GITHUB_OUTPUT (when set) and prints a summary. Exit 1 on a bad file or a typo in .ci-only.
// No dependencies. Used by the "plan" job in .github/workflows/e2e.yml; unit test: tests/unit/plan.test.mjs.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OTHER_JOBS = new Set(["unit", "quality", "schema"]);   // always run; allowed in .ci-only, ignored here
const BROWSERS = new Set(["chromium", "webkit", "firefox"]);
// files that cannot change an e2e result (the app, the tests, the build scripts and the workflows are NOT here)
export const SKIP_E2E = [/\.md$/i, /^ops\//, /^android\//, /^supabase\//, /^scripts\/dev\//, /^scripts\/bots\//, /^\.github\/workflows\/(android|bars|bots|buildings|deploy-functions|events|hours|reminders|secrets)\.yml$/];
export const DEFAULT_PAR = 2;

export function parseShards(text) {
  const out = [], seen = new Set();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line[0] === "#") return;
    const [name, filter, ...rest] = line.split(/\s+/);
    const at = "shards.txt line " + (i + 1) + ": ";
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(at + "bad name " + JSON.stringify(name));
    if (!filter) throw new Error(at + "shard " + name + " has no regex");
    try { new RegExp(filter); } catch (e) { throw new Error(at + "bad regex for " + name); }
    if (seen.has(name)) throw new Error(at + "duplicate shard " + name);
    seen.add(name);
    const s = { name, filter, par: DEFAULT_PAR }, br = [];
    for (const o of rest) {
      if (BROWSERS.has(o)) br.push(o);
      else if (/^par=[1-8]$/.test(o)) s.par = Number(o.slice(4));
      else if (o === "site=bundled") s.site = "bundled";
      else if (o === "gate") s.gate = true;
      else throw new Error(at + "unknown option " + JSON.stringify(o) + " for " + name);
    }
    if (br.length) s.browsers = br.join(" ");
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
  const want = only.filter((n) => !OTHER_JOBS.has(n) && n !== "bundle");   // "bundle": the old bundle job, now the gate shards
  const unknown = want.filter((n) => !names.has(n));
  if (unknown.length) throw new Error(".ci-only names no such shard: " + unknown.join(", ") + " (see tests/e2e/shards.txt)");
  const include = shards.filter((s) => want.includes(s.name));
  if (!include.length) throw new Error(".ci-only lists no e2e shard (one shard name per line, see tests/e2e/shards.txt)");
  return { include, note: ".ci-only: " + include.map((s) => s.name).join(", ") };
}
// true = every changed file is docs-only / ops-only: e2e can be skipped. An empty or missing list = false (run).
export function canSkipE2e(files) {
  const f = (files || []).map((x) => x.trim()).filter(Boolean);
  return f.length > 0 && f.every((x) => SKIP_E2E.some((re) => re.test(x)));
}
// run-all.sh: the suite names in file order, with the line of each (`run <name> …` and the `[[ <name> =~ $FILTER ]]` unit lines)
export function suites(runAll) {
  const out = [];
  runAll.split(/\r?\n/).forEach((l, i) => {
    const m = /^(?:if .*?; then |[A-Z_]+=\S+ )*run\s+([A-Za-z0-9_-]+)\s+\S+\s+([^\s;]+)/.exec(l.trim()) || /^\[\[ ([A-Za-z0-9_-]+) =~ \$FILTER \]\] && \{.*?node (\S+)/.exec(l.trim());
    if (m && !out.some((s) => s.name === m[1])) out.push({ name: m[1], file: m[2], line: i + 1 });
  });
  return out;
}
export function durations(text) {
  const d = {};
  text.split(/\r?\n/).forEach((l) => { const m = /^([A-Za-z0-9_-]+)\s+(\d+)/.exec(l.trim()); if (m) d[m[1]] = Number(m[2]); });
  return d;
}
// expected wall seconds of one shard: `par` workers take the suites in run-all.sh order (what run-all.sh does)
export function wallOf(names, dur, par) {
  const w = new Array(Math.max(1, par)).fill(0);
  for (const n of names) { const i = w.indexOf(Math.min(...w)); w[i] += dur[n] === undefined ? 60 : dur[n]; }
  return Math.max(...w);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2), root = args.find((a) => !a.startsWith("--")) || ".";
    const ref = process.env.GITHUB_REF || "";
    const shards = parseShards(readFileSync(join(root, "tests/e2e/shards.txt"), "utf8"));
    if (args.includes("--times")) {
      const all = suites(readFileSync(join(root, "tests/e2e/run-all.sh"), "utf8")), dp = join(root, "tests/e2e/durations.txt");
      const dur = existsSync(dp) ? durations(readFileSync(dp, "utf8")) : {};
      let worst = 0, sum = 0;
      console.log("shard         par  tests  sum s  wall s  (+ ~45 s setup)");
      for (const s of shards) {
        const re = new RegExp(s.filter), names = all.filter((x) => re.test(x.name)).map((x) => x.name);
        const tot = names.reduce((a, n) => a + (dur[n] === undefined ? 60 : dur[n]), 0), wall = wallOf(names, dur, s.par);
        worst = Math.max(worst, wall); sum += tot;
        console.log(s.name.padEnd(13) + String(s.par).padStart(4) + String(names.length).padStart(7) + String(tot).padStart(7) + String(wall).padStart(8) + (wall > 480 ? "  OVER 8 min" : "") + (names.some((n) => dur[n] === undefined) ? "  (no time for: " + names.filter((n) => dur[n] === undefined).join(", ") + ")" : ""));
      }
      console.log(shards.length + " shards, " + Math.round(sum / 60) + " test minutes, longest shard " + Math.round((worst + 45) / 60 * 10) / 10 + " min with setup");
      process.exit(0);
    }
    let p;
    if (args.includes("--gate")) {
      const include = shards.filter((s) => s.gate);
      if (!include.length) throw new Error("shards.txt has no `gate` shard (the deploy gate would test nothing)");
      p = { include, note: "deploy gate: " + include.map((s) => s.name).join(", ") };
    } else {
      const f = join(root, ".ci-only");
      const only = ref.startsWith("refs/heads/ci/") && existsSync(f) ? parseOnly(readFileSync(f, "utf8")) : null;
      p = plan(shards, only);
      if (only === null && process.env.CHANGED_FILES !== undefined && canSkipE2e(process.env.CHANGED_FILES.split(/\r?\n/))) p = { include: [], note: "e2e skipped: only docs / ops files changed" };
    }
    const include = p.include.map((s) => ({ name: s.name, filter: s.filter, par: s.par, browsers: s.browsers || "chromium", bkey: (s.browsers || "chromium").replace(/\s+/g, "-"), site: s.site || "plain" }));   // bkey: the browser list for a cache key (no spaces)
    console.log("plan: " + include.length + " of " + shards.length + " e2e shards (" + p.note + ")");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "matrix=" + JSON.stringify({ include }) + "\ncount=" + include.length + "\n");
    else console.log(JSON.stringify({ include }));
  } catch (e) { console.error("plan FAILED: " + e.message); process.exit(1); }
}
