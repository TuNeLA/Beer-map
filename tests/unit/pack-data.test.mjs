// lane pack (A6): after the switch (PAGES_DEPLOY = actions) no bot commits to main. The data bots push to branch `data`
// (scripts/pack/data-push.sh); the deploy build and the next bot run put `data` over the checkout (data-overlay.sh).
// Today's path (variable unset) must stay exactly as it was. No network: a local bare repo is the "origin".
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = new URL("../..", import.meta.url).pathname;
const WF = (n) => readFileSync(join(REPO, ".github/workflows", n), "utf8");
const T = mkdtempSync(join(tmpdir(), "pn-pack-"));
test.after(() => rmSync(T, { recursive: true, force: true }));
const sh = (cwd, cmd, env = {}) => {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x", ...env } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const ok = (cwd, cmd, env) => { const r = sh(cwd, cmd, env); assert.equal(r.code, 0, cmd + "\n" + r.out); return r.out; };
const PATHS = readFileSync(join(REPO, "scripts/pack/data-paths.txt"), "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
const put = (root, f, txt) => { mkdirSync(join(root, f, ".."), { recursive: true }); writeFileSync(join(root, f), txt); };

// a tiny repo with the pack scripts and some data files on main, pushed to a bare "origin"
function world(name) {
  const W = join(T, name), O = join(W, "origin.git"), A = join(W, "a");
  mkdirSync(W, { recursive: true });
  ok(W, `git init -q --bare -b main ${O} && git init -q -b main ${A}`);
  cpSync(join(REPO, "scripts/pack"), join(A, "scripts/pack"), { recursive: true });
  put(A, "docs/bars.json", "bars-main"); put(A, "docs/hours.json", "hours-main");
  put(A, "docs/places/a.json", "pa-main"); put(A, "docs/places/old.json", "old-main"); put(A, "docs/index.html", "app");
  ok(A, `git add -A && git commit -qm main && git remote add origin ${O} && git push -q origin main`);
  return { W, O, A, main: () => ok(A, `git ls-remote ${O} refs/heads/main`).split(/\s/)[0], data: (f) => sh(W, `git --git-dir=${O} show data:${f}`) };
}

test("data-paths.txt lists every path the three data bots write, and nothing else is pushed", () => {
  for (const [wf, paths] of [["bars.yml", ["docs/bars.json", "docs/places.json", "docs/places", "docs/placeinfo"]],
    ["buildings.yml", ["docs/buildings", "scripts/bar-buildings-state.json", "docs/arenas.json"]],
    ["hours.yml", ["docs/hours.json", "docs/systembolaget.json"]]]) {
    const s = WF(wf);
    const m = s.match(/bash scripts\/pack\/data-push\.sh "[^"]*\[skip ci\]" ([^\n]+)/);
    assert.ok(m, wf + ": the commit step calls data-push.sh with a [skip ci] message");
    assert.deepEqual(m[1].trim().split(/\s+/), paths, wf + ": data-push.sh gets the same paths as the old `git add`");
    for (const p of paths) assert.ok(PATHS.includes(p), p + " is in data-paths.txt");
  }
});

test("bots: PAGES_DEPLOY = actions pushes branch data and exits BEFORE the old `git push origin HEAD:main`; unset = the old step", () => {
  for (const wf of ["bars.yml", "buildings.yml", "hours.yml"]) {
    const s = WF(wf);
    const step = s.slice(s.lastIndexOf("      - name: Commit"));
    assert.match(step, /env:\n\s+PAGES_DEPLOY: \$\{\{ vars\.PAGES_DEPLOY \}\}/, wf + ": the commit step reads the switch");
    const g = step.indexOf('if [ "$PAGES_DEPLOY" = actions ]; then'), x = step.indexOf("exit 0", g), push = step.indexOf("git push origin HEAD:main");
    assert.ok(g > 0 && x > g && push > x, wf + ": switch branch + exit 0 come before the push to main");
    assert.match(s, /if: \$\{\{ vars\.PAGES_DEPLOY == 'actions' \}\}\n\s+run: bash scripts\/pack\/data-overlay\.sh/, wf + ": the bot starts from branch data after the switch");
  }
  const st = WF("stamp-version.yml");
  assert.match(st, /if: \$\{\{ vars\.PAGES_DEPLOY != 'actions' \}\}/, "the stamp bot stops with the same switch");
  const pb = WF("pages-bundle.yml");
  const ov = pb.indexOf("bash scripts/pack/data-overlay.sh"), bs = pb.indexOf("node scripts/build-site.mjs");
  assert.ok(ov > 0 && bs > ov, "the deploy build puts branch data over the checkout before build-site.mjs");
  // every other workflow: no push at all, or (stamp-version) only behind the switch
  for (const n of ["guards.yml", "pages-bundle.yml", "events.yml", "reminders.yml", "secrets.yml", "bots.yml", "deploy-functions.yml"])
    if (existsSync(join(REPO, ".github/workflows", n))) assert.doesNotMatch(WF(n), /git push/, n + " pushes nothing");
});

test("data-push.sh: first run makes branch data (no main history), main does not move, a re-run with the same files commits nothing", () => {
  const w = world("push");
  const m0 = w.main();
  put(w.A, "docs/bars.json", "bars-NEW"); put(w.A, "docs/places/a.json", "pa-NEW");
  const out = ok(w.A, `bash scripts/pack/data-push.sh "Update bars [skip ci]" docs/bars.json docs/places`);
  assert.match(out, /data-push: data [0-9a-f]+/);
  assert.equal(w.main(), m0, "main did not move");
  assert.equal(w.data("docs/bars.json").out, "bars-NEW");
  assert.equal(w.data("docs/places/a.json").out, "pa-NEW");
  assert.notEqual(w.data("docs/hours.json").code, 0, "branch data holds only what a bot pushed");
  assert.notEqual(w.data("docs/index.html").code, 0, "branch data holds no app code");
  const log = ok(w.W, `git --git-dir=${w.O} log --format=%s data`).trim().split("\n");
  assert.deepEqual(log, ["Update bars [skip ci]"], "one commit, no history from main");
  assert.match(ok(w.A, `bash scripts/pack/data-push.sh "again [skip ci]" docs/bars.json docs/places`), /no change on data/);
  // the next bot adds its own paths on top; the first bot's files stay
  put(w.A, "docs/hours.json", "hours-NEW");
  ok(w.A, `bash scripts/pack/data-push.sh "Update hours [skip ci]" docs/hours.json`);
  assert.equal(w.data("docs/hours.json").out, "hours-NEW");
  assert.equal(w.data("docs/bars.json").out, "bars-NEW");
  assert.equal(w.main(), m0, "main still did not move");
  ok(w.A, `git status --porcelain | grep -q . && git checkout -q -- docs`);   // the bot's checkout is thrown away in CI
});

test("data-push.sh refuses a path that is not in data-paths.txt (the deploy would not use it)", () => {
  const w = world("refuse");
  const r = sh(w.A, `bash scripts/pack/data-push.sh "x [skip ci]" docs/index.html`);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /not in scripts\/pack\/data-paths\.txt/);
  assert.notEqual(sh(w.W, `git --git-dir=${w.O} rev-parse -q --verify data`).code, 0, "no branch made");
});

test("data-push.sh: another bot pushed first (push refused) = start again from the new data, nothing lost", () => {
  const w = world("race");
  const B = join(w.W, "b");
  ok(w.W, `git clone -q ${w.O} ${B}`);
  put(w.A, "docs/bars.json", "bars-A");
  ok(w.A, `bash scripts/pack/data-push.sh "A [skip ci]" docs/bars.json`);
  // clone B fetched before A pushed: simulate with a pre-push hook that pushes a third commit first, once
  put(B, "docs/hours.json", "hours-B");
  const hook = join(B, ".git/hooks/pre-push");
  writeFileSync(hook, `#!/bin/bash\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX\n[ -f "${w.W}/raced" ] && exit 0\ntouch "${w.W}/raced"\nC=$(mktemp -d); git clone -q -b data ${w.O} "$C"; echo arena > "$C/docs/arenas.json"; git -C "$C" add -A; git -C "$C" -c user.name=t -c user.email=t@x commit -qm third; git -C "$C" push -q origin data\nexit 0\n`, { mode: 0o755 });
  const out = ok(B, `bash scripts/pack/data-push.sh "B [skip ci]" docs/hours.json`, { PN_DATA_RETRY_SLEEP: "0" });
  assert.match(out, /push refused/, "the first push lost the race");
  assert.equal(w.data("docs/hours.json").out, "hours-B");
  assert.equal(w.data("docs/bars.json").out, "bars-A");
  assert.equal(w.data("docs/arenas.json").out, "arena\n");
});

test("data-overlay.sh: no branch data = nothing changes; with it, each data path is replaced as a whole, others stay", () => {
  const w = world("overlay");
  const C = join(w.W, "c");
  ok(w.W, `git clone -q --depth 1 ${w.O} ${C}`);
  assert.match(ok(C, "bash scripts/pack/data-overlay.sh"), /no branch data/);
  assert.equal(ok(C, "git status --porcelain"), "", "nothing changed");
  put(w.A, "docs/bars.json", "bars-D"); put(w.A, "docs/places/a.json", "pa-D"); rmSync(join(w.A, "docs/places/old.json"));
  ok(w.A, `bash scripts/pack/data-push.sh "D [skip ci]" docs/bars.json docs/places`);
  const out = ok(C, "bash scripts/pack/data-overlay.sh");
  assert.match(out, /data-overlay: 2 of \d+ data paths from branch data [0-9a-f]+/);
  assert.equal(readFileSync(join(C, "docs/bars.json"), "utf8"), "bars-D");
  assert.equal(readFileSync(join(C, "docs/places/a.json"), "utf8"), "pa-D");
  assert.equal(existsSync(join(C, "docs/places/old.json")), false, "a file the bot dropped is gone (folder replaced as a whole)");
  assert.equal(readFileSync(join(C, "docs/hours.json"), "utf8"), "hours-main", "a path that data does not have stays");
  assert.equal(readFileSync(join(C, "docs/index.html"), "utf8"), "app", "app code is never touched");
});
