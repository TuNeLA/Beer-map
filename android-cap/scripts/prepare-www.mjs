// PintsNow Android store build (F1): make android-cap/www from the repo's docs/. The repo's docs/ is never changed.
//   node android-cap/scripts/prepare-www.mjs        (run from anywhere; npm run www inside android-cap/)
// Steps:
//   1. copy docs/ to a NEW android-cap/www (the old www is replaced; it is a build output, see .gitignore)
//   2. scripts/strip-logging.py: the store bundle has crash reports only (owner decision 8 Nov 2026); it also stamps
//      ?v= and sw.js VERSION with the "-store" suffix (scripts/stamp.mjs)
//   3. config.js: the store flag is forced on (window.OLNU_STORE = true, class olnu-store), not only when window.Capacitor
//      exists. Why: the shell must never show web-only drinking content, even if the bridge loads late.
//   4. checks: the flag line is there, the stamp matches, logging is stripped. Exit 1 = do not build.
import { cpSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAP = resolve(HERE, "..");
const REPO = resolve(CAP, "..");
const WWW = join(CAP, "www");
const die = (m) => { console.error("prepare-www FAILED: " + m); process.exit(1); };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: REPO });
  if (r.status !== 0) die(cmd + " " + args.join(" ") + "\n" + (r.stderr || r.stdout).slice(0, 1500));
  return r.stdout;
};

// The exact text in docs/config.js that this step changes. If config.js changes, this fails loud (no silent web build).
// The flag is forced just before it is published (after the detection in config.js), so nothing in config.js can turn it off.
export const FLAG_OLD = "  window.OLNU_STORE = s;\n";
export const FLAG_NEW = "  s = true; try { sessionStorage.setItem(\"olnu.store\", \"1\"); } catch (e) {}   // android-cap prepare-www.mjs: store build (F1)\n" + FLAG_OLD;

export function storeConfig(src) {
  if (src.split(FLAG_OLD).length !== 2) throw new Error("config.js: the line '  window.OLNU_STORE = s;' must be there exactly once");
  return src.replace(FLAG_OLD, FLAG_NEW);
}

function main() {
  if (!existsSync(join(REPO, "docs", "index.html"))) die("no docs/index.html next to android-cap/");
  rmSync(WWW, { recursive: true, force: true });
  cpSync(join(REPO, "docs"), WWW, { recursive: true });
  const cfg = join(WWW, "config.js");
  try { writeFileSync(cfg, storeConfig(readFileSync(cfg, "utf8"))); } catch (e) { die(e.message); }
  process.stdout.write(run("python3", ["-I", join(REPO, "scripts", "strip-logging.py"), WWW]));
  run("python3", ["-I", join(REPO, "scripts", "strip-logging.py"), WWW, "--check"]);
  process.stdout.write(run("node", [join(REPO, "scripts", "stamp.mjs"), WWW, "--check"]));
  const ver = (readFileSync(join(WWW, "sw.js"), "utf8").match(/^var VERSION = "([^"]*)";/m) || [])[1] || "";
  if (!/-store$/.test(ver)) die("sw.js VERSION is not a store stamp: " + ver);
  if (readFileSync(cfg, "utf8").indexOf(FLAG_NEW) < 0) die("store flag missing in www/config.js");
  console.log("prepare-www ok: " + WWW + " (VERSION " + ver + ", OLNU_STORE on)");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
