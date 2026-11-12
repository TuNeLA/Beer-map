// Flake ledger helper. usage: node tests/e2e/flakes.mjs [logs dir]   (default tests/e2e/out/logs)
// Reads <logs>/flaky-now.txt (written by run-all.sh: suites that passed only on the rerun) and bumps count / date in flakes.json.
// A suite not in the ledger gets a new entry "<suite>: ?" with status "open" (fill in the cause by hand). Prints what it did.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const logs = process.argv[2] || path.join(here, "out", "logs");
const file = path.join(here, "flakes.json");
const led = JSON.parse(fs.readFileSync(file, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const names = fs.existsSync(path.join(logs, "flaky-now.txt")) ? fs.readFileSync(path.join(logs, "flaky-now.txt"), "utf8").split("\n").filter(Boolean) : [];
if (!names.length) console.log("no flaky suite in this run");
for (const n of names) {
  const keys = Object.keys(led).filter((k) => k.split(":")[0] === n);
  if (!keys.length) { led[n + ": ?"] = { first: today, count: 1, cause: "unknown", status: "open" }; console.log("new ledger entry:", n + ": ?"); continue; }
  for (const k of keys) { led[k].count++; led[k].last = today; console.log("count++", k, led[k].count, led[k].status); }   // also a "fixed" entry: it came back
}
fs.writeFileSync(file, JSON.stringify(led, null, 2) + "\n");
